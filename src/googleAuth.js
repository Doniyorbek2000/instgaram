/**
 * "Google bilan kirish/ro'yxatdan o'tish" — sayt akkauntiga (email+parol
 * o'rniga) Google orqali kirish. Ijtimoiy tarmoq (Instagram/Facebook) ulash
 * bilan hech qanday aloqasi yo'q — bu faqat login usuli.
 */
import { config } from "./config.js";

export const googleAuthAvailable = Boolean(
  config.googleClientId && config.googleClientSecret && config.baseUrl
);

export const googleRedirectUri = `${config.baseUrl}/auth/google/callback`;

const SCOPES = ["openid", "email", "profile"].join(" ");

/** Foydalanuvchini Google ruxsat oynasiga yo'naltirish uchun URL */
export function googleAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: googleRedirectUri,
    response_type: "code",
    scope: SCOPES,
    state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** OAuth code → access token */
async function exchangeCode(code) {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        grant_type: "authorization_code",
        redirect_uri: googleRedirectUri,
        code,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      console.error("Google token almashish xatosi:", JSON.stringify(data).slice(0, 200));
      return null;
    }
    return data.access_token;
  } catch (err) {
    console.error("Google token almashish tarmoq xatosi:", err.message);
    return null;
  }
}

/** Token → foydalanuvchi profili (sub, email, name, picture) */
async function fetchProfile(token) {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.sub) {
      console.error("Google profil xatosi:", JSON.stringify(data).slice(0, 200));
      return null;
    }
    return data;
  } catch (err) {
    console.error("Google profil tarmoq xatosi:", err.message);
    return null;
  }
}

/**
 * OAuth code'dan Google profilini oladi.
 * Muvaffaqiyatda: { googleId, email, name, picture }
 * Xatoda: { error }
 */
export async function fetchGoogleProfile(code) {
  const token = await exchangeCode(code);
  if (!token) return { error: "Google tokenini olishda xatolik yuz berdi." };

  const profile = await fetchProfile(token);
  if (!profile) return { error: "Google profil ma'lumotini olib bo'lmadi." };

  if (!profile.email || !profile.email_verified) {
    return { error: "Google akkauntingizning email manzili tasdiqlanmagan." };
  }

  return {
    googleId: profile.sub,
    email: profile.email,
    name: profile.name || "",
    picture: profile.picture || "",
  };
}
