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
} from "./db.js";

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
      await updateUser(user.id, { meta: { googleId } });
      user.meta = { ...user.meta, googleId };
    }
  } else {
    const salt = crypto.randomBytes(16).toString("hex");
    user = await createUser({
      email,
      salt,
      passwordHash: hashPassword(crypto.randomBytes(32).toString("hex"), salt),
      businessName: name || email.split("@")[0],
    });
    await updateUser(user.id, { meta: { googleId } });
    user.meta = { ...user.meta, googleId };
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
  req.user = await getSessionUser(parseSid(req));
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

