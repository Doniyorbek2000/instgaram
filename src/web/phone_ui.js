/**
 * Telefon AI (Zadarma).
 *
 * Qo'ng'iroqqa Zadarma'ning o'z AI ovozli agenti javob beradi (Zadarma API jonli audio oqimini
 * bermaydi). Obunext tomoni:
 *  - /phone — bilim bazasi + sotuv qoidalaridan agent ko'rsatmasini yasaydi (Zadarma kabinetiga
 *    nusxalanadi), webhook URL va oxirgi qo'ng'iroqlar ro'yxati;
 *  - /zadarma/hook/:token — Zadarma PBX webhook'i (NOTIFY_END): qo'ng'iroq jurnalga yoziladi,
 *    egasiga Telegram xabar, CRM'ga lid. Token URL'da — so'rov shu biznesniki ekani shu bilan tekshiriladi.
 */
import crypto from "node:crypto";
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { listUsers, persist } from "../db.js";
import { buildPhonePrompt } from "../ai.js";
import { sendTelegram } from "../notify.js";
import { autoPushCrm } from "../crm.js";
import { config } from "../config.js";

export const phoneRouter = Router();
export const zadarmaHookRouter = Router();

const MAX_CALLS = 200;
const SHOWN_CALLS = 50;
const DISPOSITIONS = { answered: "✅ Javob berildi", busy: "📵 Band", cancel: "↩️ Bekor qilindi", "no answer": "⏳ Javobsiz", failed: "❌ Xato" };

const cleanPhone = (v) => String(v || "").replace(/[^\d+]/g, "").slice(0, 20);
const fmtDuration = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

function ensureHookToken(u) {
  u.phone ||= {};
  if (!u.phone.hookToken) {
    u.phone.hookToken = crypto.randomBytes(16).toString("hex");
    persist(u);
  }
  return u.phone.hookToken;
}

function sameToken(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

async function findByHookToken(token) {
  // shortcut: barcha bizneslarni ko'rib chiqadi — qo'ng'iroqlar kam; ko'paysa indeksli qidiruvga o'tkazish
  return (await listUsers()).find((u) => sameToken(u.phone?.hookToken, token)) || null;
}

/** NOTIFY_END → qo'ng'iroq jurnaliga yozadi. Qaytaradi: yozuv yoki null (takror/boshqa hodisa). */
export function recordCall(u, b = {}) {
  if (b.event !== "NOTIFY_END") return null;
  u.phone ||= {};
  const id = String(b.pbx_call_id || "").slice(0, 80);
  if (id && (u.phone.calls || []).some((c) => c.id === id)) return null; // Zadarma qayta yuborgan
  const call = {
    id,
    at: new Date().toISOString(),
    phone: cleanPhone(b.caller_id),
    did: cleanPhone(b.called_did),
    duration: Math.max(0, Number.parseInt(b.duration, 10) || 0),
    disposition: String(b.disposition || "").toLowerCase().slice(0, 30),
    recorded: String(b.is_recorded) === "1",
  };
  u.phone.calls = [call, ...(u.phone.calls || [])].slice(0, MAX_CALLS);
  persist(u);

  const status = DISPOSITIONS[call.disposition] || call.disposition || "—";
  sendTelegram(u.settings?.telegramChatId, `📞 <b>Qo'ng'iroq</b>\n${esc(call.phone || "noma'lum raqam")} · ${fmtDuration(call.duration)} · ${esc(status)}`).catch(() => {});
  if (call.phone) {
    autoPushCrm(u, "calls", { title: `Qo'ng'iroq: ${call.phone}`, phone: call.phone, note: `Telefon (Zadarma): ${status}, ${fmtDuration(call.duration)}`, tags: ["telefon"] });
  }
  return call;
}

zadarmaHookRouter.all("/zadarma/hook/:token", async (req, res) => {
  const u = await findByHookToken(req.params.token);
  if (!u) return res.sendStatus(404);
  // Zadarma URL'ni ulashda GET ?zd_echo=... yuborib, aynan shu qiymatni qaytarishni kutadi
  if (req.query.zd_echo) return res.type("text/plain").send(String(req.query.zd_echo).replace(/[^\w-]/g, "").slice(0, 100));
  if (req.method !== "POST") return res.sendStatus(405);
  try {
    recordCall(u, req.body);
  } catch (err) {
    console.error("[Zadarma] webhook xatosi:", err.message);
  }
  res.sendStatus(200);
});

phoneRouter.get("/phone", requireAuth, (req, res) => {
  const u = req.user;
  const hookUrl = `${config.baseUrl || `http://localhost:${config.port}`}/zadarma/hook/${ensureHookToken(u)}`;
  const calls = (u.phone?.calls || []).slice(0, SHOWN_CALLS);
  const copyBtn = `<button type="button" class="secondary" style="margin:0" onclick="navigator.clipboard.writeText(this.previousElementSibling.value); this.textContent='✓'">📋</button>`;

  res.send(
    page(
      "Telefon AI",
      `
      <div class="card">
        <h3 style="margin-top:0">📞 Telefon qo'ng'iroqlariga AI javob beradi (Zadarma)</h3>
        <ol style="line-height:1.7; padding-left:20px; margin:0">
          <li><a href="https://zadarma.com" target="_blank" rel="noopener">Zadarma</a>'da ro'yxatdan o'ting va virtual raqam oling (kerakli shahar raqami borligini kabinetda tekshiring).</li>
          <li>Zadarma kabinetida AI ovozli agent yarating va pastdagi <b>ko'rsatmani</b> agentning ko'rsatma (prompt) maydoniga qo'ying.</li>
          <li>Raqamga kiruvchi qo'ng'iroqlarni shu AI agentga yo'naltiring. Operatorga ulash uchun xodim ichki raqamini agent sozlamasida ko'rsating.</li>
          <li>Zadarma kabinetidagi API/Integratsiyalar bo'limida qo'ng'iroq bildirishnomalarini (NOTIFY_END) pastdagi <b>webhook URL</b>'ga yo'naltiring — har qo'ng'iroq shu yerda, Telegram'da va CRM'da ko'rinadi.</li>
          <li>Bilimlar bazasini o'zgartirsangiz — ko'rsatmani qayta nusxalab, Zadarma'da yangilang.</li>
        </ol>
      </div>
      <div class="card">
        <h3 style="margin-top:0">🧠 AI agent ko'rsatmasi</h3>
        <p class="hint">Bilimlar bazangiz, biznes uslubi va sotuv qoidalaridan avtomatik yig'ildi.</p>
        <div style="display:flex; gap:6px; align-items:flex-start"><textarea readonly rows="14" style="margin:0; font-size:12.5px" onclick="this.select()">${esc(buildPhonePrompt(u))}</textarea>${copyBtn}</div>
      </div>
      <div class="card">
        <h3 style="margin-top:0">🔗 Webhook URL</h3>
        <p class="hint">Bu manzil maxfiy — faqat Zadarma kabinetiga qo'ying.</p>
        <div style="display:flex; gap:6px"><input readonly value="${esc(hookUrl)}" onclick="this.select()" style="margin:0; font-family:monospace; font-size:12px">${copyBtn}</div>
      </div>
      <div class="card">
        <h3 style="margin-top:0">🗂️ Oxirgi qo'ng'iroqlar</h3>
        ${calls.length
          ? `<table><thead><tr><th>Vaqt</th><th>Raqam</th><th>Davomiyligi</th><th>Holat</th></tr></thead><tbody>${calls
              .map((c) => `<tr><td>${esc(new Date(c.at).toLocaleString("uz-UZ", { timeZone: u.settings?.timezone || "Asia/Tashkent" }).slice(0, 17))}</td><td>${esc(c.phone || "—")}</td><td>${fmtDuration(c.duration)}</td><td>${esc(DISPOSITIONS[c.disposition] || c.disposition || "—")}</td></tr>`)
              .join("")}</tbody></table>`
          : `<p class="hint">Hali qo'ng'iroq yo'q.</p>`}
      </div>`,
      { user: u, active: "phone" }
    )
  );
});
