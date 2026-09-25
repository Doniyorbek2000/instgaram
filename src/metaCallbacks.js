/**
 * Meta platforma callback'lari (App Review talabi):
 *
 *  POST /meta/deauthorize    — foydalanuvchi ilovaga bergan ruxsatni olib tashladi →
 *                              Instagram ulanishi uziladi, tokenlar o'chiriladi.
 *  POST /meta/data-deletion  — ma'lumotlarni o'chirish so'rovi → ulanish uziladi, Instagram
 *                              suhbat tarixi o'chiriladi; javobda holat sahifasi va tasdiq kodi.
 *
 * Ikkalasi ham `signed_request` (base64url(HMAC-SHA256) . base64url(JSON)) bilan keladi —
 * imzo App Secret bilan tekshiriladi, soxta so'rov qabul qilinmaydi.
 */
import crypto from "node:crypto";
import { Router } from "express";
import { config } from "./config.js";
import { findUserByPlatformId, updateUser, getPlatformSettings, setPlatformSettings } from "./db.js";
import { deleteHistory } from "./chatStore.js";
import { alertAdmin } from "./monitor.js";

export const metaCallbacksRouter = Router();

const b64url = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** signed_request'ni tekshiradi. Qaytaradi: payload yoki null. */
export function parseSignedRequest(signed, secrets = [config.igAppSecret, config.appSecret]) {
  const [sigPart, payloadPart] = String(signed || "").split(".");
  if (!sigPart || !payloadPart) return null;
  let payload;
  try {
    payload = JSON.parse(b64url(payloadPart).toString("utf8"));
  } catch {
    return null;
  }
  if (String(payload.algorithm || "").toUpperCase() !== "HMAC-SHA256") return null;
  const sig = b64url(sigPart);
  for (const secret of secrets.filter(Boolean)) {
    const expected = crypto.createHmac("sha256", secret).update(payloadPart).digest();
    if (expected.length === sig.length && crypto.timingSafeEqual(expected, sig)) return payload;
  }
  return null;
}

async function disconnectInstagram(tenant) {
  await updateUser(tenant.id, {
    meta: { igAccessToken: "", igUserId: "", igUsername: "", igTokenExpiresAt: "", pageAccessToken: "", pageId: "" },
  });
}

async function recordRequest(entry) {
  const s = (await getPlatformSettings()) || {};
  const list = Array.isArray(s.metaDeletionRequests) ? s.metaDeletionRequests : [];
  await setPlatformSettings({ metaDeletionRequests: [entry, ...list].slice(0, 200) });
}

metaCallbacksRouter.post("/meta/deauthorize", async (req, res) => {
  const payload = parseSignedRequest(req.body?.signed_request);
  if (!payload) return res.status(400).json({ error: "invalid signed_request" });
  const tenant = await findUserByPlatformId("ig", String(payload.user_id || ""));
  if (tenant) {
    await disconnectInstagram(tenant);
    console.log(`[Meta] deauthorize: ${tenant.email} — Instagram ulanishi uzildi`);
  }
  res.json({ ok: true });
});

metaCallbacksRouter.post("/meta/data-deletion", async (req, res) => {
  const payload = parseSignedRequest(req.body?.signed_request);
  if (!payload) return res.status(400).json({ error: "invalid signed_request" });
  const code = crypto.randomBytes(8).toString("hex");
  const tenant = await findUserByPlatformId("ig", String(payload.user_id || ""));
  if (tenant) {
    await disconnectInstagram(tenant);
    // Instagram suhbatlari (kalitlari "ig:" bilan boshlanadi): kesh va to'liq arxiv
    for (const key of Object.keys(tenant.chats || {}).filter((k) => k.startsWith("ig:"))) {
      await deleteHistory(tenant.id, key).catch(() => {});
    }
  }
  await recordRequest({ code, at: new Date().toISOString(), platformUserId: String(payload.user_id || ""), tenantId: tenant?.id || "", status: tenant ? "done" : "not_found" });
  alertAdmin("data-deletion", `Meta ma'lumot o'chirish so'rovi: ${tenant ? tenant.email : "biznes topilmadi"} (kod ${code})`);
  const base = (config.baseUrl || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  res.json({ url: `${base}/data-deletion?code=${code}`, confirmation_code: code });
});
