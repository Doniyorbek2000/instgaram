/**
 * Ketma-ketliklar (/sequences) — kunlar bo'yicha xabarlar seriyasi (drip).
 * Mijoz flow'dagi "📅 Ketma-ketlikka qo'shish" amali yoki kontakt kartasi orqali qo'shiladi.
 */
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { persist } from "../db.js";
import { ensureSequences, findSequence, sanitizeSequence, activeCount, MAX_STEPS } from "../sequences.js";
import { ensureFlows } from "../flows.js";

export const sequencesRouter = Router();

const UNITS = { 1: "daqiqa", 60: "soat", 1440: "kun" };
const splitDelay = (min) => (min % 1440 === 0 ? [min / 1440, 1440] : min % 60 === 0 ? [min / 60, 60] : [min, 1]);
const fmtDelay = (min) => {
  const [v, u] = splitDelay(min);
  return `${v} ${UNITS[u]}`;
};

sequencesRouter.get("/sequences", requireAuth, (req, res) => {
  const u = req.user;
  const { list } = ensureSequences(u);
  const cards = list.length
    ? list.map((q) => {
        const active = activeCount(u, q.id);
        let total = 0;
        const timeline = q.steps.map((st) => { total += st.delayMin; return `<span class="status-tag" style="font-size:11.5px">+${esc(fmtDelay(total))}</span>`; }).join(" → ");
        return `<div class="card" style="border-left:4px solid ${q.enabled ? "#4ade80" : "#64748b"}">
          <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap">
            <div>
              <a href="/sequences/${esc(q.id)}" style="font-size:17px; font-weight:800; color:#fff">${esc(q.name)}</a>
              <div style="margin-top:6px; display:flex; gap:4px; flex-wrap:wrap; align-items:center">${timeline || `<span class="hint">Qadam yo'q</span>`}</div>
            </div>
            <div style="display:flex; gap:6px; align-items:flex-start">
              <a class="btn" href="/sequences/${esc(q.id)}" style="margin:0; padding:6px 14px; font-size:12.5px">✏️ Tahrirlash</a>
              <form method="post" action="/sequences/${esc(q.id)}/toggle" style="margin:0"><button class="secondary" style="margin:0; padding:6px 12px; font-size:12.5px">${q.enabled ? "✅ Faol" : "⏸️ O'chiq"}</button></form>
            </div>
          </div>
          <div class="flow-stats" style="display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-top:12px">
            ${[["Hozir ichida", active], ["Qo'shilgan", q.stats.subscribed || 0], ["Yuborildi", q.stats.sent || 0], ["O'tkazildi", q.stats.skipped || 0]]
              .map(([l, v]) => `<div style="background:rgba(255,255,255,0.03); border-radius:8px; padding:6px 10px"><span class="hint" style="font-size:11px; display:block">${l}</span><b>${v}</b></div>`).join("")}
          </div>
        </div>`;
      }).join("")
    : `<div class="card" style="text-align:center; padding:40px"><div style="font-size:40px">📅</div><h3>Hali ketma-ketlik yo'q</h3><p class="hint">Masalan: 1-kun — xush kelibsiz, 3-kun — foydali maslahat, 7-kun — chegirma.</p></div>`;

  res.send(page("Ketma-ketliklar", `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px">
      <div>
        <h2 style="margin:0">📅 Ketma-ketliklar</h2>
        <p class="hint" style="margin:4px 0 0">Mijozga kunlar bo'yicha rejalashtirilgan xabarlar seriyasi. Flow'da "📅 Ketma-ketlikka qo'shish" amali bilan ulanadi.</p>
      </div>
      <form method="post" action="/sequences/create" style="margin:0"><button class="btn" style="margin:0">+ Yangi ketma-ketlik</button></form>
    </div>
    <div class="card" style="background:rgba(56,189,248,0.07); border:1px solid rgba(56,189,248,0.3); font-size:13.5px">
      ℹ️ <b>Telegram</b>'da har bir qadam o'z vaqtida yuboriladi. <b>Instagram, Messenger va WhatsApp</b> esa faqat mijoz oxirgi 24 soatda yozgan bo'lsa xabar qabul qiladi (Meta qoidasi) — oyna yopiq bo'lsa qadam o'tkazib yuboriladi va keyingisi rejalashtiriladi. Uzoq seriyalarni Telegram uchun, Instagram'da esa 24 soat ichidagi qisqa seriyalarni qiling. STOP yozgan mijozlarga yuborilmaydi.
    </div>
    ${cards}`, { user: u, active: "sequences" }));
});

sequencesRouter.post("/sequences/create", requireAuth, (req, res) => {
  const seq = sanitizeSequence({
    name: "Yangi ketma-ketlik",
    enabled: false,
    steps: [
      { delayMin: 60, text: "Salom, {name|do'stim}! 👋 Bizni tanlaganingiz uchun rahmat." },
      { delayMin: 1440, text: "{first_name|Do'stim}, eng ko'p so'raladigan savollarga javoblar tayyorladik 👇" },
      { delayMin: 2880, text: "Faqat siz uchun: bugun buyurtma bersangiz −10% 🎁" },
    ],
  });
  ensureSequences(req.user).list.unshift(seq);
  persist(req.user);
  res.redirect(`/sequences/${encodeURIComponent(seq.id)}`);
});

sequencesRouter.post("/sequences/:id/toggle", requireAuth, (req, res) => {
  const q = findSequence(req.user, req.params.id);
  if (q) { q.enabled = !q.enabled; persist(req.user); }
  res.redirect("/sequences");
});

sequencesRouter.post("/sequences/:id/delete", requireAuth, (req, res) => {
  const s = ensureSequences(req.user);
  s.list = s.list.filter((q) => q.id !== req.params.id);
  for (const [key, mine] of Object.entries(s.subs)) {
    delete mine[req.params.id];
    if (!Object.keys(mine).length) delete s.subs[key];
  }
  persist(req.user);
  res.redirect("/sequences");
});

const parseButtons = (txt) =>
  String(txt || "").split("\n").map((line) => {
    const i = line.lastIndexOf("|");
    return i > 0 ? { title: line.slice(0, i).trim(), url: line.slice(i + 1).trim() } : null;
  }).filter(Boolean);

sequencesRouter.post("/sequences/:id/save", requireAuth, (req, res) => {
  const s = ensureSequences(req.user);
  const idx = s.list.findIndex((q) => q.id === req.params.id);
  if (idx < 0) return res.redirect("/sequences");
  let steps = [];
  try { steps = JSON.parse(String(req.body?.steps || "[]")); } catch { steps = []; }
  const clean = sanitizeSequence({
    name: req.body?.name,
    enabled: req.body?.enabled === "on",
    steps: (Array.isArray(steps) ? steps : []).map((st) => ({
      id: st.id,
      delayMin: Math.round((Number(st.value) || 1) * (Number(st.unit) || 1440)),
      text: st.text,
      buttons: parseButtons(st.buttons),
      flowId: st.flowId,
    })),
  }, s.list[idx]);
  s.list[idx] = clean;
  persist(req.user);
  res.redirect(`/sequences/${encodeURIComponent(clean.id)}?saved=1`);
});

sequencesRouter.get("/sequences/:id", requireAuth, (req, res) => {
  const u = req.user;
  const q = findSequence(u, req.params.id);
  if (!q) return res.redirect("/sequences");
  const flows = ensureFlows(u).list.map((f) => ({ id: f.id, name: f.name }));
  const steps = q.steps.map((st) => {
    const [value, unit] = splitDelay(st.delayMin);
    const stats = q.stats.steps?.[st.id] || { sent: 0, skipped: 0 };
    return { id: st.id, value, unit, text: st.text, buttons: st.buttons.map((b) => `${b.title} | ${b.url}`).join("\n"), flowId: st.flowId, sent: stats.sent, skipped: stats.skipped };
  });
  const data = JSON.stringify({ steps, flows, max: MAX_STEPS }).replace(/</g, "\\u003c");
  res.send(page(`Ketma-ketlik: ${q.name}`, `
    ${req.query.saved ? `<div class="ok">Saqlandi ✅</div>` : ""}
    <style>
      .sq-step { position:relative; padding-left:34px }
      .sq-step::before { content:""; position:absolute; left:12px; top:0; bottom:-14px; width:2px; background:rgba(139,92,246,.35) }
      .sq-step:last-child::before { bottom:50% }
      .sq-dot { position:absolute; left:3px; top:18px; width:20px; height:20px; border-radius:50%; background:linear-gradient(120deg,#7c3aed,#db2777); color:#fff; font-size:11px; font-weight:800; display:grid; place-items:center }
      .sq-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap }
      .sq-row input[type=number] { width:90px; margin:0 } .sq-row select { width:auto; margin:0 }
    </style>
    <form method="post" action="/sequences/${esc(q.id)}/save" id="sqForm">
      <div class="card">
        <div class="sq-row">
          <input name="name" value="${esc(q.name)}" maxlength="120" style="flex:1; min-width:220px; margin:0" required>
          <label style="display:flex; gap:6px; align-items:center; margin:0; text-transform:none; letter-spacing:0; font-size:14px"><input type="checkbox" name="enabled" ${q.enabled ? "checked" : ""} style="width:auto; margin:0"> Faol</label>
          <button class="btn" style="margin:0">💾 Saqlash</button>
        </div>
        <p class="hint" style="font-size:12.5px; margin:10px 0 0">Kechikish oldingi qadamdan hisoblanadi (birinchi qadam — qo'shilgan paytdan). Matnda {name}, {first_name}, {phone} va boshqa o'zgaruvchilar ishlaydi. Hozir ichida: <b>${activeCount(u, q.id)}</b> mijoz.</p>
      </div>
      <input type="hidden" name="steps" id="sqSteps">
      <div id="sqList"></div>
      <button type="button" class="secondary" id="sqAdd" style="width:100%">+ Qadam qo'shish</button>
    </form>
    <form method="post" action="/sequences/${esc(q.id)}/delete" onsubmit="return confirm('Ketma-ketlik o\\'chirilsinmi? Ichidagi mijozlar chiqariladi.')" style="margin-top:16px"><button class="secondary" style="color:#f87171">🗑️ O'chirish</button></form>
    <script type="application/json" id="sqData">${data}</script>
    <script>
    (function () {
      var d = JSON.parse(document.getElementById("sqData").textContent);
      var steps = d.steps.length ? d.steps : [];
      var list = document.getElementById("sqList");
      function el(tag, attrs, kids) {
        var e = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) { if (k === "text") e.textContent = attrs[k]; else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]); });
        (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
        return e;
      }
      function render() {
        list.innerHTML = "";
        steps.forEach(function (st, i) {
          var val = el("input", { type: "number", min: "1", max: "2160", value: st.value || 1, oninput: function (e) { st.value = e.target.value; } });
          var unit = el("select", { onchange: function (e) { st.unit = e.target.value; } });
          [["1", "daqiqa"], ["60", "soat"], ["1440", "kun"]].forEach(function (o) { var op = el("option", { value: o[0], text: o[1] }); if (String(st.unit || 1440) === o[0]) op.selected = true; unit.appendChild(op); });
          var mode = el("select", { onchange: function (e) { st.flowId = e.target.value === "flow" ? (d.flows[0] || {}).id || "" : ""; render(); } });
          [["msg", "💬 Xabar yuborish"], ["flow", "🧩 Flow'ni ishga tushirish"]].forEach(function (o) { var op = el("option", { value: o[0], text: o[1] }); if ((st.flowId ? "flow" : "msg") === o[0]) op.selected = true; mode.appendChild(op); });
          var body;
          if (st.flowId) {
            body = el("select", { onchange: function (e) { st.flowId = e.target.value; } });
            d.flows.forEach(function (f) { var op = el("option", { value: f.id, text: f.name }); if (f.id === st.flowId) op.selected = true; body.appendChild(op); });
          } else {
            var ta = el("textarea", { rows: "3", maxlength: "2000", placeholder: "Xabar matni", oninput: function (e) { st.text = e.target.value; } });
            ta.value = st.text || "";
            var bt = el("textarea", { rows: "2", placeholder: "Havola tugmalari (ixtiyoriy, har qatorda: Nomi | https://...)", oninput: function (e) { st.buttons = e.target.value; } });
            bt.value = st.buttons || "";
            body = el("div", {}, [ta, bt]);
          }
          list.appendChild(el("div", { class: "card sq-step" }, [
            el("span", { class: "sq-dot", text: String(i + 1) }),
            el("div", { class: "sq-row" }, [
              el("span", { class: "hint", text: i ? "Oldingi qadamdan" : "Qo'shilgandan" }), val, unit, el("span", { class: "hint", text: "keyin" }), mode,
              el("span", { style: "flex:1" }),
              el("span", { class: "hint", style: "font-size:12px", text: "✓ " + (st.sent || 0) + " · o'tkazildi " + (st.skipped || 0) }),
              el("button", { type: "button", class: "secondary", style: "margin:0; padding:4px 10px; color:#f87171", text: "✕", onclick: function () { steps.splice(i, 1); render(); } }),
            ]),
            el("div", { style: "margin-top:8px" }, [body]),
          ]));
        });
        document.getElementById("sqAdd").style.display = steps.length >= d.max ? "none" : "";
      }
      document.getElementById("sqAdd").addEventListener("click", function () { steps.push({ value: 1, unit: 1440, text: "" }); render(); });
      document.getElementById("sqForm").addEventListener("submit", function () { document.getElementById("sqSteps").value = JSON.stringify(steps); });
      render();
    })();
    </script>`, { user: u, active: "sequences" }));
});
