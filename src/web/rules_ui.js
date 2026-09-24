/**
 * ChatPlace.io uslubidagi Automation Rules Studio (/triggers)
 * Triggerlar: komment, story mention, story reply, DM kalit so'z.
 * Moslik: kalit so'zlar (vergul bilan bir nechta), aniq, regex yoki AI (ma'no bo'yicha).
 * Amallar: follower gate + eslatma, havola tugmalari, teglar, kechiktirilgan follow-up.
 */

import { Router } from "express";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { persist } from "../db.js";
import { ensureRules, addRule, updateRule, deleteRule, sanitizeRuleExtras, buttonsToText } from "../rules.js";

export const rulesRouter = Router();

const TYPES = {
  comment_to_dm: "💬 Comment-to-DM",
  story_mention: "🌟 Story Mention",
  story_reply: "🗨️ Story Reply",
  keyword_dm: "✉️ Direct Keyword",
};

const MATCH_TYPES = {
  contains: "O'z ichiga oladi (Contains)",
  exact: "Aniq moslik (Exact)",
  ai: "🧠 AI trigger — ma'no bo'yicha",
  regex: "Regex (murakkab shablon)",
  any: "Har qanday matn (*)",
};

const pill = (bg, color, border, text) =>
  `<span class="status-tag" style="background:${bg}; color:${color}; border:1px solid ${border}">${text}</span>`;

function ruleStats(r) {
  const s = r.stats || {};
  const triggered = s.triggered || 0;
  const sent = s.sent || 0;
  const conv = triggered ? Math.round((sent / triggered) * 100) : 0;
  const cell = (label, value, color = "#fff") =>
    `<div style="flex:1; min-width:70px; background:rgba(255,255,255,0.03); border-radius:8px; padding:6px 10px">
      <div class="hint" style="font-size:11px">${label}</div><b style="color:${color}">${value}</b>
    </div>`;
  return `<div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap">
    ${cell("Ishga tushdi", triggered)}
    ${cell("Yuborildi", sent, "#34d399")}
    ${r.requireFollow ? cell("Obuna bo'ldi", s.gatePassed || 0, "#f472b6") + cell("Obunasiz", s.gateBlocked || 0, "#94a3b8") : ""}
    ${cell("Konversiya", `${conv}%`, "#a78bfa")}
  </div>`;
}

function ruleCard(r) {
  const publicCount = Array.isArray(r.publicReplies) ? r.publicReplies.length : r.publicReply ? 1 : 0;
  const keywordLine =
    r.matchType === "ai"
      ? `<div><span class="hint">🧠 AI trigger:</span> <i style="color:#c4b5fd">${esc(r.aiIntent || r.name)}</i></div>`
      : r.keyword
        ? `<div><span class="hint">Kalit so'z:</span> <code style="background:#0f172a; padding:3px 8px; border-radius:6px; color:#a78bfa">${esc(r.keyword)}</code> <span class="hint">(${esc(r.matchType || "contains")})</span></div>`
        : "";

  return `
    <div class="card" style="margin-bottom:16px; border-left:4px solid ${r.enabled ? "#4ade80" : "#64748b"}; background:var(--bg-card)">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px">
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap">
          ${pill("rgba(124,58,237,0.2)", "#c4b5fd", "rgba(124,58,237,0.4)", TYPES[r.type] || TYPES.keyword_dm)}
          ${r.requireFollow ? pill("rgba(236,72,153,0.15)", "#f472b6", "rgba(236,72,153,0.3)", "🔒 Obuna shart") : ""}
          ${r.requireFollow && (r.reminderDelayMin ?? 45) > 0 ? pill("rgba(250,204,21,0.12)", "#facc15", "rgba(250,204,21,0.3)", `⏰ Eslatma ${r.reminderDelayMin ?? 45} daq`) : ""}
          ${r.followUpText ? pill("rgba(56,189,248,0.12)", "#38bdf8", "rgba(56,189,248,0.3)", `📨 Follow-up ${r.followUpDelayMin || 60} daq`) : ""}
          ${publicCount > 1 ? pill("rgba(16,185,129,0.15)", "#34d399", "rgba(16,185,129,0.3)", `🎲 ${publicCount} xil javob`) : ""}
          <b style="font-size:16px; color:#fff">${esc(r.name)}</b>
        </div>
        <div style="display:flex; gap:8px">
          <a href="/triggers/edit/${encodeURIComponent(r.id)}" class="btn secondary" style="padding:5px 12px; font-size:12px; margin:0">✏️ Tahrirlash</a>
          <form method="post" action="/triggers/toggle" style="margin:0">
            <input type="hidden" name="id" value="${esc(r.id)}">
            <button type="submit" class="secondary" style="padding:5px 12px; font-size:12px; margin:0">${r.enabled ? "✅ Faol" : "⏸️ O'chiq"}</button>
          </form>
          <form method="post" action="/triggers/delete" style="margin:0" onsubmit="return confirm('Qoidani o\\'chirishga ishonchingiz komilmi?')">
            <input type="hidden" name="id" value="${esc(r.id)}">
            <button type="submit" class="secondary" style="padding:5px 10px; font-size:12px; margin:0; color:#f87171">🗑️</button>
          </form>
        </div>
      </div>

      <div style="margin-top:12px; font-size:13.5px; display:flex; gap:16px; flex-wrap:wrap">
        ${keywordLine}
        ${r.targetMediaId && r.targetMediaId !== "*"
          ? `<div><span class="hint">Post ID:</span> <code style="background:#0f172a; padding:3px 8px; border-radius:6px; color:#38bdf8">${esc(r.targetMediaId)}</code></div>`
          : r.type === "comment_to_dm" ? `<div><span class="hint">Qamrov:</span> <span style="color:#94a3b8">Barcha postlar</span></div>` : ""}
        ${r.tags?.length ? `<div><span class="hint">Teglar:</span> ${r.tags.map((t) => `<code style="background:#0f172a; padding:2px 6px; border-radius:6px; color:#fbbf24">#${esc(t)}</code>`).join(" ")}</div>` : ""}
      </div>

      ${r.privateReply
        ? `<div style="margin-top:10px; font-size:13.5px; background:rgba(124,58,237,0.1); padding:8px 12px; border-radius:8px"><b>📥 DM javob:</b> <i style="color:#f8fafc">"${esc(r.privateReply)}"</i>
            ${r.buttons?.length ? `<div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap">${r.buttons.map((b) => `<span style="background:#1e293b; border:1px solid #334155; padding:3px 10px; border-radius:6px; font-size:12px">🔗 ${esc(b.title)}</span>`).join("")}</div>` : ""}
          </div>`
        : ""}
      ${ruleStats(r)}
    </div>`;
}

/** Yangi qoida va tahrirlash uchun umumiy forma. */
function ruleForm(r = {}, { action, submitLabel }) {
  const v = (x) => esc(x ?? "");
  const sel = (a, b) => (a === b ? "selected" : "");
  const matchType = r.matchType || "contains";
  const publicReplies = (r.publicReplies?.length ? r.publicReplies : r.publicReply ? [r.publicReply] : []).join("\n");
  const reminderDelay = r.reminderDelayMin ?? 45;

  return `
    <form method="post" action="${action}">
      ${r.id ? `<input type="hidden" name="id" value="${v(r.id)}">` : ""}
      <label>Qoida nomi</label>
      <input type="text" name="name" value="${v(r.name)}" placeholder="Masalan: 🎁 Reels sovg'a (obuna shart)" required>

      <label>Trigger (qachon ishga tushadi)</label>
      <select name="type">
        ${Object.entries(TYPES).map(([k, label]) => `<option value="${k}" ${sel(r.type || "comment_to_dm", k)}>${label}</option>`).join("")}
      </select>

      <label>Moslik turi</label>
      <select name="matchType">
        ${Object.entries(MATCH_TYPES).map(([k, label]) => `<option value="${k}" ${sel(matchType, k)}>${label}</option>`).join("")}
      </select>

      <label>Kalit so'zlar — vergul bilan bir nechta (barchasi uchun *)</label>
      <input type="text" name="keyword" value="${v(r.keyword ?? "*")}" placeholder="narx, price, цена, sovg'a">
      <p class="hint" style="margin:4px 0 0; font-size:12px">"sovg'a", "sovg‘a", "sovg\`a" — apostrof turidan qat'i nazar bir xil qabul qilinadi.</p>

      <label>🧠 AI trigger tavsifi (moslik turi "AI" bo'lsa)</label>
      <input type="text" name="aiIntent" value="${v(r.aiIntent)}" placeholder="Mijoz narx, to'lov yoki yetkazib berish haqida so'rayapti">
      <p class="hint" style="margin:4px 0 0; font-size:12px">Kalit so'z kerak emas: "qancha turadi?", "сколько стоит", "price?" — hammasini AI shu qoidaga yo'naltiradi.</p>

      <div style="background:rgba(236,72,153,0.1); border:1px solid rgba(236,72,153,0.3); border-radius:10px; padding:12px; margin:14px 0">
        <label style="display:flex; align-items:center; gap:8px; margin:0; cursor:pointer; font-weight:700; color:#f472b6">
          <input type="checkbox" name="requireFollow" value="true" ${r.requireFollow ? "checked" : ""} style="width:auto; margin:0">
          🔒 Follower Gate: faqat obunachilarga
        </label>
        <label style="font-size:12px">Obuna bo'lmaganlarga xabar</label>
        <textarea name="notFollowingMessage" rows="2" style="font-size:12.5px" placeholder="Sovg'ani olish uchun avval sahifamizga obuna bo'ling! 👇">${v(r.notFollowingMessage)}</textarea>
        <label style="font-size:12px">Tugma matni</label>
        <input type="text" name="notFollowingButton" value="${v(r.notFollowingButton || "Obuna bo'ldim ✅")}" maxlength="20">
        <label style="font-size:12px">⏰ Eslatma: necha daqiqadan so'ng (0 — o'chiq)</label>
        <input type="number" name="reminderDelayMin" min="0" max="1380" value="${v(reminderDelay)}">
        <label style="font-size:12px">Eslatma matni (bo'sh bo'lsa standart matn)</label>
        <textarea name="reminderText" rows="2" style="font-size:12.5px" placeholder="Sovg'angiz hali ham sizni kutyapti 🎁 Obuna bo'ling va tugmani bosing!">${v(r.reminderText)}</textarea>
        <p class="hint" style="margin:6px 0 0; font-size:12px">Obuna bo'lmay ketgan mijozga avtomatik eslatma — tashlab ketilgan lidlarning bir qismini qaytaradi.</p>
      </div>

      <label>Aniq Post / Reels ID (hamma postlar uchun *)</label>
      <input type="text" name="targetMediaId" value="${v(r.targetMediaId || "*")}">

      <label>💬 Ochiq komment javoblari (har qatorda bitta — tasodifiy tanlanadi)</label>
      <textarea name="publicReplies" rows="3" placeholder="Direct'ga yubordik! 📥&#10;Direct'ni tekshiring ✨">${v(publicReplies)}</textarea>

      <label>📥 DM javob / sovg'a matni</label>
      <textarea name="privateReply" rows="3" required placeholder="Direct'ga yuboriladigan sovg'a, katalog yoki havola...">${v(r.privateReply)}</textarea>

      <label>🔗 Havola tugmalari (har qatorda: Nomi | https://havola, max 3)</label>
      <textarea name="buttons" rows="2" placeholder="Katalog | https://example.uz/katalog&#10;Sayt | https://example.uz">${v(buttonsToText(r.buttons))}</textarea>

      <label>🏷️ Kontaktga teglar (vergul bilan)</label>
      <input type="text" name="tags" value="${v((r.tags || []).join(", "))}" placeholder="lid, reels-sovga">

      <div style="background:rgba(56,189,248,0.08); border:1px solid rgba(56,189,248,0.3); border-radius:10px; padding:12px; margin:14px 0">
        <b style="color:#38bdf8">📨 Follow-up xabar</b>
        <p class="hint" style="margin:4px 0 8px; font-size:12px">Sovg'a yuborilgach avtomatik qo'shimcha xabar (masalan chegirma yoki fikr so'rash). Bo'sh — o'chiq.</p>
        <textarea name="followUpText" rows="2" style="font-size:12.5px" placeholder="Katalog yoqdimi? 😊 Bugun buyurtma bersangiz −10% chegirma!">${v(r.followUpText)}</textarea>
        <label style="font-size:12px">Necha daqiqadan so'ng</label>
        <input type="number" name="followUpDelayMin" min="1" max="1380" value="${v(r.followUpDelayMin || 60)}">
      </div>

      <button type="submit" class="btn" style="width:100%; margin-top:16px; background:linear-gradient(135deg,#7c3aed,#db2777)">${submitLabel}</button>
    </form>`;
}

/** Forma ma'lumotlarini qoida maydonlariga aylantiradi (qo'shish va tahrirlash uchun). */
function ruleFromBody(body = {}) {
  const publicReplies = String(body.publicReplies || body.publicReply || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 15);
  const type = TYPES[body.type] ? body.type : "comment_to_dm";
  const matchType = MATCH_TYPES[body.matchType] ? body.matchType : "contains";
  return {
    name: String(body.name || "Yangi qoida").trim().slice(0, 120),
    type,
    matchType,
    keyword: String(body.keyword || "*").trim().slice(0, 500) || "*",
    targetMediaId: String(body.targetMediaId || "*").trim() || "*",
    requireFollow: body.requireFollow === "true" || body.requireFollow === "on",
    notFollowingMessage: String(body.notFollowingMessage || "").trim().slice(0, 1000),
    notFollowingButton: String(body.notFollowingButton || "Obuna bo'ldim ✅").trim().slice(0, 20),
    publicReplies,
    publicReply: publicReplies[0] || "",
    privateReply: String(body.privateReply || "").trim().slice(0, 2000),
    ...sanitizeRuleExtras(body),
  };
}

rulesRouter.get("/triggers", requireAuth, (req, res) => {
  const u = req.user;
  const rules = ensureRules(u);
  const filterType = TYPES[req.query.type] ? req.query.type : "all";
  u.settings ||= {};
  const autoLikeOn = Boolean(u.settings.autoLikeComments);
  const filtered = filterType === "all" ? rules : rules.filter((r) => r.type === filterType);

  const totals = rules.reduce(
    (acc, r) => ({ triggered: acc.triggered + (r.stats?.triggered || 0), sent: acc.sent + (r.stats?.sent || 0) }),
    { triggered: 0, sent: 0 }
  );
  const pendingReminders = (u.followUps || []).length;

  const tab = (key, label) =>
    `<a href="/triggers?type=${key}" class="btn ${filterType === key ? "" : "secondary"}" style="padding:8px 16px; font-size:13px; margin:0">${label}</a>`;

  res.send(
    page(
      "Triggers & Qoidalar",
      `
      ${req.query.saved ? `<div class="ok">Qoida saqlandi ✅</div>` : ""}

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px">
        <div>
          <h2>🎯 Flows & Triggers</h2>
          <p class="hint">Komment, Story va Direct orqali obunachi va mijozlarni avtomatik voronkaga olib kirish.</p>
        </div>
        <a href="/templates" class="btn" style="background:linear-gradient(135deg,#8b5cf6,#ec4899); font-size:13px; padding:8px 16px">🎨 Tayyor shablonlar ➔</a>
      </div>

      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:20px">
        <div class="card" style="margin:0"><div class="hint">Faol qoidalar</div><b style="font-size:22px">${rules.filter((r) => r.enabled).length}/${rules.length}</b></div>
        <div class="card" style="margin:0"><div class="hint">Ishga tushdi</div><b style="font-size:22px">${totals.triggered}</b></div>
        <div class="card" style="margin:0"><div class="hint">Yuborildi</div><b style="font-size:22px; color:#34d399">${totals.sent}</b></div>
        <div class="card" style="margin:0"><div class="hint">Navbatdagi xabarlar</div><b style="font-size:22px; color:#38bdf8">${pendingReminders}</b></div>
      </div>

      <div class="card" style="margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; border:1px solid ${autoLikeOn ? "#ec4899" : "var(--border)"}">
        <div>
          <b style="color:#fff; font-size:15px">❤️ Kommentlarga avtomatik layk</b>
          <p class="hint" style="margin:4px 0 0; font-size:12.5px">Har bir kommentga biznes akkauntingiz nomidan layk bosiladi.</p>
        </div>
        <form method="post" action="/triggers/auto-like" style="margin:0">
          <button type="submit" class="${autoLikeOn ? "" : "secondary"}" style="padding:8px 18px; font-size:13px; margin:0; ${autoLikeOn ? "background:#ec4899; border:0" : ""}">${autoLikeOn ? "❤️ Yoqilgan" : "🤍 O'chirilgan"}</button>
        </form>
      </div>

      <div style="display:flex; gap:8px; margin-bottom:20px; flex-wrap:wrap">
        ${tab("all", `Barchasi (${rules.length})`)}
        ${Object.entries(TYPES).map(([k, label]) => tab(k, label)).join("")}
      </div>

      <div class="grid split-form">
        <div>
          ${filtered.length ? filtered.map(ruleCard).join("") : `<div class="card hint" style="text-align:center; padding:40px">Bu bo'limda hali qoida yo'q.</div>`}
        </div>
        <div class="card" style="height:fit-content; border:1px solid #7c3aed; background:#131b2e">
          <h3 style="margin-top:0; font-size:18px; color:#fff">➕ Yangi qoida</h3>
          ${ruleForm({}, { action: "/triggers/add", submitLabel: "💾 Qoidani saqlash" })}
        </div>
      </div>
      `,
      { user: u, active: "triggers" }
    )
  );
});

rulesRouter.get("/triggers/edit/:id", requireAuth, (req, res) => {
  const rule = ensureRules(req.user).find((r) => r.id === req.params.id);
  if (!rule) return res.redirect("/triggers");
  res.send(
    page(
      "Qoidani tahrirlash",
      `<p><a href="/triggers">← Barcha qoidalar</a></p>
      <div class="card" style="max-width:720px; border:1px solid #7c3aed; background:#131b2e">
        <h3 style="margin-top:0; color:#fff">✏️ ${esc(rule.name)}</h3>
        ${ruleStats(rule)}
        <div style="margin-top:16px">${ruleForm(rule, { action: "/triggers/update", submitLabel: "💾 O'zgarishlarni saqlash" })}</div>
      </div>`,
      { user: req.user, active: "triggers" }
    )
  );
});

rulesRouter.post("/triggers/add", requireAuth, (req, res) => {
  addRule(req.user, ruleFromBody(req.body));
  res.redirect("/triggers?saved=1");
});

rulesRouter.post("/triggers/update", requireAuth, (req, res) => {
  const id = String(req.body?.id || "");
  if (!updateRule(req.user, id, ruleFromBody(req.body))) return res.redirect("/triggers");
  res.redirect("/triggers?saved=1");
});

rulesRouter.post("/triggers/toggle", requireAuth, (req, res) => {
  const { id } = req.body || {};
  const rule = ensureRules(req.user).find((r) => r.id === id);
  if (rule) updateRule(req.user, id, { enabled: !rule.enabled });
  res.redirect("/triggers");
});

rulesRouter.post("/triggers/delete", requireAuth, (req, res) => {
  const { id } = req.body || {};
  deleteRule(req.user, id);
  res.redirect("/triggers");
});

rulesRouter.post("/triggers/auto-like", requireAuth, (req, res) => {
  const u = req.user;
  u.settings ||= {};
  u.settings.autoLikeComments = !u.settings.autoLikeComments;
  persist(u);
  res.redirect("/triggers");
});
