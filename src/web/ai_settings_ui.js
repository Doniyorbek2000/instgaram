/**
 * AI avtomatik javob sozlamalari (/ai-settings), tezkor yoqish/o'chirish
 * (/ai/toggle) va bitta chat uchun AI (/clients/c/:key/ai).
 */
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { aiSettings, saveAiSettings, setAiEnabled, setChatAi, aiStatusLabel, AI_MODES, CHANNELS, isWorkTime } from "../aiControl.js";
import { allContacts } from "../broadcasts.js";
import { aiQuota } from "../credits.js";

export const aiSettingsRouter = Router();

const safeBack = (b, fallback) => (typeof b === "string" && /^\/(dashboard|inbox|clients|ai-settings)(\/|\?|#|$)/.test(b) ? b : fallback);
const DAY_NAMES = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];

aiSettingsRouter.get("/ai-settings", requireAuth, (req, res) => {
  const u = req.user;
  const s = aiSettings(u);
  const st = aiStatusLabel(u);
  const [from, to] = String(s.hours).split("-");
  const days = String(s.days).split(",").map(Number);
  const offChats = allContacts(u).filter((k) => u.contactMeta?.[k]?.aiOff).length;
  const q = aiQuota(u);

  res.send(
    page(
      "AI javob sozlamalari",
      `
      ${req.query.saved ? `<div class="ok">Saqlandi ✅</div>` : ""}
      <style>
        .ai-switch { display:flex; align-items:center; gap:14px; cursor:pointer; margin:0; text-transform:none; letter-spacing:0 }
        .ai-switch input { display:none }
        .ai-switch .track { width:58px; height:32px; border-radius:99px; background:#334155; position:relative; transition:.2s; flex:none }
        .ai-switch .track::after { content:""; position:absolute; top:4px; left:4px; width:24px; height:24px; border-radius:50%; background:#fff; transition:.2s }
        .ai-switch input:checked + .track { background:#10b981 }
        .ai-switch input:checked + .track::after { left:30px }
        .chip-row { display:flex; gap:8px; flex-wrap:wrap }
        .chip-row label { display:flex; align-items:center; gap:6px; margin:0; padding:8px 12px; border:1px solid var(--border); border-radius:10px; cursor:pointer; text-transform:none; letter-spacing:0; font-size:14px; color:#e2e8f0 }
        .chip-row input { width:auto; margin:0 }
      </style>
      <form method="post" action="/ai-settings" class="grid split-form">
        <div>
          <div class="card" style="border:1px solid ${s.enabled ? "#10b981" : "#64748b"}">
            <label class="ai-switch">
              <input type="checkbox" name="enabled" ${s.enabled ? "checked" : ""}>
              <span class="track"></span>
              <span><b style="font-size:18px; color:#fff">AI avtomatik javob</b><br><span class="hint">${esc(st.label)}</span></span>
            </label>
            <p class="hint" style="font-size:13px; margin:12px 0 0">O'chirilganda ham flow'lar, kalit so'z qoidalari, formalar va geymifikatsiya ishlashda davom etadi — faqat AI'ning erkin javoblari to'xtaydi. Mijoz xabarlari Inbox'da ko'rinadi, siz javob berasiz.</p>
          </div>

          <div class="card">
            <h3 style="margin-top:0">📡 Kanallar</h3>
            <div class="chip-row">
              ${Object.entries(CHANNELS).map(([c, l]) => `<label><input type="checkbox" name="ch_${c}" ${s.channels[c] ? "checked" : ""}> ${esc(l)}</label>`).join("")}
            </div>
            <p class="hint" style="font-size:12.5px">Belgilanmagan kanalda AI javob bermaydi.</p>
          </div>

          <div class="card">
            <h3 style="margin-top:0">🕘 Jadval</h3>
            <select name="mode">${Object.entries(AI_MODES).map(([k, l]) => `<option value="${k}" ${s.mode === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
            <div style="display:flex; gap:10px; margin-top:10px">
              <div style="flex:1"><label>Ish vaqti boshlanishi</label><input type="time" name="from" value="${esc(from || "09:00")}"></div>
              <div style="flex:1"><label>Tugashi</label><input type="time" name="to" value="${esc(to || "18:00")}"></div>
            </div>
            <label>Ish kunlari</label>
            <div class="chip-row">
              ${DAY_NAMES.map((d, i) => `<label><input type="checkbox" name="days" value="${i + 1}" ${days.includes(i + 1) ? "checked" : ""}> ${d}</label>`).join("")}
            </div>
            <p class="hint" style="font-size:12.5px">Masalan "Faqat ish vaqtidan tashqarida": kunduzi operatorlar javob beradi, kechasi va dam olish kunlari AI. Hozir: <b>${isWorkTime(u) ? "ish vaqti" : "ish vaqtidan tashqari"}</b> (${esc(u.settings?.timezone || "Asia/Tashkent")}).</p>
          </div>
        </div>
        <div>
          <div class="card">
            <h3 style="margin-top:0">💬 AI o'chiq paytda</h3>
            <select name="whenOff">
              <option value="silent" ${s.whenOff === "silent" ? "selected" : ""}>Jim turish (faqat operator javob beradi)</option>
              <option value="message" ${s.whenOff === "message" ? "selected" : ""}>Qisqa xabar yuborish</option>
            </select>
            <label>Xabar matni</label>
            <textarea name="offMessage" rows="3" maxlength="1000">${esc(s.offMessage)}</textarea>
            <p class="hint" style="font-size:12.5px">Bir mijozga 6 soatda bir martadan ko'p yuborilmaydi.</p>
          </div>
          <div class="card">
            <h3 style="margin-top:0">📊 Holat</h3>
            <p style="margin:0; font-size:14px">AI o'chirilgan chatlar: <b>${offChats}</b> <span class="hint">(Inbox yoki mijoz kartochkasida alohida o'chiriladi)</span></p>
            <p style="margin:8px 0 0; font-size:14px">Bu oy AI javoblar: <b>${q.used}</b> / ${q.quota}${q.bonus ? ` + ${q.bonus} kredit` : ""} · <a href="/billing#credits">Kreditlar</a></p>
            <p style="margin:8px 0 0; font-size:14px"><a href="/ai-learn">🧠 AI'ni o'rgatish</a> · <a href="/account">📚 Bilim bazasi</a></p>
          </div>
          <button class="btn" style="width:100%">💾 Saqlash</button>
        </div>
      </form>`,
      { user: u, active: "ai-settings" }
    )
  );
});

aiSettingsRouter.post("/ai-settings", requireAuth, (req, res) => {
  saveAiSettings(req.user, req.body || {});
  res.redirect("/ai-settings?saved=1");
});

aiSettingsRouter.post("/ai/toggle", requireAuth, (req, res) => {
  setAiEnabled(req.user, req.body?.enabled === "1");
  res.redirect(safeBack(req.body?.back, "/dashboard"));
});

aiSettingsRouter.post("/clients/c/:key/ai", requireAuth, (req, res) => {
  const key = String(req.params.key || "");
  if (allContacts(req.user).includes(key)) setChatAi(req.user, key, req.body?.on === "1");
  res.redirect(safeBack(req.body?.back, `/clients/c/${encodeURIComponent(key)}`));
});
