import crypto from "node:crypto";
import { config } from "./config.js";
import {
  createUser,
  findUserByEmail,
  createSession,
  getSessionUser,
  deleteSession,
  updateUser,
} from "./db.js";

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
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
  const ok =
    user &&
    crypto.timingSafeEqual(
      Buffer.from(hashPassword(password || "", user.salt)),
      Buffer.from(user.passwordHash)
    );

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

/** Parolni o'zgartiradi (avval eski parolni tekshiradi) */
export async function changePassword(user, oldPassword, newPassword) {
  const hash = hashPassword(oldPassword || "", user.salt);
  const ok = crypto.timingSafeEqual(
    Buffer.from(hash),
    Buffer.from(user.passwordHash)
  );
  if (!ok) return { error: "Joriy parol noto'g'ri" };
  if (!newPassword || newPassword.length < 6) {
    return { error: "Yangi parol kamida 6 ta belgidan iborat bo'lsin" };
  }
  const salt = crypto.randomBytes(16).toString("hex");
  await updateUser(user.id, { salt, passwordHash: hashPassword(newPassword, salt) });
  return { ok: true };
}

/** Cookie sarlavhasidan sid qiymatini ajratib oladi */
export function parseSid(req) {
  const cookies = req.headers.cookie || "";
  const match = cookies.match(/(?:^|;|\s*)sid=([^;]+)/);
  return match ? match[1] : null;
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
  if (!isAdmin(req.user)) return res.status(403).send("Ruxsat yo'q");
  next();
}

