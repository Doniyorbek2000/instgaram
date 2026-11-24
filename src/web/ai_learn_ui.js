/**
 * AI'ni Instagram akkauntidan o'rgatish (/ai-learn) — ChatPlace AI Agent'ning
 * "bilim bazasini akkauntdan avtomatik yaratish" ekvivalenti.
 *
 * Profil bio'si + oxirgi postlar izohlari (+ ixtiyoriy qo'shimcha matn: narx
 * ro'yxati, sayt matni) Gemini'ga beriladi → mahsulotlar/narxlar, FAQ, aloqa
 * va yozish uslubi ajratib olinadi → egasi ko'rib, tahrirlab, bilim bazasiga
 * qo'shadi. Uslub (tone of voice) AI tizim ko'rsatmasiga qo'shiladi.
 */
import express, { Router } from "express";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { persist } from "../db.js";
import { generateText, aiBlockReason } from "../ai.js";
import { getProfileStats, getRecentMedia } from "../services/instagram.js";

export const aiLearnRouter = Router();

const MAX_KB = 50000;

const SCHEMA = `{
  "summary": "2-3 sentences: what the business is, city, audience",
  "products": [{"name": string, "price": "exact price as written or empty", "details": string}],
  "services": [string],
  "faq": [{"q": string, "a": string}],
  "contacts": {"address": string, "phone": string, "hours": string, "delivery": string, "payment": string},
  "tone": "one paragraph describing the brand's writing style: formality (siz/sen), sentence length, emoji usage, typical phrases",
  "gaps": ["important info customers ask about that is missing from the posts"]
}`;

/** Draft JSON'dan bilim bazasiga yoziladigan o'qiladigan matn yasaydi. */
export function draftToKnowledge(d = {}) {
  const lines = [];
  if (d.summary) lines.push(`📌 BIZNES HAQIDA:\n${d.summary}`);
  const products = (d.products || []).filter((p) => p?.name);
  if (products.length) {
    lines.push("🛍️ MAHSULOTLAR VA NARXLAR:\n" + products.map((p) => `- ${p.name}${p.price ? ` — ${p.price}` : ""}${p.details ? `: ${p.details}` : ""}`).join("\n"));
  }
  const services = (d.services || []).filter(Boolean);
  if (services.length) lines.push("🧰 XIZMATLAR:\n" + services.map((s) => `- ${s}`).join("\n"));
  const c = d.contacts || {};
  const contactLines = [
    c.address && `📍 Manzil: ${c.address}`,
    c.phone && `📞 Telefon: ${c.phone}`,
    c.hours && `⏰ Ish vaqti: ${c.hours}`,
    c.delivery && `🚚 Yetkazib berish: ${c.delivery}`,
    c.payment && `💳 To'lov: ${c.payment}`,
  ].filter(Boolean);
  if (contactLines.length) lines.push("ℹ️ ALOQA VA SHARTLAR:\n" + contactLines.join("\n"));
  const faq = (d.faq || []).filter((f) => f?.q && f?.a);
  if (faq.length) lines.push("❓ KO'P SO'RALADIGAN SAVOLLAR:\n" + faq.map((f) => `S: ${f.q}\nJ: ${f.a}`).join("\n\n"));
  return lines.join("\n\n");
}

aiLearnRouter.get("/ai-learn", requireAuth, async (req, res) => {
  const u = req.user;
  const aiBlock = await aiBlockReason(u);
  const hasAi = !aiBlock;
  const igConnected = Boolean(u.meta?.igUserId && (u.meta?.igAccessToken || u.meta?.pageAccessToken));
  const draft = u.aiDraft || null;
  res.send(
    page(
      "AI'ni o'rgatish",
      `
      ${req.query.saved ? `<div class="ok">Bilim bazasi va uslub yangilandi ✅ AI endi shu ma'lumotlar bilan javob beradi.</div>` : ""}
      ${hasAi ? "" : `<div class="error">${esc(aiBlock)} <a href="/billing">Tariflar</a></div>`}
      <div class="grid split-form">
        <div>
          <div class="card" style="border:1px solid #7c3aed">
            <h3 style="margin-top:0">🧠 Instagram akkauntidan o'rganish</h3>
            <p class="hint" style="margin-top:0">AI profilingiz bio'sini va oxirgi postlar izohlarini o'qib, mahsulotlar, narxlar, savol-javoblar va yozish uslubingizni ajratib oladi. Natijani ko'rib, tahrirlab, keyin saqlaysiz.</p>
            <form id="learnForm">
              <label style="display:flex; gap:8px; align-items:center; cursor:pointer; text-transform:none; letter-spacing:0; font-size:14px; font-weight:600">
                <input type="checkbox" name="useInstagram" ${igConnected ? "checked" : "disabled"} style="width:auto; margin:0">
                Instagram profil va oxirgi 40 ta post ${igConnected ? "" : "<span class='hint'>(Instagram ulanmagan)</span>"}
              </label>
              <label>Qo'shimcha matn (ixtiyoriy): narx ro'yxati, sayt matni, katalog</label>
              <textarea name="extra" rows="5" maxlength="15000" placeholder="Masalan: Kurtka — 450 000 so'm, o'lchamlar S-XXL..."></textarea>
              <button class="btn" id="learnBtn" style="width:100%; margin-top:12px" ${hasAi ? "" : "disabled"}>✨ Tahlil qilish</button>
              <p id="learnStatus" class="hint"></p>
            </form>
          </div>
          <div id="draftBox">${draft ? "" : ""}</div>
        </div>
        <div>
          <div class="card">
            <h3 style="margin-top:0">✍️ Yozish uslubi (tone of voice)</h3>
            <form method="post" action="/ai-learn/style" style="margin:0">
              <textarea name="aiStyle" rows="5" maxlength="1500" placeholder="Masalan: Mijozga 'siz' deb murojaat qilamiz, qisqa va iliq yozamiz, 1-2 ta emoji, 'Marhamat' va 'Albatta' so'zlarini ko'p ishlatamiz.">${esc(u.settings?.aiStyle || "")}</textarea>
              <p class="hint" style="font-size:12px">AI barcha javoblarda shu uslubga amal qiladi.</p>
              <button class="btn" style="width:100%">💾 Saqlash</button>
            </form>
          </div>
          <div class="card">
            <h3 style="margin-top:0">📚 Joriy bilim bazasi</h3>
            <p class="hint" style="margin-top:0">${(u.businessInfo || "").length.toLocaleString("ru-RU")} belgi · <a href="/account">AI Studio'da tahrirlash</a></p>
            <pre style="white-space:pre-wrap; max-height:340px; overflow:auto; background:#0b0f19; padding:10px; border-radius:8px; font-size:12.5px">${esc((u.businessInfo || "Bo'sh").slice(0, 4000))}</pre>
          </div>
        </div>
      </div>
      <script type="application/json" id="draftData">${JSON.stringify(draft).replace(/</g, "\\u003c")}</script>
      <script>
      (function () {
        var form = document.getElementById("learnForm");
        var status = document.getElementById("learnStatus");
        var box = document.getElementById("draftBox");
        function el(tag, attrs, text) { var e = document.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); if (text !== undefined) e.textContent = text; return e; }
        function render(d) {
          box.innerHTML = "";
          if (!d) return;
          var card = el("div", { class: "card", style: "border:1px solid #34d399" });
          card.appendChild(el("h3", { style: "margin-top:0" }, "📋 Natija — tekshirib, tahrirlang"));
          var f = el("form", { method: "post", action: "/ai-learn/apply" });
          f.appendChild(el("label", {}, "Bilim bazasiga qo'shiladigan matn"));
          var ta = el("textarea", { name: "knowledge", rows: "16" });
          ta.value = d.knowledge || "";
          f.appendChild(ta);
          f.appendChild(el("label", {}, "Aniqlangan uslub"));
          var tone = el("textarea", { name: "tone", rows: "3" });
          tone.value = d.tone || "";
          f.appendChild(tone);
          if ((d.gaps || []).length) {
            var gaps = el("div", { class: "info", style: "margin-top:10px" });
            gaps.appendChild(el("b", {}, "⚠️ Postlarda topilmadi — qo'lda qo'shing: "));
            gaps.appendChild(document.createTextNode(d.gaps.join("; ")));
            f.appendChild(gaps);
          }
          var mode = el("select", { name: "mode" });
          [["append", "Mavjud bilim bazasiga qo'shish"], ["replace", "Bilim bazasini almashtirish"]].forEach(function (o) { mode.appendChild(el("option", { value: o[0] }, o[1])); });
          f.appendChild(el("label", {}, "Qanday saqlansin"));
          f.appendChild(mode);
          var btn = el("button", { class: "btn", style: "width:100%; margin-top:12px" }, "✅ Bilim bazasiga saqlash");
          f.appendChild(btn);
          card.appendChild(f);
          box.appendChild(card);
        }
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          var btn = document.getElementById("learnBtn");
          btn.disabled = true;
          status.textContent = "⏳ Postlar o'qilmoqda va tahlil qilinmoqda… (20–40 soniya)";
          fetch("/ai-learn/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useInstagram: form.useInstagram.checked, extra: form.extra.value }) })
            .then(function (r) { return r.json(); })
            .then(function (d) { if (!d.ok) throw new Error(d.error); status.textContent = "✅ Tayyor — pastda natija"; render(d.draft); box.scrollIntoView({ behavior: "smooth" }); })
            .catch(function (err) { status.textContent = "⚠️ " + err.message; })
            .then(function () { btn.disabled = false; });
        });
        render(JSON.parse(document.getElementById("draftData").textContent));
      })();
      </script>`,
      { user: u, active: "account" }
    )
  );
});

aiLearnRouter.post("/ai-learn/analyze", requireAuth, async (req, res) => {
  const u = req.user;
  const sources = [];
  if (req.body?.useInstagram) {
    const profile = await getProfileStats(u);
    if (profile && !profile.error) {
      sources.push(`INSTAGRAM PROFILE @${profile.username || ""}\nBio: ${profile.biography || "-"}\nWebsite: ${profile.website || "-"}`);
    }
    const media = await getRecentMedia(u, 40);
    const captions = (media?.data || []).map((m, i) => `Post ${i + 1} (${m.media_type || ""}): ${String(m.caption || "").slice(0, 1200)}`).filter((c) => c.length > 20);
    if (captions.length) sources.push("RECENT POSTS:\n" + captions.join("\n---\n"));
  }
  const extra = String(req.body?.extra || "").trim().slice(0, 15000);
  if (extra) sources.push(`EXTRA INFO FROM THE OWNER:\n${extra}`);
  if (!sources.length) return res.status(400).json({ ok: false, error: "Manba yo'q: Instagram'ni ulang yoki qo'shimcha matn kiriting" });

  try {
    const system = `You build a customer-support knowledge base for a small business chatbot in Uzbekistan.
Extract ONLY facts that are explicitly present in the sources — never invent products, prices, addresses or policies.
Write in Uzbek (Latin script); keep product names as written. Return ONLY JSON: ${SCHEMA}`;
    const data = await generateText(u, system, `Business name: ${u.businessName || "-"}\n\n${sources.join("\n\n")}`, { json: true, maxOutputTokens: 6000, temperature: 0.2 });
    const draft = {
      knowledge: draftToKnowledge(data),
      tone: String(data.tone || "").slice(0, 1500),
      gaps: (data.gaps || []).map(String).slice(0, 10),
      at: new Date().toISOString(),
    };
    u.aiDraft = draft;
    persist(u);
    res.json({ ok: true, draft });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

const POLISH_MAX_INPUT = 15000;
const POLISH_SYSTEM = `You clean up notes that a small business owner in Uzbekistan typed quickly for their customer-support chatbot's knowledge base.
- Fix spelling, grammar and punctuation; write in Uzbek Latin script (keep Russian/English product names as written).
- Organize into short sections with emoji headings in CAPS (e.g. "📌 BIZNES HAQIDA:", "🛍️ MAHSULOTLAR VA NARXLAR:", "ℹ️ ALOQA VA SHARTLAR:", "❓ KO'P SO'RALADIGAN SAVOLLAR:") and "- " bullet lines.
- Keep EVERY fact, number, price, phone and address exactly; never invent or guess anything that is not in the notes.
- If the notes contain instructions for the bot (what to say or not say), keep them under "⚠️ MUHIM (AI uchun):".
- Return only the finished text: no introduction, no markdown code fences.`;

aiLearnRouter.post("/ai-learn/polish", requireAuth, async (req, res) => {
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ ok: false, error: "Matn yozing" });
  if (text.length > POLISH_MAX_INPUT) return res.status(400).json({ ok: false, error: `Matn juda uzun (${POLISH_MAX_INPUT} belgidan oshmasin)` });
  try {
    const out = await generateText(req.user, POLISH_SYSTEM, `Business name: ${req.user.businessName || "-"}\n\nNOTES:\n${text}`, { maxOutputTokens: 4000, temperature: 0.2 });
    // Model ba'zan lotin so'z ichiga arab harfini qo'shib yuboradi ("kVت") — tozalaymiz
    const polished = String(out || "").replace(/^```\w*\s*/, "").replace(/```\s*$/, "").replace(/[؀-ۿ]/g, "").trim();
    if (!polished) return res.status(502).json({ ok: false, error: "AI javob bermadi, qaytadan urinib ko'ring" });
    res.json({ ok: true, text: polished });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// Ovozli eslatma → matn (keyin brauzer uni /ai-learn/polish ga yuboradi)
const TRANSCRIBE_MAX_BYTES = 10 * 1024 * 1024;
const TRANSCRIBE_SYSTEM = `Transcribe the business owner's voice note word for word, in the language spoken (Uzbek in Latin script; keep Russian/English words as said).
- Write numbers, prices and phone numbers as digits.
- Output only the transcript: no comments, no headings. If there is no speech, output nothing.`;

aiLearnRouter.post("/ai-learn/transcribe", requireAuth, express.raw({ type: "audio/*", limit: TRANSCRIBE_MAX_BYTES }), async (req, res) => {
  const mimeType = String(req.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!mimeType.startsWith("audio/") || !Buffer.isBuffer(req.body) || !req.body.length) {
    return res.status(400).json({ ok: false, error: "Ovoz yozuvi topilmadi" });
  }
  try {
    const out = await generateText(req.user, TRANSCRIBE_SYSTEM, "", { maxOutputTokens: 4000, temperature: 0, media: [{ mimeType, data: req.body.toString("base64") }] });
    const text = String(out || "").replace(/[؀-ۿ]/g, "").trim();
    if (!text) return res.status(422).json({ ok: false, error: "Ovozda gap eshitilmadi, qaytadan yozib ko'ring" });
    res.json({ ok: true, text });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

aiLearnRouter.post("/ai-learn/apply", requireAuth, (req, res) => {
  const u = req.user;
  const knowledge = String(req.body?.knowledge || "").trim();
  if (knowledge) {
    const current = String(u.businessInfo || "").trim();
    u.businessInfo = (req.body?.mode === "replace" || !current ? knowledge : `${current}\n\n${knowledge}`).slice(0, MAX_KB);
  }
  const tone = String(req.body?.tone || "").trim();
  if (tone) {
    u.settings ||= {};
    u.settings.aiStyle = tone.slice(0, 1500);
  }
  delete u.aiDraft;
  persist(u);
  res.redirect("/ai-learn?saved=1");
});

aiLearnRouter.post("/ai-learn/style", requireAuth, (req, res) => {
  const u = req.user;
  u.settings ||= {};
  u.settings.aiStyle = String(req.body?.aiStyle || "").trim().slice(0, 1500);
  persist(u);
  res.redirect("/ai-learn?saved=1");
});
