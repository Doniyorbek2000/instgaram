/**
 * ADM AI style Ommaviy Xabarlar (Broadcasts / Mass Messaging) Module (/broadcasts)
 */
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { persist } from "../db.js";
import { sendDirectMessage } from "../services/instagram.js";
import { sendMessengerMessage } from "../services/messenger.js";
import { sendTelegramMessage } from "../telegram.js";
import { sendWhatsAppMessage } from "../services/whatsapp.js";

export const broadcastsRouter = Router();

broadcastsRouter.get("/broadcasts", requireAuth, (req, res) => {
  const user = req.user;
  user.broadcasts ||= [];
  const saved = req.query.saved;

  const broadcastsList = user.broadcasts.length
    ? user.broadcasts
        .map(
          (b) => `
        <div class="card" style="margin-bottom:14px">
          <div style="display:flex; justify-content:space-between; align-items:center">
            <div>
              <span class="status-tag" style="background:rgba(59,130,246,0.2); color:#93c5fd; border:1px solid rgba(59,130,246,0.4)">
                📢 ${esc((b.channel || "all").toUpperCase())}
              </span>
              <b style="font-size:16px; margin-left:10px; color:#fff">${esc(b.name)}</b>
            </div>
            <div style="display:flex; gap:8px; align-items:center">
              <span class="status-tag" style="background:rgba(16,185,129,0.2); color:#34d399">✅ ${b.sentCount || 0} ta yuborildi</span>
              ${b.failedCount ? `<span class="status-tag" style="background:rgba(239,68,68,0.2); color:#f87171">⚠️ ${b.failedCount} ta yetmadi</span>` : ""}
              <form method="post" action="/broadcasts/delete" style="margin:0">
                <input type="hidden" name="id" value="${esc(b.id)}">
                <button type="submit" class="secondary" style="padding:4px 8px; font-size:12px; margin:0; color:#f87171">🗑️</button>
              </form>
            </div>
          </div>

          <div style="margin-top:12px; font-size:13.5px; background:#0f172a; padding:10px; border-radius:8px; color:#cbd5e1">
            <b>Xabar matni:</b> "${esc(b.message)}"
          </div>

          <div style="margin-top:8px; font-size:12px" class="hint">Yaratilgan vaqt: ${new Date(b.createdAt).toLocaleString("uz")}</div>
        </div>
        `
        )
        .join("")
    : `
      <div class="card" style="text-align:center; padding:50px 20px">
        <div style="font-size:54px; margin-bottom:12px">📢</div>
        <h3 style="margin:0 0 6px; font-size:20px">Ommaviy xabar yaratish</h3>
        <p class="hint" style="margin:0 0 20px">Barcha mijozlaringizga bir vaqtda aksiya va yangiliklarni yuboring.</p>
      </div>
    `;

  res.send(
    page(
      "Ommaviy xabarlar",
      `
      ${saved ? `<div class="ok">Ommaviy xabar muvaffaqiyatli ishga tushirildi! 🚀</div>` : ""}

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px">
        <div>
          <h2>📢 Ommaviy xabarlar (${user.broadcasts.length})</h2>
          <p class="hint">Tizimdagi barcha obunachi va mijozlaringizga ommaviy xabarnoma yuborish.</p>
        </div>
      </div>

      <div class="grid split-form">
        <div>
          ${broadcastsList}
        </div>

        <div class="card" style="height:fit-content; border:1px solid #3b82f6">
          <h3 style="margin-top:0; font-size:18px; color:#fff">➕ Yangi Ommaviy Xabar</h3>
          <form method="post" action="/broadcasts/create">
            <label>Xabarnoma nomi</label>
            <input type="text" name="name" placeholder="Masalan: Haftalik Chegirma Aksiyasi" required>

            <label>Nishon Kanal (Target Channel)</label>
            <select name="channel">
              <option value="all">🌐 Barcha Kanallar (Instagram, TG, WA, FB)</option>
              <option value="ig">📷 Instagram Direct Mijozlari</option>
              <option value="tg">✈️ Telegram Bot Obunachilari</option>
              <option value="wa">💚 WhatsApp Kontaktlari</option>
              <option value="fb">🔵 Facebook Messenger</option>
            </select>

            <label>Xabar Matni</label>
            <textarea name="message" rows="5" placeholder="Assalomu alaykum! Bugun barcha mahsulotlarimizga 20% chegirma e'lon qilamiz..." required></textarea>

            <button type="submit" class="btn" style="width:100%; margin-top:16px; background:linear-gradient(135deg,#2563eb,#a855f7)">
              🚀 Ommaviy Yuborishni Boshlash
            </button>
            <p class="hint" style="margin-top:10px; font-size:11.5px">⚠️ Meta qoidasi: Instagram/Facebook'da faqat oxirgi 24 soat ichida yozgan mijozlarga xabar yetkazish mumkin — shu sababli "yetmadi" soni bo'lishi tabiiy.</p>
          </form>
        </div>
      </div>
      `,
      { user, active: "broadcasts" }
    )
  );
});

/**
 * Haqiqiy ommaviy yuborish — har bir kontaktga tegishli kanal orqali
 * (Instagram/Facebook/WhatsApp/Telegram) real xabar yuboriladi va faqat
 * chin natija (muvaffaqiyat/xato soni) saqlanadi. Meta'ning "24 soatlik
 * xabar oynasi" siyosati sabab ba'zi kontaktlarga yetkazib bo'lmasligi
 * mumkin — bu XATO emas, Meta'ning o'zi shunday cheklaydi, shuning uchun
 * natija halol ko'rsatiladi (soxta "hammasi yuborildi" emas).
 */
async function sendToContact(user, chatKey, message) {
  const parts = chatKey.split(":");
  const chan = parts.length >= 2 ? parts[0] : "ig";
  const recipient = parts.length >= 2 ? parts.slice(1).join(":") : chatKey;

  let result;
  if (chan === "tg" || chan === "telegram") result = await sendTelegramMessage(user, recipient, message);
  else if (chan === "wa" || chan === "whatsapp") result = await sendWhatsAppMessage(user, recipient, message);
  else if (chan === "fb" || chan === "facebook") result = await sendMessengerMessage(user, recipient, message);
  else result = await sendDirectMessage(user, recipient, message);

  return Boolean(result && !result.error);
}

broadcastsRouter.post("/broadcasts/create", requireAuth, async (req, res) => {
  const user = req.user;
  const { name, channel, message } = req.body || {};
  if (!name || !message) return res.redirect("/broadcasts");

  const targetChan = channel || "all";
  user.chats ||= {};

  let sentCount = 0;
  let failedCount = 0;

  for (const key of Object.keys(user.chats)) {
    const chan = key.includes(":") ? key.split(":")[0] : "ig";
    if (targetChan !== "all" && chan !== targetChan) continue;

    try {
      const ok = await sendToContact(user, key, message);
      if (ok) sentCount++;
      else failedCount++;
    } catch (err) {
      console.error(`[Broadcast] ${key} ga yuborishda xato:`, err.message);
      failedCount++;
    }
  }

  user.broadcasts ||= [];
  user.broadcasts.unshift({
    id: `bc_${Date.now()}`,
    name,
    channel: targetChan,
    message,
    sentCount,
    failedCount,
    status: "completed",
    createdAt: new Date().toISOString(),
  });

  persist(user);
  res.redirect("/broadcasts?saved=1");
});

broadcastsRouter.post("/broadcasts/delete", requireAuth, (req, res) => {
  const user = req.user;
  const { id } = req.body || {};
  if (user.broadcasts) {
    user.broadcasts = user.broadcasts.filter((b) => b.id !== id);
    persist(user);
  }
  res.redirect("/broadcasts");
});
