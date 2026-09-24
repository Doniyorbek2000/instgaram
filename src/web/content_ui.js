/**
 * AI Kontent studiya (/content) — ChatPlace "Virale" ekvivalenti:
 *  - Reels ssenariysi (hook'lar, kadrlar, ekrandagi matn, caption, komment kalit so'zi)
 *  - Karusel (slaydlar brauzerda 1080×1350 PNG qilib chiziladi va yuklab olinadi)
 *  - Post matni + xeshteglar, kontent reja, g'oyalar
 * Barcha natijalar biznes bilim bazasi asosida va tarixda saqlanadi.
 * Reels'dagi komment kalit so'zidan bir bosishda "komment → DM" flow yaratiladi.
 */
import { Router } from "express";
import crypto from "node:crypto";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { persist } from "../db.js";
import { generateText, aiAvailable } from "../ai.js";
import { ensureFlows } from "../flows.js";
import { buildTemplate } from "../flowTemplates.js";

export const contentRouter = Router();

const MAX_ITEMS = 60;

export const TOOLS = {
  reels: {
    label: "🎬 Reels ssenariy",
    schema: `{"title": string, "hooks": [3 strings, first 2 seconds], "scenes": [{"time": "0-3s", "visual": "what is on screen", "voice": "what to say", "onScreenText": "short overlay text"}], "caption": string, "hashtags": [8-15 strings without #], "cta": string, "commentKeyword": "ONE short uppercase word viewers comment to get a DM (e.g. GUIDE)", "dmGift": "what the bot sends in DM for that keyword"}`,
    build: (b) => `Create an Instagram Reels script. Topic: ${b.topic}. Goal: ${b.goal}. Duration: ${b.duration} seconds. Tone: ${b.tone}.`,
  },
  carousel: {
    label: "🖼️ Karusel",
    schema: `{"title": string, "slides": [{"heading": "max 8 words", "body": "max 30 words"}], "caption": string, "hashtags": [8-15 strings without #]}`,
    build: (b) => `Create an Instagram carousel with exactly ${b.slides} slides. Topic: ${b.topic}. Goal: ${b.goal}. Tone: ${b.tone}. Slide 1 is a strong hook cover, last slide is a call to action (save/share/comment keyword).`,
  },
  caption: {
    label: "✍️ Post matni",
    schema: `{"captions": [3 alternative full captions with emojis and line breaks], "hashtags": [15 strings without #], "firstComment": string}`,
    build: (b) => `Write Instagram post captions. Topic: ${b.topic}. Goal: ${b.goal}. Tone: ${b.tone}.`,
  },
  plan: {
    label: "🗓️ Kontent reja",
    schema: `{"plan": [{"day": "1", "format": "Reels|Karusel|Post|Stories", "topic": string, "hook": string, "cta": string}]}`,
    build: (b) => `Make a ${b.days}-day Instagram content plan with ${b.perWeek} posts per week (only list days that have a post). Focus: ${b.topic || "the business in general"}. Goal: ${b.goal}. Mix formats; include engagement posts that ask to comment a keyword.`,
  },
  ideas: {
    label: "💡 G'oyalar",
    schema: `{"ideas": [{"title": string, "format": "Reels|Karusel|Post|Stories", "hook": string, "why": "why it will work"}]}`,
    build: (b) => `Give 10 fresh, specific Instagram content ideas. Focus: ${b.topic || "the business in general"}. Goal: ${b.goal}.`,
  },
};

const GOALS = { sales: "sotuvlar", followers: "obunachilar o'sishi", trust: "ishonch va ekspertlik", engagement: "faollik (komment, saqlash)" };
const TONES = { friendly: "do'stona", expert: "ekspert", fun: "hazil-mutoyiba", premium: "premium" };
const LANGS = { uz: "Uzbek (Latin script)", ru: "Russian", en: "English" };

function systemPrompt(u, lang, schema) {
  return `You are a top Instagram content strategist for small businesses in Uzbekistan.
Business name: ${u.businessName || "-"}
About the business: ${String(u.businessInfo || "").slice(0, 2500) || "-"}
Write all content in ${LANGS[lang] || LANGS.uz}. Be concrete to this business (products, prices, city) — no generic filler.
Return ONLY valid JSON matching: ${schema}`;
}

function clampInt(v, min, max, def) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

contentRouter.get("/content", requireAuth, async (req, res) => {
  const u = req.user;
  u.content ||= {};
  const items = u.content.items || [];
  const hasAi = await aiAvailable(u);
  const opt = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${esc(v)}</option>`).join("");

  res.send(
    page(
      "AI Kontent studiya",
      `
      <style>
        .cs-tabs { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px }
        .cs-tabs button { margin:0; padding:7px 14px; font-size:13px }
        .cs-out { min-height:120px }
        .cs-block { background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:10px; padding:12px 14px; margin-bottom:10px; white-space:pre-wrap }
        .cs-block h4 { margin:0 0 6px; font-size:13px; color:#c4b5fd }
        .cs-copy { float:right; margin:0; padding:3px 9px; font-size:11.5px }
        .cs-slides { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:10px }
        .cs-slides canvas { width:100%; height:auto; border-radius:10px; display:block }
        .cs-scene { display:grid; grid-template-columns:70px 1fr; gap:8px; padding:8px 0; border-bottom:1px solid var(--border) }
        .cs-hist { display:flex; justify-content:space-between; gap:8px; padding:8px 0; border-bottom:1px solid var(--border); font-size:13.5px }
        .cs-spin { display:inline-block; width:16px; height:16px; border:2px solid rgba(255,255,255,.25); border-top-color:#a78bfa; border-radius:50%; animation:csspin .8s linear infinite; vertical-align:middle }
        @keyframes csspin { to { transform:rotate(360deg) } }
      </style>
      ${hasAi ? "" : `<div class="error">AI kaliti sozlanmagan — admin panelda Gemini kalitini kiriting.</div>`}
      <div class="grid split-form">
        <div>
          <div class="card">
            <div class="cs-tabs" id="csTabs">
              ${Object.entries(TOOLS).map(([k, t], i) => `<button type="button" class="${i ? "secondary" : ""}" data-tool="${k}">${t.label}</button>`).join("")}
            </div>
            <form id="csForm">
              <input type="hidden" name="tool" value="reels">
              <label>Mavzu</label>
              <textarea name="topic" rows="2" maxlength="600" placeholder="Masalan: yangi kuzgi kolleksiya, 3 ta asosiy afzallik"></textarea>
              <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px">
                <div><label>Maqsad</label><select name="goal">${opt(GOALS, "sales")}</select></div>
                <div><label>Uslub</label><select name="tone">${opt(TONES, "friendly")}</select></div>
                <div><label>Til</label><select name="lang">${opt({ uz: "O'zbekcha", ru: "Ruscha", en: "Inglizcha" }, "uz")}</select></div>
                <div data-for="reels"><label>Davomiyligi</label><select name="duration"><option value="15">15 s</option><option value="30" selected>30 s</option><option value="60">60 s</option></select></div>
                <div data-for="carousel" style="display:none"><label>Slaydlar soni</label><input type="number" name="slides" min="3" max="10" value="7"></div>
                <div data-for="plan" style="display:none"><label>Davr (kun)</label><select name="days"><option value="7">7</option><option value="14">14</option><option value="30" selected>30</option></select></div>
                <div data-for="plan" style="display:none"><label>Haftasiga post</label><input type="number" name="perWeek" min="1" max="14" value="4"></div>
              </div>
              <button class="btn" id="csGo" style="width:100%; margin-top:14px" ${hasAi ? "" : "disabled"}>✨ Yaratish</button>
            </form>
          </div>
          <div class="card cs-out" id="csOut"><p class="hint" style="text-align:center; padding:30px 0">Natija shu yerda chiqadi. Kontent biznesingiz ma'lumotlari (AI Studio) asosida tayyorlanadi.</p></div>
        </div>
        <div class="card" style="height:fit-content">
          <h3 style="margin-top:0">🗂️ Saqlanganlar</h3>
          ${items.length ? items.map((it) => `<div class="cs-hist">
              <a href="#" data-open="${esc(it.id)}">${esc(TOOLS[it.tool]?.label.split(" ")[0] || "")} ${esc(it.title || "Natija")}</a>
              <span style="white-space:nowrap"><span class="hint" style="font-size:11.5px">${esc(String(it.at).slice(0, 10))}</span>
                <form method="post" action="/content/${esc(it.id)}/delete" style="display:inline; margin:0"><button class="secondary" style="margin:0 0 0 6px; padding:2px 8px; font-size:11px">✕</button></form></span>
            </div>`).join("") : `<p class="hint">Hali saqlangan kontent yo'q</p>`}
        </div>
      </div>
      <script type="application/json" id="csItems">${JSON.stringify(items).replace(/</g, "\\u003c")}</script>
      <script type="application/json" id="csBrand">${JSON.stringify({ name: u.businessName || "", handle: u.meta?.igUsername || "" }).replace(/</g, "\\u003c")}</script>
      <script src="/assets/content-studio.js"></script>`,
      { user: u, active: "content" }
    )
  );
});

contentRouter.post("/content/generate", requireAuth, async (req, res) => {
  const u = req.user;
  const b = req.body || {};
  const tool = TOOLS[b.tool] ? b.tool : "reels";
  const input = {
    topic: String(b.topic || "").trim().slice(0, 600),
    goal: GOALS[b.goal] || GOALS.sales,
    tone: TONES[b.tone] || TONES.friendly,
    duration: clampInt(b.duration, 15, 90, 30),
    slides: clampInt(b.slides, 3, 10, 7),
    days: clampInt(b.days, 7, 30, 30),
    perWeek: clampInt(b.perWeek, 1, 14, 4),
  };
  if (!input.topic && (tool === "reels" || tool === "carousel" || tool === "caption")) {
    return res.status(400).json({ ok: false, error: "Mavzuni yozing" });
  }
  try {
    const data = await generateText(u, systemPrompt(u, b.lang, TOOLS[tool].schema), TOOLS[tool].build(input), {
      json: true,
      maxOutputTokens: 4096,
      temperature: 0.8,
    });
    const item = {
      id: `ct_${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`,
      tool,
      title: String(data.title || input.topic || TOOLS[tool].label).slice(0, 80),
      input,
      data,
      at: new Date().toISOString(),
    };
    u.content ||= {};
    u.content.items = [item, ...(u.content.items || [])].slice(0, MAX_ITEMS);
    persist(u);
    res.json({ ok: true, item });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

contentRouter.post("/content/:id/delete", requireAuth, (req, res) => {
  const u = req.user;
  u.content ||= {};
  u.content.items = (u.content.items || []).filter((it) => it.id !== req.params.id);
  persist(u);
  res.redirect("/content");
});

/** Reels'dagi komment kalit so'zidan tayyor "komment → obuna → sovg'a" flow yaratadi. */
contentRouter.post("/content/:id/flow", requireAuth, (req, res) => {
  const u = req.user;
  const item = (u.content?.items || []).find((it) => it.id === req.params.id);
  const keyword = String(item?.data?.commentKeyword || "").trim().slice(0, 40);
  if (!item || !keyword) return res.redirect("/content");
  const flow = buildTemplate("giveaway");
  flow.name = `🎬 ${item.title}`.slice(0, 120);
  flow.triggers = [{ ...flow.triggers[0], keyword: `${keyword.toLowerCase()}, ${keyword}`, matchType: "contains" }];
  if (item.data.dmGift && flow.nodes.m2) flow.nodes.m2.text = `Mana va'da qilingan sovg'a 🎉\n\n${String(item.data.dmGift).slice(0, 800)}`;
  ensureFlows(u).list.unshift(flow);
  persist(u);
  res.redirect(`/flows/${encodeURIComponent(flow.id)}`);
});
