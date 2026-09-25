import crypto from "node:crypto";
import { config } from "./config.js";
import {
  createUser,
  findUserByEmail,
  createSession,
  getSessionUser,
  deleteSession,
  deleteUserSessions,
  updateUser,
  findUserById,
  persist,
} from "./db.js";
import { sendPlatformMail, mailReady } from "./mailer.js";

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

/**
 * Parolni saqlangan hash bilan doimiy vaqtda solishtiradi.
 * timingSafeEqual uzunliklar farq qilsa xato otadi — hash buzilgan/bo'sh
 * bo'lsa server yiqilmasligi uchun avval uzunlikni tekshiramiz.
 */
function verifyPassword(password, user) {
  if (!user?.salt || !user?.passwordHash) return false;
  const actual = Buffer.from(hashPassword(String(password ?? ""), user.salt));
  const expected = Buffer.from(user.passwordHash);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export async function register(email, password, businessName) {
  if (!email || !email.includes("@")) {
    return { error: "Email noto'g'ri kiritildi" };
  }
  if (!password || password.length < 6) {
    return { error: "Parol kamida 6 ta belgidan iborat bo'lsin" };
  }
  if (await findUserByEmail(email)) {
    return { error: "Bu email allaqachon ro'yxatdan o'tgan" };
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const user = await createUser({
    email,
    salt,
    passwordHash: hashPassword(password, salt),
    businessName,
  });
  const token = await createSession(user.id);
  user.meta ||= {};
  user.meta.emailVerified = false;
  await persist(user);
  return { user, token };
}

/**
 * Google profili orqali kirish/ro'yxatdan o'tish.
 * Email allaqachon mavjud bo'lsa (parol bilan ro'yxatdan o'tgan bo'lsa ham) —
 * shu akkauntga Google orqali kiritiladi (googleId meta'ga bog'lanadi).
 * Aks holda tasodifiy (hech qachon ishlatilmaydigan) parol bilan yangi
 * akkaunt yaratiladi — foydalanuvchi doim Google orqali kiradi.
 */
export async function loginOrRegisterWithGoogle({ googleId, email, name }) {
  if (!email) return { error: "Google akkauntida email topilmadi" };

  let user = await findUserByEmail(email);
  if (user) {
    if (user.meta?.googleId !== googleId) {
      await updateUser(user.id, { meta: { googleId, emailVerified: true } });
      user.meta = { ...user.meta, googleId, emailVerified: true };
    }
  } else {
    const salt = crypto.randomBytes(16).toString("hex");
    user = await createUser({
      email,
      salt,
      passwordHash: hashPassword(crypto.randomBytes(32).toString("hex"), salt),
      businessName: name || email.split("@")[0],
    });
    await updateUser(user.id, { meta: { googleId, emailVerified: true } });
    user.meta = { ...user.meta, googleId, emailVerified: true };
  }

  const token = await createSession(user.id);
  return { user, token };
}

// Login urinishlari (brute-force himoyasi): email -> { count, until }
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000; // 15 daqiqa

export async function login(email, password) {
  const key = String(email || "").toLowerCase().trim();
  const rec = loginAttempts.get(key);
  if (rec && rec.until > Date.now()) {
    const mins = Math.ceil((rec.until - Date.now()) / 60000);
    return { error: `Juda ko'p urinish. ${mins} daqiqadan so'ng qayta urinib ko'ring.` };
  }

  const user = await findUserByEmail(email);
  const ok = verifyPassword(password, user);

  if (!ok) {
    const count = (rec?.until > Date.now() ? rec.count : (rec?.count || 0)) + 1;
    loginAttempts.set(key, {
      count,
      until: count >= MAX_ATTEMPTS ? Date.now() + LOCK_MS : 0,
    });
    return { error: "Email yoki parol noto'g'ri" };
  }

  loginAttempts.delete(key);
  if (user.meta?.blocked) return { error: "Akkaunt vaqtincha bloklangan. Qo'llab-quvvatlash xizmatiga murojaat qiling." };
  const token = await createSession(user.id);
  return { user, token };
}

export async function logout(token) {
  await deleteSession(token);
}

/**
 * Parolni o'zgartiradi (avval eski parolni tekshiradi).
 * Muvaffaqiyatda joriy sessiyadan (currentToken) boshqa barcha sessiyalar
 * bekor qilinadi — parol o'g'irlangan bo'lsa, hujumchi tizimdan chiqariladi.
 */
export async function changePassword(user, oldPassword, newPassword, currentToken = null) {
  if (!verifyPassword(oldPassword, user)) return { error: "Joriy parol noto'g'ri" };
  if (!newPassword || newPassword.length < 6) {
    return { error: "Yangi parol kamida 6 ta belgidan iborat bo'lsin" };
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(newPassword, salt);
  await updateUser(user.id, { salt, passwordHash });
  user.salt = salt;
  user.passwordHash = passwordHash;
  await deleteUserSessions(user.id, currentToken);
  return { ok: true };
}

/** Cookie sarlavhasidan aynan "sid" nomli cookie qiymatini ajratib oladi */
export function parseSid(req) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== "sid") continue;
    const value = part.slice(eq + 1).trim();
    return /^[a-f0-9]{16,128}$/i.test(value) ? value : null;
  }
  return null;
}

/** Kirgan foydalanuvchini req.user ga qo'yadi (bo'lmasa null) */
export async function attachUser(req, _res, next) {
  const user = await getSessionUser(parseSid(req));
  // Admin bloklagan biznes panelga kira olmaydi
  req.user = user?.meta?.blocked ? null : user;
  next();
}

/** Faqat kirgan foydalanuvchilar uchun sahifalar */
export function requireAuth(req, res, next) {
  if (!req.user) return res.redirect("/login");
  next();
}

/** Foydalanuvchi admin (dasturchi) ekanmi? */
export function isAdmin(user) {
  if (!user) return false;
  return config.adminEmails.includes(user.email);
}

/** Faqat admin uchun sahifalar */
export function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect("/login");
  // Jamoa a'zosi admin egasining ish maydonida bo'lsa ham admin bo'lib qolmasin
  if (!isAdmin(req.actor ? req.actor.user : req.user)) return res.status(403).send("Ruxsat yo'q");
  next();
}


// ==================== Parolni tiklash va email tasdiqlash ====================

const RESET_TTL_MS = 60 * 60 * 1000;
const sha = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");

/** Token "<userId>.<tasodifiy>" — bazada faqat xeshi saqlanadi. */
function issueToken(user, field, ttlMs) {
  const secret = crypto.randomBytes(24).toString("hex");
  user.meta ||= {};
  user.meta[field] = { hash: sha(secret), exp: Date.now() + ttlMs };
  return `${user.id}.${secret}`;
}

async function consumeToken(token, field) {
  const [id, secret] = String(token || "").split(".");
  if (!id || !secret) return null;
  const user = await findUserById(id);
  const rec = user?.meta?.[field];
  if (!rec?.hash || rec.exp < Date.now()) return null;
  const a = Buffer.from(sha(secret));
  const b = Buffer.from(rec.hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return user;
}

/**
 * Parolni tiklash havolasini email va (ulangan bo'lsa) Telegram orqali yuboradi.
 * Email mavjudligini oshkor qilmaslik uchun natija doim bir xil ko'rsatiladi.
 * Qaytaradi: { channels: [...] } — faqat log/test uchun.
 */
export async function requestPasswordReset(email, baseUrl) {
  const user = await findUserByEmail(email);
  if (!user) return { channels: [] };
  const last = Number(user.meta?.pwResetSentAt) || 0;
  if (Date.now() - last < 60 * 1000) return { channels: [], throttled: true };
  const token = issueToken(user, "pwReset", RESET_TTL_MS);
  user.meta.pwResetSentAt = Date.now();
  await persist(user);
  const url = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
  const channels = [];
  if (await sendPlatformMail(user.email, {
    subject: "Obunext — parolni tiklash",
    lines: ["Parolni tiklash so'raldi. Yangi parol o'rnatish uchun tugmani bosing (havola 1 soat amal qiladi).", "Agar bu siz bo'lmasangiz, xatni e'tiborsiz qoldiring — parolingiz o'zgarmaydi."],
    button: { label: "Yangi parol o'rnatish", url },
  })) channels.push("email");
  if (user.settings?.telegramChatId) {
    const { sendTelegram } = await import("./notify.js");
    const ok = await sendTelegram(user.settings.telegramChatId, `🔑 Obunext parolini tiklash (1 soat amal qiladi):\n${url}\n\nSiz so'ramagan bo'lsangiz — e'tibor bermang.`).catch(() => false);
    if (ok !== false) channels.push("telegram");
  }
  return { channels };
}

export async function resetPasswordWithToken(token, newPassword) {
  if (!newPassword || String(newPassword).length < 6) return { error: "Parol kamida 6 ta belgidan iborat bo'lsin" };
  const user = await consumeToken(token, "pwReset");
  if (!user) return { error: "invalid" };
  const salt = crypto.randomBytes(16).toString("hex");
  user.salt = salt;
  user.passwordHash = hashPassword(String(newPassword), salt);
  delete user.meta.pwReset;
  user.meta.emailVerified = true; // havola emailga kelgan — email egasi tasdiqlandi
  await persist(user);
  await deleteUserSessions(user.id);
  const sessionToken = await createSession(user.id);
  return { ok: true, user, token: sessionToken };
}

/** Email tasdiqlash xatini yuboradi (SMTP sozlangan bo'lsa). */
export async function sendEmailVerification(user, baseUrl) {
  if (!mailReady() || !user?.email) return false;
  const token = issueToken(user, "emailVerify", 7 * 86400000);
  await persist(user);
  return sendPlatformMail(user.email, {
    subject: "Obunext — emailingizni tasdiqlang",
    lines: [`Assalomu alaykum! "${user.businessName || "Obunext"}" hisobingiz yaratildi.`, "Emailingizni tasdiqlang — parolni unutsangiz, tiklash havolasi shu manzilga keladi."],
    button: { label: "Emailni tasdiqlash", url: `${baseUrl}/verify-email?token=${encodeURIComponent(token)}` },
  });
}

export async function verifyEmailToken(token) {
  const user = await consumeToken(token, "emailVerify");
  if (!user) return null;
  delete user.meta.emailVerify;
  user.meta.emailVerified = true;
  await persist(user);
  return user;
}
