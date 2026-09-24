/**
 * Biznes ulanishlarini jonli tekshirish (admin panel → biznes → "🩺 Ulanishlarni tekshirish").
 * Har bir kanal uchun haqiqiy API'ga so'rov yuboriladi: token amal qiladimi, ID mosmi,
 * webhook sozlanganmi. Natija u.meta.lastDiagnostics'da saqlanadi.
 */
import { graphGet, igGraphGet } from "../graph.js";
import { config } from "../config.js";

const errText = (e) => String(e?.error?.message || e?.message || e || "noma'lum xato").slice(0, 200);

async function telegramCall(token, method) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { signal: AbortSignal.timeout(8000) });
    return await res.json();
  } catch (err) {
    return { ok: false, description: err.message };
  }
}

/** Qaytaradi: [{ channel, status: "ok"|"warn"|"bad"|"off", title, detail }] */
export async function diagnoseBusiness(u) {
  const m = u.meta || {};
  const out = [];
  const add = (channel, status, title, detail = "") => out.push({ channel, status, title, detail: String(detail).slice(0, 300) });

  // Meta platforma darajasidagi sozlamalar (webhook shularsiz umuman kelmaydi)
  if (!config.appSecret || !config.verifyToken) add("Meta webhook", "bad", "APP_SECRET yoki VERIFY_TOKEN sozlanmagan", "Serverning .env faylida to'ldiring");

  // Instagram (Instagram Login tokeni)
  if (m.igAccessToken) {
    const me = await igGraphGet("/me", { fields: "user_id,username" }, m.igAccessToken);
    if (me?.error || !(me?.user_id || me?.id)) add("Instagram", "bad", "Token ishlamayapti", errText(me) + " — biznes Instagram'ni qayta ulashi kerak");
    else {
      const id = String(me.user_id || me.id);
      const match = !m.igUserId || m.igUserId === id || m.pageId === id;
      add("Instagram", match ? "ok" : "warn", `@${me.username || "?"} ulangan`, match ? `ID ${id}` : `Token ID (${id}) saqlangan igUserId (${m.igUserId}) bilan mos emas — webhook boshqa biznesga tushishi mumkin`);
    }
  } else add("Instagram", "off", "Ulanmagan");

  // Facebook sahifa (Messenger)
  if (m.pageAccessToken) {
    const me = await graphGet("/me", { fields: "id,name" }, m.pageAccessToken);
    if (me?.error || !me?.id) add("Facebook", "bad", "Sahifa tokeni ishlamayapti", errText(me));
    else {
      const subs = await graphGet(`/${me.id}/subscribed_apps`, {}, m.pageAccessToken);
      const fields = (subs?.data || []).flatMap((a) => a.subscribed_fields || []);
      const subscribed = fields.includes("messages");
      add("Facebook", subscribed ? "ok" : "warn", `${me.name} sahifasi`, subscribed ? `Webhook: ${fields.join(", ")}` : "Sahifa ilovaga 'messages' bo'yicha obuna qilinmagan — Messenger xabarlari kelmaydi");
      if (m.pageId && m.pageId !== me.id) add("Facebook", "warn", "Page ID mos emas", `Token: ${me.id}, saqlangan: ${m.pageId}`);
    }
  } else add("Facebook", "off", "Ulanmagan");

  // WhatsApp Cloud API
  const phoneId = m.whatsappPhoneNumberId || m.whatsappPhoneId;
  if (m.whatsappToken && phoneId) {
    const ph = await graphGet(`/${phoneId}`, { fields: "display_phone_number,verified_name,quality_rating,code_verification_status" }, m.whatsappToken);
    if (ph?.error || !ph?.display_phone_number) add("WhatsApp", "bad", "Token yoki Phone Number ID noto'g'ri", errText(ph));
    else add("WhatsApp", ph.quality_rating === "RED" ? "warn" : "ok", `${ph.verified_name || ""} ${ph.display_phone_number}`, `Sifat reytingi: ${ph.quality_rating || "—"}`);
  } else if (m.whatsappToken || phoneId) add("WhatsApp", "warn", "Chala sozlangan", "Token va Phone Number ID ikkalasi ham kerak");
  else add("WhatsApp", "off", "Ulanmagan");

  // Telegram bot
  const tg = u.settings?.telegramBotToken;
  if (tg) {
    const me = await telegramCall(tg, "getMe");
    if (!me.ok) add("Telegram", "bad", "Bot tokeni ishlamayapti", me.description);
    else {
      const wh = await telegramCall(tg, "getWebhookInfo");
      const url = wh.result?.url || "";
      const lastErr = wh.result?.last_error_message || "";
      const status = !url ? "bad" : lastErr ? "warn" : "ok";
      add("Telegram", status, `@${me.result.username}`, !url ? "Webhook o'rnatilmagan — bot xabar olmaydi" : lastErr ? `Oxirgi xato: ${lastErr}` : `Webhook: ${url.replace(/\/[^/]*$/, "/…")}${wh.result?.pending_update_count ? ` · navbatda ${wh.result.pending_update_count}` : ""}`);
    }
  } else add("Telegram", "off", "Ulanmagan");

  return out;
}
