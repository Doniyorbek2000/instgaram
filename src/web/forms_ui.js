/**
 * DM lid formalari (/forms) — forma yaratish/tahrirlash, arizalar, CSV eksport.
 * Backend: src/forms.js (sessiya, validatsiya, CRM, Telegram, integratsiyalar).
 */
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { persist } from "../db.js";
import { ensureForms, newFormId, FIELD_TYPES } from "../forms.js";
import { displayName } from "../contacts.js";

export const formsRouter = Router();

function sanitizeForm(body = {}, existing = {}) {
  let fields = [];
  try {
    fields = JSON.parse(String(body.fieldsJson || "[]"));
  } catch {
    fields = [];
  }
  fields = (Array.isArray(fields) ? fields : [])
    .slice(0, 15)
    .map((f) => ({
      label: String(f.label || "").trim().slice(0, 60),
      type: FIELD_TYPES[f.type] ? f.type : "text",
      question: String(f.question || "").trim().slice(0, 500),
      options: f.type === "choice" ? String(f.options || "").split(/\n|,/).map((o) => o.trim().slice(0, 40)).filter(Boolean).slice(0, 10) : [],
      required: f.required !== false,
    }))
    .filter((f) => f.label && (f.type !== "choice" || f.options.length >= 2));
  return {
    ...existing,
    id: existing.id || newFormId(),
    name: String(body.name || "Yangi forma").trim().slice(0, 80),
    keywords: String(body.keywords || "").trim().slice(0, 300),
    matchType: body.matchType === "contains" ? "contains" : "exact",
    intro: String(body.intro || "").trim().slice(0, 1000),
    finishMessage: String(body.finishMessage || "").trim().slice(0, 1000),
    tag: String(body.tag || "").trim().slice(0, 32),
    notify: body.notify === "on",
    active: existing.active !== false,
    fields,
    createdAt: existing.createdAt || new Date().toISOString(),
  };
}

const DEFAULT_FIELDS = [
  { label: "Ism", type: "name", question: "Ismingiz nima?", required: true },
  { label: "Telefon", type: "phone", question: "Telefon raqamingizni yozing (masalan +998 90 123 45 67):", required: true },
];

function formEditor(form = {}) {
  const fields = form.fields?.length ? form.fields : DEFAULT_FIELDS;
  const fieldsForJs = fields.map((f) => ({ ...f, options: (f.options || []).join("\n") }));
  return `
    <form method="post" action="${form.id ? `/forms/${esc(form.id)}` : "/forms"}" id="formEditor">
      <label>Forma nomi</label>
      <input name="name" required maxlength="80" value="${esc(form.name || "")}" placeholder="Masalan: Bepul konsultatsiya">
      <label>Ishga tushiruvchi kalit so'zlar (vergul bilan)</label>
      <input name="keywords" maxlength="300" value="${esc(form.keywords || "")}" placeholder="ariza, yozilish, konsultatsiya">
      <select name="matchType" style="margin-top:6px">
        <option value="exact" ${form.matchType !== "contains" ? "selected" : ""}>Aniq so'z</option>
        <option value="contains" ${form.matchType === "contains" ? "selected" : ""}>Xabar ichida bo'lsa</option>
      </select>
      <p class="hint" style="font-size:12px; margin:4px 0 0">Forma qoida/flow tugmasidan ham ochiladi ("📝 Ariza qoldirish").</p>
      <label>Kirish matni</label>
      <textarea name="intro" rows="2" maxlength="1000" placeholder="Bir necha savol beramiz — 30 soniya vaqtingizni oladi 🙂">${esc(form.intro || "")}</textarea>

      <label>Savollar</label>
      <div id="fieldList"></div>
      <button type="button" class="secondary" id="addField" style="width:100%; margin-top:8px">+ Savol qo'shish</button>
      <input type="hidden" name="fieldsJson" id="fieldsJson">

      <label>Yakuniy xabar</label>
      <textarea name="finishMessage" rows="2" maxlength="1000" placeholder="Rahmat! Tez orada bog'lanamiz ✅">${esc(form.finishMessage || "")}</textarea>
      <label>Kontaktga qo'yiladigan teg</label>
      <input name="tag" maxlength="32" value="${esc(form.tag || "")}" placeholder="konsultatsiya">
      <label style="display:flex; gap:8px; align-items:center; cursor:pointer; margin-top:12px">
        <input type="checkbox" name="notify" ${form.notify === false ? "" : "checked"} style="width:auto; margin:0"> Yangi ariza haqida Telegram'ga xabar
      </label>
      <button class="btn" style="width:100%; margin-top:14px">💾 Saqlash</button>
    </form>
    <script>
    (function () {
      var types = ${JSON.stringify(FIELD_TYPES).replace(/</g, "\\u003c")};
      var fields = ${JSON.stringify(fieldsForJs).replace(/</g, "\\u003c")};
      var list = document.getElementById("fieldList");
      function input(val, ph, on) { var i = document.createElement("input"); i.value = val || ""; i.placeholder = ph; i.style.marginTop = "6px"; i.oninput = function () { on(i.value); }; return i; }
      function render() {
        list.innerHTML = "";
        fields.forEach(function (f, idx) {
          var box = document.createElement("div");
          box.className = "card";
          box.style.cssText = "margin:8px 0 0; padding:10px 12px; background:rgba(255,255,255,0.03)";
          var row = document.createElement("div");
          row.style.cssText = "display:flex; gap:6px; align-items:center";
          var num = document.createElement("b"); num.textContent = (idx + 1) + ".";
          var sel = document.createElement("select"); sel.style.margin = "0";
          Object.keys(types).forEach(function (k) { var o = document.createElement("option"); o.value = k; o.textContent = types[k]; sel.appendChild(o); });
          sel.value = f.type; sel.onchange = function () { f.type = sel.value; render(); };
          var up = document.createElement("button"); up.type = "button"; up.className = "secondary"; up.textContent = "↑"; up.style.cssText = "margin:0; padding:4px 9px";
          up.onclick = function () { if (idx > 0) { fields.splice(idx - 1, 0, fields.splice(idx, 1)[0]); render(); } };
          var del = document.createElement("button"); del.type = "button"; del.className = "secondary"; del.textContent = "✕"; del.style.cssText = "margin:0; padding:4px 9px; color:#f87171";
          del.onclick = function () { fields.splice(idx, 1); render(); };
          row.appendChild(num); row.appendChild(sel); row.appendChild(up); row.appendChild(del);
          box.appendChild(row);
          box.appendChild(input(f.label, "Maydon nomi (jadval ustuni): Ism", function (v) { f.label = v; }));
          box.appendChild(input(f.question, "Mijozga beriladigan savol", function (v) { f.question = v; }));
          if (f.type === "choice") {
            var ta = document.createElement("textarea"); ta.rows = 3; ta.value = f.options || ""; ta.placeholder = "Variantlar (har qatorda bittasi)"; ta.style.marginTop = "6px";
            ta.oninput = function () { f.options = ta.value; };
            box.appendChild(ta);
          }
          var req = document.createElement("label");
          req.style.cssText = "display:flex; gap:6px; align-items:center; margin:6px 0 0; font-size:12px; cursor:pointer";
          var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = f.required !== false; cb.style.cssText = "width:auto; margin:0";
          cb.onchange = function () { f.required = cb.checked; };
          req.appendChild(cb); req.appendChild(document.createTextNode("Majburiy"));
          box.appendChild(req);
          list.appendChild(box);
        });
      }
      document.getElementById("addField").onclick = function () { fields.push({ label: "", type: "text", question: "", required: true }); render(); };
      document.getElementById("formEditor").addEventListener("submit", function () {
        document.getElementById("fieldsJson").value = JSON.stringify(fields);
      });
      render();
    })();
    </script>`;
}

formsRouter.get("/forms", requireAuth, (req, res) => {
  const u = req.user;
  const f = ensureForms(u);
  const tab = req.query.tab === "submissions" ? "submissions" : "forms";
  const editing = req.query.edit ? f.list.find((x) => x.id === req.query.edit) : null;
  const filter = String(req.query.form || "");
  const subs = f.submissions.filter((s) => !filter || s.formId === filter);

  const formsTab = `
    <div class="grid split-form">
      <div>
        ${f.list.length ? f.list.map((form) => `
          <div class="card" style="margin-bottom:12px; border-left:4px solid ${form.active !== false ? "#4ade80" : "#64748b"}">
            <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap">
              <div>
                <b style="font-size:16px">${esc(form.name)}</b>
                <div class="hint" style="font-size:12.5px">🔑 ${esc(form.keywords || "—")} · ${form.fields.length} savol · ${form.starts || 0} boshladi · ${form.submissionsCount || 0} ariza
                  (${form.starts ? Math.round(((form.submissionsCount || 0) / form.starts) * 100) : 0}%)</div>
              </div>
              <div style="display:flex; gap:6px">
                <a class="btn secondary" href="/forms?edit=${esc(form.id)}" style="margin:0; padding:5px 12px; font-size:12px">✏️</a>
                <form method="post" action="/forms/${esc(form.id)}/toggle" style="margin:0"><button class="secondary" style="margin:0; padding:5px 12px; font-size:12px">${form.active !== false ? "✅ Faol" : "⏸️ O'chiq"}</button></form>
                <form method="post" action="/forms/${esc(form.id)}/delete" style="margin:0" onsubmit="return confirm('Forma o\\'chirilsinmi?')"><button class="secondary" style="margin:0; padding:5px 10px; font-size:12px; color:#f87171">🗑️</button></form>
              </div>
            </div>
            <ol style="margin:8px 0 0; padding-left:20px; font-size:13.5px; color:#cbd5e1">${form.fields.map((x) => `<li>${esc(x.question || x.label)} <span class="hint">(${esc(FIELD_TYPES[x.type])})</span></li>`).join("")}</ol>
          </div>`).join("") : `<div class="card hint" style="text-align:center; padding:32px">Hali forma yo'q. O'ngda birinchisini yarating.</div>`}
      </div>
      <div class="card" style="border:1px solid #7c3aed; height:fit-content">
        <h3 style="margin-top:0">${editing ? "✏️ Formani tahrirlash" : "➕ Yangi forma"}</h3>
        ${editing ? `<p><a href="/forms">← Yangi forma</a></p>` : ""}
        ${formEditor(editing || {})}
      </div>
    </div>`;

  const answerCols = [...new Set(subs.flatMap((s) => Object.keys(s.answers || {})))].slice(0, 8);
  const subsTab = `
    <div class="card" style="overflow-x:auto">
      <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-bottom:10px">
        <form method="get" action="/forms" style="margin:0; display:flex; gap:6px">
          <input type="hidden" name="tab" value="submissions">
          <select name="form" onchange="this.form.submit()" style="margin:0">
            <option value="">Barcha formalar</option>
            ${f.list.map((x) => `<option value="${esc(x.id)}" ${filter === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}
          </select>
        </form>
        <a class="btn secondary" href="/forms/export.csv${filter ? `?form=${encodeURIComponent(filter)}` : ""}" style="margin:0">⬇️ CSV</a>
      </div>
      ${subs.length ? `<table style="width:100%; border-collapse:collapse; font-size:13.5px">
        <thead><tr style="text-align:left; color:var(--text-muted); font-size:12px"><th>Sana</th><th>Forma</th><th>Kontakt</th>${answerCols.map((c) => `<th>${esc(c)}</th>`).join("")}<th>Holat</th></tr></thead>
        <tbody>${subs.slice(0, 300).map((s) => `<tr style="border-top:1px solid var(--border)">
          <td style="padding:8px 6px; white-space:nowrap">${esc(String(s.at).slice(0, 16).replace("T", " "))}</td>
          <td>${esc(s.formName)}</td>
          <td><a href="/inbox?chat=${encodeURIComponent(s.key)}">${esc(displayName(u, s.key))}</a></td>
          ${answerCols.map((c) => `<td>${esc(s.answers?.[c] ?? "")}</td>`).join("")}
          <td><form method="post" action="/forms/submissions/${esc(s.id)}/toggle" style="margin:0"><button class="secondary" style="margin:0; padding:4px 10px; font-size:12px">${s.status === "done" ? "✅ Ishlangan" : "🆕 Yangi"}</button></form></td>
        </tr>`).join("")}</tbody></table>` : `<p class="hint" style="text-align:center; padding:24px">Hali ariza yo'q</p>`}
    </div>`;

  res.send(
    page(
      "Lid formalari",
      `${req.query.saved ? `<div class="ok">Saqlandi ✅</div>` : ""}
      ${req.query.error ? `<div class="error">${esc(req.query.error)}</div>` : ""}
      <div style="display:flex; gap:6px; margin-bottom:16px">
        <a class="btn ${tab === "forms" ? "" : "secondary"}" href="/forms" style="margin:0; padding:7px 14px; font-size:13px">📝 Formalar (${f.list.length})</a>
        <a class="btn ${tab === "submissions" ? "" : "secondary"}" href="/forms?tab=submissions" style="margin:0; padding:7px 14px; font-size:13px">📥 Arizalar (${f.submissions.length})</a>
      </div>
      ${tab === "forms" ? formsTab : subsTab}`,
      { user: u, active: "forms" }
    )
  );
});

function saveForm(req, res, existing) {
  const f = ensureForms(req.user);
  const form = sanitizeForm(req.body, existing || {});
  if (!form.fields.length) return res.redirect(`/forms?error=${encodeURIComponent("Kamida bitta to'g'ri savol qo'shing (variantli savolda 2+ variant)")}${existing ? `&edit=${existing.id}` : ""}`);
  if (existing) f.list[f.list.indexOf(existing)] = form;
  else f.list.unshift(form);
  persist(req.user);
  res.redirect("/forms?saved=1");
}

formsRouter.post("/forms", requireAuth, (req, res) => saveForm(req, res, null));

formsRouter.post("/forms/:id", requireAuth, (req, res) => {
  const existing = ensureForms(req.user).list.find((x) => x.id === req.params.id);
  if (!existing) return res.redirect("/forms");
  saveForm(req, res, existing);
});

formsRouter.post("/forms/:id/toggle", requireAuth, (req, res) => {
  const form = ensureForms(req.user).list.find((x) => x.id === req.params.id);
  if (form) { form.active = form.active === false; persist(req.user); }
  res.redirect("/forms");
});

formsRouter.post("/forms/:id/delete", requireAuth, (req, res) => {
  const f = ensureForms(req.user);
  f.list = f.list.filter((x) => x.id !== req.params.id);
  persist(req.user);
  res.redirect("/forms");
});

formsRouter.post("/forms/submissions/:id/toggle", requireAuth, (req, res) => {
  const s = ensureForms(req.user).submissions.find((x) => x.id === req.params.id);
  if (s) { s.status = s.status === "done" ? "new" : "done"; persist(req.user); }
  res.redirect("back");
});

formsRouter.get("/forms/export.csv", requireAuth, (req, res) => {
  const f = ensureForms(req.user);
  const filter = String(req.query.form || "");
  const subs = f.submissions.filter((s) => !filter || s.formId === filter);
  const cols = [...new Set(subs.flatMap((s) => Object.keys(s.answers || {})))];
  // Excel formula injection himoyasi: =,+,-,@ bilan boshlangan qiymatlar oldiga ' qo'yiladi
  const cell = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = [["Sana", "Forma", "Kanal", "Kontakt", ...cols, "Holat"].map(cell).join(",")];
  for (const s of subs) {
    rows.push([s.at, s.formName, s.channel, displayName(req.user, s.key), ...cols.map((c) => s.answers?.[c] ?? ""), s.status].map(cell).join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="arizalar-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send("﻿" + rows.join("\n"));
});
