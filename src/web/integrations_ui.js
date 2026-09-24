/**
 * Integratsiyalar (/integrations) — Webhook (Make, Zapier, n8n, amoCRM, Bitrix24)
 * va Google Sheets. Hodisalar tanlanadi, sinov yuboriladi, oxirgi yuborishlar jurnali.
 */
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { persist } from "../db.js";
import { ensureIntegrations, INTEGRATION_EVENTS, SHEETS_APPS_SCRIPT, isSafeUrl, fireEvent } from "../integrations.js";
import { createApiToken, revokeApiToken } from "../mcp.js";
import { config } from "../config.js";
import { crmSettings, saveCrmSettings, testCrm, crmConnected, CRM_TYPES } from "../crm.js";
import { smsSettings, emailSettings, saveMessagingSettings, sendSms, sendEmail, smsReady, emailReady } from "../messaging.js";

export const integrationsRouter = Router();

integrationsRouter.get("/integrations", requireAuth, (req, res) => {
  res.setHeader("Referrer-Policy", "no-referrer"); // sahifa URL'idagi yangi token tashqariga ketmasin
  const u = req.user;
  const integ = ensureIntegrations(u);
  res.send(
    page(
      "Integratsiyalar",
      `${req.query.saved ? `<div class="ok">Saqlandi ✅</div>` : ""}
      ${req.query.tested ? `<div class="ok">Sinov hodisasi yuborildi — natija pastdagi jurnalda (bir necha soniyada).</div>` : ""}
      ${req.query.error ? `<div class="error">${esc(req.query.error)}</div>` : ""}
      <form method="post" action="/integrations" class="grid split-form">
        <div>
          <div class="card">
            <h3 style="margin-top:0">🔗 Webhook</h3>
            <p class="hint" style="margin-top:0; font-size:13px">Har bir hodisa JSON ko'rinishida POST qilinadi. Make, Zapier, n8n, Albato orqali amoCRM, Bitrix24, Kommo, GetCourse va boshqa tizimlarga ulanadi.</p>
            <input name="webhookUrl" type="url" value="${esc(integ.webhookUrl || "")}" placeholder="https://hook.eu1.make.com/...">
            <details style="margin-top:10px"><summary class="hint" style="cursor:pointer">Yuboriladigan JSON namunasi</summary>
<pre style="background:#0b0f19; padding:10px; border-radius:8px; font-size:12px; overflow-x:auto">{
  "event": "form_submitted",
  "eventTitle": "Forma to'ldirildi (lid)",
  "business": "${esc(u.businessName || "")}",
  "at": "2026-09-24T10:00:00.000Z",
  "data": { "form": "Konsultatsiya", "contact": "ig:1784...", "Ism": "Aziza", "Telefon": "+998901234567" }
}</pre></details>
          </div>
          <div class="card">
            <h3 style="margin-top:0">📊 Google Sheets</h3>
            <ol class="hint" style="font-size:13px; padding-left:18px; line-height:1.7; margin-top:0">
              <li>Google Sheets'da yangi jadval oching → <b>Kengaytmalar → Apps Script</b>.</li>
              <li>Quyidagi kodni joylang va saqlang.</li>
              <li><b>Deploy → New deployment → Web app</b>, "Who has access" — <b>Anyone</b>.</li>
              <li>Berilgan URL'ni shu yerga qo'ying — har bir lid jadvalga yangi qator bo'lib tushadi.</li>
            </ol>
            <textarea readonly rows="8" style="font-family:monospace; font-size:12px" onclick="this.select()">${esc(SHEETS_APPS_SCRIPT)}</textarea>
            <label>Web app URL</label>
            <input name="sheetsUrl" type="url" value="${esc(integ.sheetsUrl || "")}" placeholder="https://script.google.com/macros/s/.../exec">
          </div>
        </div>
        <div>
          <div class="card">
            <h3 style="margin-top:0">⚡ Qaysi hodisalar yuborilsin</h3>
            ${Object.entries(INTEGRATION_EVENTS)
              .map(([k, label]) => `<label style="display:flex; gap:8px; align-items:center; cursor:pointer; margin:8px 0; text-transform:none; letter-spacing:0; font-size:14px; font-weight:600">
                <input type="checkbox" name="ev_${k}" ${integ.events[k] ? "checked" : ""} style="width:auto; margin:0"> ${esc(label)}
              </label>`)
              .join("")}
            <button class="btn" style="width:100%; margin-top:10px">💾 Saqlash</button>
          </div>
          <div class="card">
            <h3 style="margin-top:0">🧪 Sinov va jurnal</h3>
            <button class="secondary" formaction="/integrations/test" style="width:100%; margin:0 0 10px">📤 Sinov hodisasini yuborish</button>
            ${integ.log.length
              ? integ.log.slice(0, 15).map((l) => `<div style="display:flex; justify-content:space-between; gap:8px; font-size:12.5px; padding:5px 0; border-bottom:1px solid var(--border)">
                  <span>${l.ok ? "✅" : "⚠️"} ${esc(INTEGRATION_EVENTS[l.event] || l.event)} → ${esc(l.target)}</span>
                  <span class="hint">${esc(String(l.status))} · ${esc(String(l.at).slice(11, 16))}</span>
                </div>`).join("")
              : `<p class="hint" style="font-size:13px">Hali yuborish bo'lmagan</p>`}
          </div>
        </div>
      </form>

      ${crmCard(u, req)}

      ${messagingCard(u, req)}

      <div class="card" id="mcp" style="border:1px solid #d97706">
        <h3 style="margin-top:0">🤖 Claude bilan ulash (MCP)</h3>
        <p class="hint" style="margin-top:0">Claude'ga oddiy tilda yozasiz — u flow yaratadi, tahrirlaydi, statistikani ko'radi va ommaviy xabar tayyorlaydi. Masalan: <i>"Reels ostida KURS deb yozganlarga obunani tekshirib bepul darsni yuboradigan flow qil"</i>.</p>
        ${req.query.newToken ? `<div class="ok">
            Token yaratildi — hozir nusxa oling, u boshqa ko'rsatilmaydi:
            <div style="display:flex; gap:8px; margin-top:8px"><input id="mcpUrl" readonly value="${esc(mcpUrl(req, req.query.newToken))}" style="margin:0; font-family:monospace; font-size:12px"><button type="button" class="btn" style="margin:0" onclick="navigator.clipboard.writeText(document.getElementById('mcpUrl').value); this.textContent='✓'">📋</button></div>
          </div>` : ""}
        <div class="grid split-form" style="gap:16px">
          <div>
            <ol class="hint" style="font-size:13px; line-height:1.8; padding-left:18px; margin:0">
              <li>O'ngda token yarating va MCP manzilini nusxalang.</li>
              <li><b>claude.ai</b> → Sozlamalar → <b>Connectors</b> → <b>Add custom connector</b> → manzilni qo'ying.</li>
              <li>Yoki Claude Code'da: <code>claude mcp add --transport http obunext &lt;manzil&gt;</code></li>
              <li>Claude yaratgan flow'lar o'chiq holda saqlanadi — panelda ko'rib, keyin yoqasiz.</li>
            </ol>
            ${(u.apiTokens || []).length ? `<table style="width:100%; border-collapse:collapse; font-size:13px; margin-top:12px">
              ${(u.apiTokens || []).map((t) => `<tr style="border-top:1px solid var(--border)">
                <td style="padding:6px 0"><b>${esc(t.name)}</b> <span class="hint" style="font-family:monospace">${esc(t.prefix)}…</span></td>
                <td>${t.scope === "read" ? "👁️ faqat o'qish" : "✏️ to'liq"}</td>
                <td class="hint" style="font-size:12px">${t.lastUsedAt ? `ishlatilgan ${esc(t.lastUsedAt.slice(0, 16).replace("T", " "))}` : "hali ishlatilmagan"}</td>
                <td><form method="post" action="/integrations/tokens/${esc(t.id)}/revoke" style="margin:0" onsubmit="return confirm('Token bekor qilinsinmi? Ulangan Claude ishlamay qoladi.')"><button class="secondary" style="margin:0; padding:3px 10px; font-size:12px; color:#f87171">Bekor qilish</button></form></td>
              </tr>`).join("")}
            </table>` : ""}
          </div>
          <form method="post" action="/integrations/tokens" style="margin:0">
            <label>Nomi</label>
            <input name="name" value="Claude" maxlength="60">
            <label>Ruxsat</label>
            <select name="scope">
              <option value="full">✏️ To'liq — flow yaratish/tahrirlash, ommaviy xabar</option>
              <option value="read">👁️ Faqat o'qish — statistika va ko'rish</option>
            </select>
            <button class="btn" style="width:100%; margin-top:10px">🔑 Token yaratish</button>
          </form>
        </div>
      </div>`,
      { user: u, active: "integrations" }
    )
  );
});

function crmCard(u, req) {
  const c = crmSettings(u);
  const conn = crmConnected(u);
  const t = c.lastTest || null;
  const pipeOptions = (t?.pipelines || [])
    .map((p) => `<optgroup label="${esc(p.name)}">${p.statuses.map((s) => `<option value="${p.id}:${s.id}" ${String(c.amo.pipelineId) === String(p.id) && String(c.amo.statusId) === String(s.id) ? "selected" : ""}>${esc(p.name)} → ${esc(s.name)}</option>`).join("")}</optgroup>`)
    .join("");
  const autoRow = (k, label) => `<label style="display:flex; gap:8px; align-items:center; margin:6px 0; text-transform:none; letter-spacing:0; font-size:13.5px; font-weight:600; cursor:pointer"><input type="checkbox" name="crmAuto_${k}" ${c.auto[k] ? "checked" : ""} style="width:auto; margin:0"> ${label}</label>`;
  return `<div class="card" id="crm" style="border:1px solid ${conn ? "#10b981" : "var(--border)"}">
    <h3 style="margin-top:0">📇 CRM: amoCRM / Kommo / Bitrix24 ${conn ? `<span class="status-tag" style="font-size:11.5px; color:#34d399">✓ ${esc(CRM_TYPES[conn])} ulangan</span>` : ""}</h3>
    ${req.query.crm ? `<div class="${req.query.crmok ? "ok" : "error"}">${esc(req.query.crm)}</div>` : ""}
    <form method="post" action="/integrations/crm" class="grid split-form" style="gap:16px; margin:0">
      <div>
        <label>CRM turi</label>
        <select name="crmType" onchange="this.form.querySelectorAll('[data-crm]').forEach(function(e){e.style.display=e.getAttribute('data-crm')===this.value?'':'none'}.bind(this))">
          ${Object.entries(CRM_TYPES).map(([k, l]) => `<option value="${k}" ${c.type === k ? "selected" : ""}>${esc(l)}</option>`).join("")}
        </select>
        <div data-crm="amocrm" style="${c.type === "amocrm" ? "" : "display:none"}">
          <label>Manzil</label>
          <input name="amoDomain" value="${esc(c.amo.domain || "")}" placeholder="kompaniya.amocrm.ru yoki kompaniya.kommo.com">
          <label>Uzoq muddatli token ${c.amo.token ? `<span class="hint">(saqlangan — o'zgartirish uchun yangisini kiriting)</span>` : ""}</label>
          <input name="amoToken" type="password" autocomplete="off" placeholder="${c.amo.token ? "••••••••" : "eyJ0eXAiOiJKV1Qi…"}">
          <p class="hint" style="font-size:12px">amoCRM → Настройки → Интеграции → Создать интеграцию → Ключи и доступы → <b>Долгосрочный токен</b>.</p>
          <label>Voronka va bosqich</label>
          ${pipeOptions
            ? `<select name="amoPipelineStatus"><option value="">Asosiy voronka (sukut bo'yicha)</option>${pipeOptions}</select>`
            : `<p class="hint" style="font-size:12px; margin:4px 0">Saqlang va "Ulanishni tekshirish"ni bosing — voronkalar ro'yxati shu yerda chiqadi.</p>`}
        </div>
        <div data-crm="bitrix24" style="${c.type === "bitrix24" ? "" : "display:none"}">
          <label>Kiruvchi webhook manzili</label>
          <input name="bitrixUrl" value="${esc(c.bitrix.webhookUrl || "")}" placeholder="https://kompaniya.bitrix24.uz/rest/1/abc123xyz/">
          <p class="hint" style="font-size:12px">Bitrix24 → Разработчикам → Другое → <b>Входящий вебхук</b>, huquq: CRM.</p>
        </div>
      </div>
      <div>
        <b style="font-size:13.5px">Avtomatik yuborish</b>
        ${autoRow("forms", "Lid formasi to'ldirilganda")}
        ${autoRow("leads", "Mijoz chatda telefon/email qoldirganda")}
        ${autoRow("ai", "AI suhbatdan kontakt yig'ganda")}
        ${autoRow("orders", "Do'kondan buyurtma tushganda")}
        <p class="hint" style="font-size:12px">Bir mijoz uchun bitim bir marta ochiladi, keyingi ma'lumotlar unga izoh bo'lib qo'shiladi. Flow'da "📇 CRM'da lid ochish" amali ham bor.</p>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px">
          <button class="btn" style="margin:0">💾 Saqlash</button>
          <button class="secondary" formaction="/integrations/crm/test" style="margin:0">🔌 Ulanishni tekshirish</button>
        </div>
      </div>
    </form>
  </div>`;
}

function messagingCard(u, req) {
  const sms = smsSettings(u);
  const em = emailSettings(u);
  return `<div class="card" id="msg">
    <h3 style="margin-top:0">📱 SMS va ✉️ Email ${smsReady(u) ? `<span class="status-tag" style="font-size:11.5px; color:#34d399">SMS ✓</span>` : ""} ${emailReady(u) ? `<span class="status-tag" style="font-size:11.5px; color:#34d399">Email ✓</span>` : ""}</h3>
    ${req.query.msgs ? `<div class="${req.query.msgok ? "ok" : "error"}">${esc(req.query.msgs)}</div>` : ""}
    <p class="hint" style="margin-top:0">Flow'dagi "📱 SMS yuborish" / "✉️ Email yuborish" amallari va ommaviy xabarlarda — mijozning telefon/email maydoniga.</p>
    <form method="post" action="/integrations/messaging" class="grid split-form" style="gap:16px; margin:0">
      <div>
        <b style="font-size:13.5px">Eskiz.uz (SMS)</b>
        <label>Eskiz login (email)</label><input name="smsEmail" value="${esc(sms.email)}" autocomplete="off">
        <label>Parol / kalit ${sms.password ? `<span class="hint">(saqlangan)</span>` : ""}</label><input name="smsPassword" type="password" autocomplete="off" placeholder="${sms.password ? "••••••••" : ""}">
        <label>Yuboruvchi nomi (nik)</label><input name="smsFrom" value="${esc(sms.from)}" placeholder="4546">
        <p class="hint" style="font-size:12px">Eskiz har bir matn shablonini oldindan tasdiqlaydi — yuboriladigan matnlarni kabinetda shablon sifatida ro'yxatdan o'tkazing.</p>
      </div>
      <div>
        <b style="font-size:13.5px">SMTP (Email)</b>
        <div style="display:flex; gap:8px"><div style="flex:2"><label>Server</label><input name="smtpHost" value="${esc(em.host)}" placeholder="smtp.gmail.com"></div><div style="flex:1"><label>Port</label><input name="smtpPort" value="${esc(em.port)}" inputmode="numeric"></div></div>
        <label style="display:flex; gap:6px; align-items:center; text-transform:none; letter-spacing:0; font-size:13px"><input type="checkbox" name="smtpSecure" ${em.secure ? "checked" : ""} style="width:auto; margin:0"> SSL/TLS (465-port)</label>
        <label>Login</label><input name="smtpUser" value="${esc(em.user)}" autocomplete="off">
        <label>Parol ${em.pass ? `<span class="hint">(saqlangan)</span>` : ""}</label><input name="smtpPass" type="password" autocomplete="off" placeholder="${em.pass ? "••••••••" : "Gmail uchun: App password"}">
        <label>Kimdan (From)</label><input name="smtpFrom" value="${esc(em.from)}" placeholder="Guli Shop <info@guli.uz>">
      </div>
      <div style="grid-column:1/-1; display:flex; gap:8px; flex-wrap:wrap; align-items:center">
        <button class="btn" style="margin:0">💾 Saqlash</button>
        <input name="testTo" placeholder="Sinov: +998901234567 yoki email" style="margin:0; max-width:280px">
        <button class="secondary" formaction="/integrations/messaging/test" style="margin:0">📤 Sinov yuborish</button>
      </div>
    </form>
  </div>`;
}

integrationsRouter.post("/integrations/messaging", requireAuth, (req, res) => {
  const errors = saveMessagingSettings(req.user, req.body || {});
  res.redirect(`/integrations?${errors.length ? `msgs=${encodeURIComponent(errors.join(". "))}` : "msgok=1&msgs=" + encodeURIComponent("Saqlandi ✅")}#msg`);
});

integrationsRouter.post("/integrations/messaging/test", requireAuth, async (req, res) => {
  const errors = saveMessagingSettings(req.user, req.body || {});
  if (errors.length) return res.redirect(`/integrations?msgs=${encodeURIComponent(errors.join(". "))}#msg`);
  const to = String(req.body?.testTo || "").trim();
  const r = to.includes("@")
    ? await sendEmail(req.user, to, `${req.user.businessName || "Obunext"}: sinov`, "Bu sinov xabari. Email sozlamalari ishlayapti ✅")
    : await sendSms(req.user, to, `${req.user.businessName || "Obunext"}: sinov xabari`);
  res.redirect(`/integrations?${r.ok ? "msgok=1&msgs=" + encodeURIComponent("Sinov xabari yuborildi ✅") : "msgs=" + encodeURIComponent(r.error)}#msg`);
});

integrationsRouter.post("/integrations/crm", requireAuth, (req, res) => {
  const body = { ...(req.body || {}) };
  const [pipe, status] = String(body.amoPipelineStatus || "").split(":");
  if (body.amoPipelineStatus !== undefined) { body.amoPipeline = pipe || ""; body.amoStatus = status || ""; }
  else { const c = crmSettings(req.user); body.amoPipeline = c.amo.pipelineId; body.amoStatus = c.amo.statusId; }
  const errors = saveCrmSettings(req.user, body);
  res.redirect(`/integrations?${errors.length ? `crm=${encodeURIComponent(errors.join(". "))}` : "crmok=1&crm=" + encodeURIComponent("Saqlandi ✅")}#crm`);
});

integrationsRouter.post("/integrations/crm/test", requireAuth, async (req, res) => {
  const body = { ...(req.body || {}) };
  const c0 = crmSettings(req.user);
  const [pipe, status] = String(body.amoPipelineStatus || "").split(":");
  body.amoPipeline = body.amoPipelineStatus !== undefined ? pipe || "" : c0.amo.pipelineId;
  body.amoStatus = body.amoPipelineStatus !== undefined ? status || "" : c0.amo.statusId;
  const errors = saveCrmSettings(req.user, body);
  if (errors.length) return res.redirect(`/integrations?crm=${encodeURIComponent(errors.join(". "))}#crm`);
  const r = await testCrm(req.user);
  const c = crmSettings(req.user);
  if (r.ok) {
    c.lastTest = { at: new Date().toISOString(), pipelines: r.pipelines || [], statuses: r.statuses || [] };
    persist(req.user);
    const n = r.pipelines ? `${r.pipelines.length} ta voronka topildi — bosqichni tanlang va saqlang` : `${(r.statuses || []).length} ta lid holati topildi`;
    return res.redirect(`/integrations?crmok=1&crm=${encodeURIComponent(`Ulanish ishlayapti ✅ ${n}`)}#crm`);
  }
  res.redirect(`/integrations?crm=${encodeURIComponent(r.error)}#crm`);
});

function saveSettings(req) {
  const integ = ensureIntegrations(req.user);
  const b = req.body || {};
  const errors = [];
  for (const k of ["webhookUrl", "sheetsUrl"]) {
    const v = String(b[k] || "").trim().slice(0, 1000);
    if (v && !isSafeUrl(v)) errors.push(`${k === "webhookUrl" ? "Webhook" : "Sheets"} manzili noto'g'ri yoki ichki tarmoqqa ishora qiladi`);
    else integ[k] = v;
  }
  for (const k of Object.keys(INTEGRATION_EVENTS)) integ.events[k] = b[`ev_${k}`] === "on";
  persist(req.user);
  return errors;
}

integrationsRouter.post("/integrations", requireAuth, (req, res) => {
  const errors = saveSettings(req);
  res.redirect(errors.length ? `/integrations?error=${encodeURIComponent(errors.join(". "))}` : "/integrations?saved=1");
});

function mcpUrl(req, token) {
  const base = config.baseUrl || `${req.protocol}://${req.get("host")}`;
  return `${base}/mcp/${token}`;
}

integrationsRouter.post("/integrations/tokens", requireAuth, (req, res) => {
  const r = createApiToken(req.user, { name: req.body?.name, scope: req.body?.scope });
  if (r.error) return res.redirect(`/integrations?error=${encodeURIComponent(r.error)}#mcp`);
  // Token faqat bir marta, URL orqali ko'rsatiladi (bazada faqat xesh)
  res.redirect(`/integrations?newToken=${encodeURIComponent(r.token)}#mcp`);
});

integrationsRouter.post("/integrations/tokens/:id/revoke", requireAuth, (req, res) => {
  revokeApiToken(req.user, req.params.id);
  res.redirect("/integrations#mcp");
});

integrationsRouter.post("/integrations/test", requireAuth, (req, res) => {
  const errors = saveSettings(req);
  if (errors.length) return res.redirect(`/integrations?error=${encodeURIComponent(errors.join(". "))}`);
  const integ = ensureIntegrations(req.user);
  if (!integ.webhookUrl && !integ.sheetsUrl) return res.redirect(`/integrations?error=${encodeURIComponent("Avval Webhook yoki Sheets URL kiriting")}`);
  fireEvent(req.user, "form_submitted", { form: "Sinov", contact: "test:0", Ism: "Sinov Mijoz", Telefon: "+998900000000" }, { force: true });
  res.redirect("/integrations?tested=1");
});
