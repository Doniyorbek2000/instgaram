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
              <li>Yoki Claude Code'da: <code>claude mcp add --transport http adm-ai &lt;manzil&gt;</code></li>
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
