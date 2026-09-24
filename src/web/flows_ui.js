/**
 * Vizual Flow Builder (/flows) — ChatPlace "Automation Builder" ekvivalenti.
 *  - /flows              — flow'lar ro'yxati, statistika, tayyor shablonlar, AI bilan yaratish
 *  - /flows/:id          — vizual muharrir (bloklarni sudrash, ulash, tahrirlash)
 *  - /flows/:id/save     — JSON saqlash (muharrir chaqiradi)
 *  - /ai/rewrite         — xabarni AI bilan qayta yozish (muharrir va boshqa formalarda)
 */
import { Router } from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { persist } from "../db.js";
import {
  ensureFlows, findFlow, sanitizeFlow, newId,
  TRIGGER_TYPES, MATCH_TYPES, NODE_TYPES, CONDITION_KINDS, ACTION_KINDS, INPUT_VALIDATIONS,
} from "../flows.js";
import { FLOW_TEMPLATES, buildTemplate, autoLayout, AI_FLOW_PROMPT } from "../flowTemplates.js";
import { generateText, aiAvailable } from "../ai.js";
import { allTags } from "../contacts.js";

export const flowsRouter = Router();

const assetsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets");
const builderJs = readFileSync(path.join(assetsDir, "flow-builder.js"), "utf8");

flowsRouter.get("/assets/flow-builder.js", (_req, res) => {
  res.type("application/javascript");
  res.setHeader("Cache-Control", "no-cache");
  res.send(builderJs);
});

/** <script type="application/json"> ichiga xavfsiz joylash uchun JSON. */
function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

const SHORT_LABELS = { message: "💬 Xabar", input: "📝 Savol", condition: "🔀 Shart", action: "⚡ Amal", delay: "⏱️ Kutish", ai: "🧠 AI", redirect: "↪️ O'tish" };

function flowSummary(flow) {
  const s = flow.stats || {};
  const conv = s.started ? Math.round(((s.conversions || 0) / s.started) * 100) : 0;
  const triggers = (flow.triggers || []).map((t) => TRIGGER_TYPES[t.type] || t.type);
  return { conv, triggers, nodes: Object.keys(flow.nodes || {}).length, s };
}

flowsRouter.get("/flows", requireAuth, async (req, res) => {
  const u = req.user;
  const { list } = ensureFlows(u);
  const hasAi = await aiAvailable(u);
  const error = String(req.query.error || "");

  const cards = list.length
    ? list
        .map((f) => {
          const { conv, triggers, nodes, s } = flowSummary(f);
          return `
          <div class="card flow-card" style="border-left:4px solid ${f.enabled ? "#4ade80" : "#64748b"}">
            <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start">
              <div style="min-width:0">
                <a href="/flows/${encodeURIComponent(f.id)}" style="font-size:17px; font-weight:800; color:#fff">${esc(f.name)}</a>
                <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px">
                  ${triggers.map((t) => `<span class="status-tag" style="font-size:11.5px">${esc(t)}</span>`).join("") || `<span class="hint">Trigger yo'q — faqat boshqa flow yoki ice breaker orqali</span>`}
                  <span class="status-tag" style="font-size:11.5px">🧩 ${nodes} blok</span>
                </div>
              </div>
              <div style="display:flex; gap:6px; flex-wrap:wrap">
                <a class="btn" href="/flows/${encodeURIComponent(f.id)}" style="padding:6px 14px; font-size:12.5px; margin:0">✏️ Muharrir</a>
                <form method="post" action="/flows/${encodeURIComponent(f.id)}/toggle" style="margin:0"><button class="secondary" style="padding:6px 12px; font-size:12.5px; margin:0">${f.enabled ? "✅ Faol" : "⏸️ O'chiq"}</button></form>
                <form method="post" action="/flows/${encodeURIComponent(f.id)}/duplicate" style="margin:0"><button class="secondary" style="padding:6px 12px; font-size:12.5px; margin:0" title="Nusxa">⧉</button></form>
                <form method="post" action="/flows/${encodeURIComponent(f.id)}/delete" style="margin:0" onsubmit="return confirm('Flow o\\'chirilsinmi?')"><button class="secondary" style="padding:6px 10px; font-size:12.5px; margin:0; color:#f87171">🗑️</button></form>
              </div>
            </div>
            <div class="flow-stats">
              <div><span>Boshlandi</span><b>${s.started || 0}</b></div>
              <div><span>Yakunlandi</span><b>${s.completed || 0}</b></div>
              <div><span>Konversiya</span><b style="color:#34d399">${s.conversions || 0}</b></div>
              <div><span>CR</span><b style="color:#a78bfa">${conv}%</b></div>
            </div>
          </div>`;
        })
        .join("")
    : `<div class="card" style="text-align:center; padding:40px">
        <div style="font-size:40px">🧩</div>
        <h3>Hali flow yo'q</h3>
        <p class="hint">O'ngdagi tayyor shablondan boshlang yoki AI'ga nima kerakligini yozing.</p>
      </div>`;

  res.send(
    page(
      "Flow Builder",
      `
      <style>
        .flow-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-top:12px }
        .flow-stats div { background:rgba(255,255,255,0.03); border-radius:8px; padding:6px 10px }
        .flow-stats span { display:block; font-size:11px; color:var(--text-muted) }
        .tpl-btn { width:100%; text-align:left; margin:0 0 8px; padding:10px 14px }
      </style>
      ${error ? `<div class="error">${esc(error)}</div>` : ""}
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:18px">
        <div>
          <h2 style="margin:0">🧩 Flow Builder</h2>
          <p class="hint" style="margin:4px 0 0">Ko'p bosqichli voronkalar: xabar → shart → amal → kutish. Komment, story, Direct, jonli efir va referal havolalardan ishga tushadi.</p>
        </div>
        <a class="btn secondary" href="/analytics" style="margin:0">📊 Analitika</a>
      </div>
      <div class="grid split-form">
        <div>${cards}</div>
        <div>
          <div class="card" style="border:1px solid #7c3aed">
            <h3 style="margin-top:0">✨ AI bilan yaratish</h3>
            <form method="post" action="/flows/ai-generate">
              <textarea name="description" rows="4" maxlength="1500" required placeholder="Masalan: Reels ostida 'KURS' deb yozganlarga obunani tekshirib, bepul darsni yuborsin, keyin ism va telefonini so'rasin va menejerga xabar bersin"></textarea>
              <button class="btn" style="width:100%; margin-top:10px" ${hasAi ? "" : "disabled title='AI kaliti sozlanmagan'"}>✨ Flow yaratish</button>
              ${hasAi ? "" : `<p class="hint" style="font-size:12px">AI kaliti sozlanmagan — admin panelda Gemini kalitini kiriting.</p>`}
            </form>
          </div>
          <div class="card">
            <h3 style="margin-top:0">📦 Tayyor shablonlar</h3>
            ${Object.entries(FLOW_TEMPLATES)
              .map(
                ([k, name]) => `<form method="post" action="/flows/create" style="margin:0">
                  <input type="hidden" name="template" value="${esc(k)}">
                  <button class="secondary tpl-btn">${esc(name)}</button>
                </form>`
              )
              .join("")}
          </div>
        </div>
      </div>`,
      { user: u, active: "flows" }
    )
  );
});

flowsRouter.post("/flows/create", requireAuth, (req, res) => {
  const flow = buildTemplate(String(req.body?.template || "empty"));
  ensureFlows(req.user).list.unshift(flow);
  persist(req.user);
  res.redirect(`/flows/${encodeURIComponent(flow.id)}`);
});

flowsRouter.post("/flows/ai-generate", requireAuth, async (req, res) => {
  const description = String(req.body?.description || "").trim().slice(0, 1500);
  if (!description) return res.redirect("/flows");
  try {
    const u = req.user;
    const context = `Business: ${u.businessName || "-"}\nAbout: ${String(u.businessInfo || "").slice(0, 1500)}\n\nOwner's request: ${description}`;
    const raw = await generateText(u, AI_FLOW_PROMPT, context, { json: true, maxOutputTokens: 4096, temperature: 0.4 });
    const flow = autoLayout(sanitizeFlow({ ...raw, enabled: false }));
    if (!Object.keys(flow.nodes).length) throw new Error("AI bo'sh flow qaytardi, so'rovni aniqroq yozing.");
    ensureFlows(u).list.unshift(flow);
    persist(u);
    res.redirect(`/flows/${encodeURIComponent(flow.id)}?ai=1`);
  } catch (err) {
    console.error("[Flow AI]", err.message);
    res.redirect(`/flows?error=${encodeURIComponent(err.message)}`);
  }
});

flowsRouter.post("/flows/:id/toggle", requireAuth, (req, res) => {
  const flow = findFlow(req.user, req.params.id);
  if (flow) {
    flow.enabled = !flow.enabled;
    persist(req.user);
  }
  res.redirect(req.get("referer")?.includes(`/flows/${req.params.id}`) ? `/flows/${encodeURIComponent(req.params.id)}` : "/flows");
});

flowsRouter.post("/flows/:id/duplicate", requireAuth, (req, res) => {
  const flow = findFlow(req.user, req.params.id);
  if (flow) {
    const copy = sanitizeFlow({ ...JSON.parse(JSON.stringify(flow)), id: newId("flow"), name: `${flow.name} (nusxa)`, enabled: false });
    copy.stats = { started: 0, completed: 0, conversions: 0, daily: {}, nodes: {} };
    ensureFlows(req.user).list.unshift(copy);
    persist(req.user);
  }
  res.redirect("/flows");
});

flowsRouter.post("/flows/:id/delete", requireAuth, (req, res) => {
  const f = ensureFlows(req.user);
  f.list = f.list.filter((fl) => fl.id !== req.params.id);
  for (const [key, s] of Object.entries(f.sessions)) if (s.flowId === req.params.id) delete f.sessions[key];
  persist(req.user);
  res.redirect("/flows");
});

flowsRouter.post("/flows/:id/save", requireAuth, (req, res) => {
  const flows = ensureFlows(req.user);
  const idx = flows.list.findIndex((fl) => fl.id === req.params.id);
  if (idx < 0) return res.status(404).json({ ok: false, error: "Flow topilmadi" });
  const saved = sanitizeFlow({ ...req.body, id: flows.list[idx].id }, flows.list[idx]);
  flows.list[idx] = saved;
  persist(req.user);
  res.json({ ok: true, flow: saved });
});

flowsRouter.get("/flows/:id", requireAuth, async (req, res) => {
  const u = req.user;
  const flow = findFlow(u, req.params.id);
  if (!flow) return res.redirect("/flows");
  const meta = {
    triggerTypes: TRIGGER_TYPES,
    matchTypes: MATCH_TYPES,
    nodeTypes: NODE_TYPES,
    conditionKinds: CONDITION_KINDS,
    actionKinds: ACTION_KINDS,
    inputValidations: INPUT_VALIDATIONS,
    otherFlows: ensureFlows(u).list.filter((f) => f.id !== flow.id).map((f) => ({ id: f.id, name: f.name })),
    tags: allTags(u).map(([t]) => t).slice(0, 100),
    ai: await aiAvailable(u),
  };

  res.send(
    page(
      `Flow: ${flow.name}`,
      `
      <style>
        main.app { margin: 0 !important; padding: 0 !important; }
        .fb { display:grid; grid-template-columns: 1fr 360px; height: calc(100vh - 64px); min-height: 520px; }
        .fb-canvas-wrap { position:relative; overflow:hidden; background-color:#0a0e18;
          background-image: radial-gradient(rgba(148,163,184,0.18) 1px, transparent 1px); background-size: 22px 22px; touch-action:none; }
        .fb-toolbar { position:absolute; top:12px; left:12px; right:12px; z-index:5; display:flex; gap:6px; flex-wrap:wrap; align-items:center; pointer-events:none }
        .fb-toolbar > * { pointer-events:auto }
        .fb-toolbar button, .fb-toolbar a.btn { margin:0; padding:6px 10px; font-size:12px; white-space:nowrap }
        .fb-add-group { display:flex; gap:4px; flex-wrap:wrap; background:rgba(15,23,42,0.85); border:1px solid var(--border); border-radius:10px; padding:4px }
        .fb-add-group button { background:transparent; border:0; box-shadow:none }
        .fb-add-group button:hover { background:rgba(139,92,246,0.2) }
        .fb-status { margin-left:auto; font-size:12px; padding:6px 10px; border-radius:8px; background:rgba(15,23,42,0.85); border:1px solid var(--border) }
        .fb-canvas { position:absolute; left:0; top:0; transform-origin:0 0; }
        .fb-edges { position:absolute; left:0; top:0; overflow:visible; pointer-events:none }
        .fb-edges path { fill:none; stroke:#7c3aed; stroke-width:2.2; opacity:.85 }
        .fb-edges path.yes { stroke:#34d399 } .fb-edges path.no { stroke:#f87171 } .fb-edges path.btn { stroke:#38bdf8 }
        .fb-edges path.drag { stroke-dasharray:6 6; stroke:#e2e8f0 }
        .fb-node { position:absolute; width:260px; background:#151d30; border:1.5px solid rgba(255,255,255,0.1); border-radius:14px;
          box-shadow:0 10px 30px -10px rgba(0,0,0,.7); user-select:none; cursor:grab }
        .fb-node.sel { border-color:#a78bfa; box-shadow:0 0 0 3px rgba(139,92,246,.35) }
        .fb-node.drop { border-color:#38bdf8 }
        .fb-node header { display:flex; align-items:center; gap:6px; padding:8px 12px; border-bottom:1px solid rgba(255,255,255,0.06); font-weight:800; font-size:13px }
        .fb-node header .cnt { margin-left:auto; font-size:11px; color:var(--text-muted); font-weight:600 }
        .fb-node .body { padding:8px 12px 10px; font-size:12.5px; color:#cbd5e1; white-space:pre-wrap; word-break:break-word; max-height:110px; overflow:hidden }
        .fb-node .start { position:absolute; top:-11px; left:12px; background:#10b981; color:#04130d; font-size:10.5px; font-weight:800; padding:1px 8px; border-radius:999px }
        .fb-node .in { position:absolute; left:-8px; top:18px; width:14px; height:14px; border-radius:50%; background:#0b0f19; border:2px solid #64748b }
        .fb-outs { padding:0 12px 10px; display:flex; flex-direction:column; gap:5px }
        .fb-out { position:relative; display:flex; align-items:center; justify-content:space-between; font-size:11.5px; background:rgba(255,255,255,0.04); border-radius:7px; padding:4px 22px 4px 8px; color:#e2e8f0 }
        .fb-out .port { position:absolute; right:-15px; top:50%; transform:translateY(-50%); width:14px; height:14px; border-radius:50%; background:#7c3aed; border:2px solid #0b0f19; cursor:crosshair }
        .fb-out.yes .port { background:#34d399 } .fb-out.no .port { background:#f87171 } .fb-out.btn .port { background:#38bdf8 }
        .fb-out.url { padding-right:8px }
        .t-message header { color:#c4b5fd } .t-input header { color:#fbbf24 } .t-condition header { color:#34d399 }
        .t-action header { color:#f472b6 } .t-delay header { color:#38bdf8 } .t-ai header { color:#a78bfa } .t-redirect header { color:#94a3b8 }
        .fb-side { background:#0f1628; border-left:1px solid var(--border); overflow-y:auto; padding:16px }
        .fb-side h3 { margin:0 0 10px; font-size:16px }
        .fb-side label { font-size:12px; margin-top:10px }
        .fb-side textarea, .fb-side input, .fb-side select { font-size:13px }
        .fb-row { display:flex; gap:6px; align-items:center }
        .fb-row > * { flex:1; min-width:0 }
        .fb-item { background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:10px; padding:10px; margin-top:8px }
        .fb-x { flex:0 0 auto !important; background:none; border:0; color:#f87171; cursor:pointer; font-size:16px; padding:0 4px; margin:0 }
        .fb-add { width:100%; margin-top:8px; padding:7px; font-size:12.5px }
        .fb-hint { font-size:11.5px; color:var(--text-muted); margin:4px 0 0 }
        .ai-btn { font-size:11.5px; padding:3px 9px; margin:4px 0 0; border-radius:7px }
        .fb-zoom { position:absolute; right:12px; bottom:12px; z-index:5; display:flex; gap:4px }
        .fb-zoom button { margin:0; padding:6px 11px }
        @media (max-width: 960px) { .fb { grid-template-columns: 1fr; height:auto } .fb-canvas-wrap { height:65vh } .fb-side { border-left:0; border-top:1px solid var(--border) } }
      </style>
      <div class="fb">
        <div class="fb-canvas-wrap" id="fbWrap">
          <div class="fb-toolbar">
            <a class="btn secondary" href="/flows">←</a>
            <span class="fb-add-group">
              ${Object.entries(SHORT_LABELS).map(([k, label]) => `<button class="secondary" data-add="${k}" title="${esc(NODE_TYPES[k])} blokini qo'shish">${label}</button>`).join("")}
            </span>
            <span class="fb-status" id="fbStatus">Saqlangan</span>
            <button id="fbSave" class="btn">💾 Saqlash</button>
          </div>
          <div class="fb-canvas" id="fbCanvas"><svg class="fb-edges" id="fbEdges" width="1" height="1"></svg></div>
          <div class="fb-zoom">
            <button class="secondary" data-zoom="-1">−</button>
            <button class="secondary" data-zoom="0">⤢</button>
            <button class="secondary" data-zoom="1">+</button>
          </div>
        </div>
        <aside class="fb-side" id="fbSide"></aside>
      </div>
      <script type="application/json" id="fbData">${safeJson(flow)}</script>
      <script type="application/json" id="fbMeta">${safeJson(meta)}</script>
      <script src="/assets/flow-builder.js"></script>`,
      { user: u, active: "flows" }
    )
  );
});

// ==== AI bilan matnni qayta yozish ====

const REWRITE_MODES = {
  improve: "Make it clearer, more engaging and persuasive. Keep the meaning.",
  shorter: "Make it noticeably shorter while keeping the key message.",
  friendly: "Make it warmer and friendlier, add 1-2 fitting emojis.",
  formal: "Make it polite and professional.",
  sell: "Rewrite it as a persuasive sales message with a clear call to action.",
  fix: "Only fix spelling, grammar and punctuation.",
  uz: "Translate it into Uzbek (Latin script).",
  ru: "Translate it into Russian.",
  en: "Translate it into English.",
};

flowsRouter.post("/ai/rewrite", requireAuth, async (req, res) => {
  const text = String(req.body?.text || "").trim().slice(0, 3000);
  const mode = REWRITE_MODES[req.body?.mode] ? req.body.mode : "improve";
  if (!text) return res.status(400).json({ ok: false, error: "Matn bo'sh" });
  try {
    const system =
      "You edit chatbot messages for a small business. " + REWRITE_MODES[mode] +
      " Keep placeholders like {name}, {name|fallback}, {phone} exactly as they are. " +
      "Unless asked to translate, answer in the same language as the input. Return ONLY the rewritten message text.";
    const out = await generateText(req.user, system, `Business: ${req.user.businessName || "-"}\n\nMessage:\n${text}`, { maxOutputTokens: 1024, temperature: 0.6 });
    res.json({ ok: true, text: String(out || "").trim() });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});
