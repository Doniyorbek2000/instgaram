/**
 * "Instagram bilan ulash" — Instagram API with Instagram Login (self-service).
 *
 * Tadbirkor tugmani bosadi → Instagram'da ruxsat beradi → biz uzoq muddatli
 * token olamiz va akkauntni webhooklarga ulaymiz. Facebook sahifasi kerak emas.
 *
 * Eslatma: bu yerda Facebook App ID/Secret emas, aynan Instagram App ID/Secret
 * ishlatiladi (Meta panel → Use cases → Instagram → API setup with Instagram login).
 */
import { config, igGraphUrl } from "./config.js";
import { igGraphPost } from "./graph.js";

// Ulanish tugmasi ishlashi uchun shu uchtasi kerak
export const oauthAvailable = Boolean(
  config.igAppId && config.igAppSecret && config.baseUrl
);

export const redirectUri = `${config.baseUrl}/connect/instagram/callback`;

// Instagram Login ruxsatlari (eski instagram_basic/pages_* lar bekor qilingan)
const SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
].join(",");

// Webhookda kerak bo'ladigan maydonlar
const SUBSCRIBE_FIELDS = "messages,comments";

/** Foydalanuvchini Instagram ruxsat oynasiga yo'naltirish uchun URL */
export function authUrl(state) {
  const params = new URLSearchParams({
    client_id: config.igAppId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${params}`;
}

/** OAuth code → qisqa muddatli token (1 soat) */
async function exchangeCode(code) {
  try {
    const res = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.igAppId,
        client_secret: config.igAppSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      console.error("IG token almashish xatosi:", JSON.stringify(data).slice(0, 200));
      return null;
    }
    return data.access_token;
  } catch (err) {
    console.error("IG token almashish tarmoq xatosi:", err.message);
    return null;
  }
}

/** Qisqa muddatli token → uzoq muddatli (60 kun) */
async function toLongLived(shortToken) {
  try {
    const qs = new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: config.igAppSecret,
      access_token: shortToken,
    });
    const res = await fetch(`https://graph.instagram.com/access_token?${qs}`);
    const data = await res.json().catch(() => ({}));
    // Almashtira olmasak ham qisqa token bilan davom etamiz — hech yo'qdan yaxshi
    return data.access_token || shortToken;
  } catch {
    return shortToken;
  }
}

/** Token egasining profili */
async function fetchProfile(token) {
  try {
    const qs = new URLSearchParams({
      fields: "id,user_id,username,account_type",
      access_token: token,
    });
    const res = await fetch(igGraphUrl(`me?${qs}`));
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      console.error("IG profil xatosi:", JSON.stringify(data).slice(0, 200));
      return null;
    }
    return data;
  } catch (err) {
    console.error("IG profil tarmoq xatosi:", err.message);
    return null;
  }
}

/**
 * OAuth code'dan to'liq ulanish ma'lumotini oladi.
 * Muvaffaqiyatda: { igUserId, igUsername, igAccessToken, accountType }
 * Xatoda: { error }
 */
export async function connectInstagram(code) {
  const shortToken = await exchangeCode(code);
  if (!shortToken) return { error: "Instagram tokenini olishda xatolik yuz berdi." };

  const token = await toLongLived(shortToken);
  const profile = await fetchProfile(token);
  if (!profile) {
    return {
      error:
        "Instagram profil ma'lumotini olib bo'lmadi. " +
        "Agar ilova hali Development rejimida bo'lsa, akkauntingiz Meta Developer Console'da Tester sifatida qo'shilganidan so'ng, " +
        "https://www.instagram.com/accounts/manage_access/ sahifasiga kirib taklifni 'Accept' qilganingizga ishonch hosil qiling.",
    };
  }

  // Muhim: webhook entry.id sifatida "user_id" keladi, "id" emas —
  // shuning uchun marshrutlash uchun aynan user_id saqlanadi.
  if (!profile.user_id) {
    return {
      error:
        "Bu akkaunt Instagram Business/Creator emas ko'rinadi. " +
        "Instagram sozlamalarida akkauntni professional turga o'tkazing va qaytadan urinib ko'ring.",
    };
  }

  return {
    igUserId: String(profile.user_id),
    igUsername: profile.username || "",
    igAccessToken: token,
    accountType: profile.account_type || "",
  };
}

/**
 * Akkauntni webhooklarga ulaydi — shundan keyin xabar va kommentlar
 * bizning serverga kela boshlaydi.
 */
export function subscribeAccount(token) {
  return igGraphPost(`me/subscribed_apps?subscribed_fields=${SUBSCRIBE_FIELDS}`, {}, token);
}
