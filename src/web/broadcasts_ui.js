/**
 * Ommaviy xabarlar (/broadcasts) — segment (kanal + teglar), o'zgaruvchilar,
 * havola tugmalari yoki flow ishga tushirish, rejalashtirish va jonli progress.
 */
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { persist } from "../db.js";
import { allTags } from "../contacts.js";
import { ensureFlows } from "../flows.js";
import { resolveAudience, sanitizeBroadcast, createBroadcast, runBroadcast, allContacts } from "../broadcasts.js";
import { aiAvailable } from "../ai.js";
import { isActive } from "../subscription.js";

export const broadcastsRouter = Router();

const CHANNEL_LABELS = { all: "🌐 Barcha kanallar", ig: "📷 Instagram", tg: "✈️ Telegram", wa: "💬 WhatsApp", fb: "🔵 Messenger", sms: "📱 SMS (telefoni borlarga, Eskiz)", email: "✉️ Email (emaili borlarga)" };
const STATUS = {
  scheduled: ["🗓️ Rejalashtirilgan", "#38bdf8"],
  queued: ["⏳ Navbatda", "#fbbf24"],
  sending: ["📤 Yuborilmoqda", "#fbbf24"],
  completed: ["✅ Yakunlandi", "#34d399"],
  cancelled: ["⛔ Bekor qilingan", "#94a3b8"],
};

function historyCard(b, flows) {
  const [label, color] = STATUS[b.status] || STATUS.completed;
  const pct = b.total ? Math.round(((b.sentCount + b.failedCount) / b.total) * 100) : b.status === "completed" ? 100 : 0;
  const flow = b.flowId ? flows.find((f) => f.id === b.flowId) : null;
  const f = b.filter || {};
  return `
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap">
        <div style="min-width:0">
          <b style="font-size:16px; color:#fff">${esc(b.name)}</b>
          <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px; font-size:12px">
            <span class="status-tag" style="color:${color}">${label}</span>
            <span class="status-tag">${esc(CHANNEL_LABELS[b.channel || "all"] || b.channel)}</span>
            ${(f.tags || []).length ? `<span class="status-tag">🏷️ ${esc(f.tags.join(f.tagMode === "all" ? " + " : " / "))}</span>` : ""}
            ${(f.excludeTags || []).length ? `<span class="status-tag">🚫 ${esc(f.excludeTags.join(", "))}</span>` : ""}
            ${b.scheduledAt && b.status === "scheduled" ? `<span class="status-tag">🕘 ${esc(new Date(b.scheduledAt).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" }))}</span>` : ""}
          </div>
        </div>
        <div style="display:flex; gap:6px">
          ${b.status === "scheduled" ? `<form method="post" action="/broadcasts/cancel" style="margin:0"><input type="hidden" name="id" value="${esc(b.id)}"><button class="secondary" style="padding:5px 10px; font-size:12px; margin:0">⛔ Bekor</button></form>` : ""}
          ${b.status !== "sending" ? `<form method="post" action="/broadcasts/delete" style="margin:0"><input type="hidden" name="id" value="${esc(b.id)}"><button class="secondary" style="padding:5px 10px; font-size:12px; margin:0; color:#f87171">🗑️</button></form>` : ""}
        </div>
      </div>
      <p style="margin:10px 0 6px; color:#cbd5e1; white-space:pre-wrap; font-size:14px">${flow ? `🧩 Flow: <b>${esc(flow.name)}</b>` : `${b.media ? `📎 <b>${esc(b.media.name || b.media.type)}</b>\n` : ""}${esc(b.message)}`}</p>
      ${b.status === "sending" || b.status === "completed"
        ? `<div style="height:6px; background:rgba(255,255,255,0.06); border-radius:99px; overflow:hidden"><div style="height:100%; width:${pct}%; background:var(--grad-primary)"></div></div>
           <div class="hint" style="font-size:12.5px; margin-top:6px">✅ ${b.sentCount || 0} yuborildi · ⚠️ ${b.failedCount || 0} yetmadi · jami ${b.total || 0}</div>`
        : ""}
    </div>`;
}

broadcastsRouter.get("/broadcasts", requireAuth, async (req, res) => {
  const user = req.user;
  user.broadcasts ||= [];
  const flows = ensureFlows(user).list;
  const tags = allTags(user);
  const sending = user.broadcasts.some((b) => b.status === "sending" || b.status === "queued");
  const hasAi = await aiAvailable(user);

  res.send(
    page(
      "Ommaviy xabarlar",
      `
      ${sending ? `<meta http-equiv="refresh" content="4">` : ""}
      ${req.query.saved ? `<div class="ok">Ommaviy xabar ${req.query.saved === "scheduled" ? "rejalashtirildi 🗓️" : "yuborilmoqda 📤"}</div>` : ""}
      ${req.query.error ? `<div class="error">${esc(req.query.error)}</div>` : ""}
      <div class="grid split-form">
        <div>
          <h3 style="margin-top:0">📜 Tarix</h3>
          ${user.broadcasts.length ? user.broadcasts.map((b) => historyCard(b, flows)).join("") : `<div class="card hint" style="text-align:center; padding:32px">Hali ommaviy xabar yuborilmagan.</div>`}
        </div>
        <div class="card" style="height:fit-content; border:1px solid #7c3aed">
          <h3 style="margin-top:0">📢 Yangi ommaviy xabar</h3>
          <form method="post" action="/broadcasts/create" id="bcForm">
            <label>Nomi (faqat siz uchun)</label>
            <input name="name" required maxlength="120" placeholder="Masalan: Dam olish kunlari aksiyasi">

            <label>Kanal</label>
            <select name="channel">${Object.entries(CHANNEL_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>

            <label>Teglar bo'yicha segment (bo'sh — hamma)</label>
            <input name="tags" list="bcTags" placeholder="vip, lid">
            <select name="tagMode" style="margin-top:6px">
              <option value="any">Teglardan istalgani bor kontaktlar</option>
              <option value="all">Barcha teglari bor kontaktlar</option>
            </select>
            <label>Istisno teglar</label>
            <input name="excludeTags" list="bcTags" placeholder="xaridor, stop">
            <datalist id="bcTags">${tags.map(([t]) => `<option value="${esc(t)}">`).join("")}</datalist>

            <label style="display:flex; gap:8px; align-items:center; cursor:pointer; margin-top:12px">
              <input type="checkbox" name="only24h" value="true" checked style="width:auto; margin:0">
              Faqat oxirgi 24 soatda yozganlar (Instagram / Messenger / WhatsApp talabi)
            </label>
            <input type="hidden" name="only24h" value="false">
            <label style="display:flex; gap:8px; align-items:center; cursor:pointer; margin-top:8px">
              <input type="checkbox" name="stopFooter" value="true" checked style="width:auto; margin:0">
              Oxiriga "Chiqish uchun STOP deb yozing" qo'shilsin (tavsiya etiladi — Meta shikoyatlaridan himoya)
            </label>
            <input type="hidden" name="stopFooter" value="false">
            <p class="hint" style="font-size:12px; margin:4px 0 0">STOP yozgan mijozlarga ommaviy xabar va ketma-ketliklar yuborilmaydi (START — qaytadi).</p>

            <div class="card" style="margin:12px 0; padding:10px 14px; background:rgba(139,92,246,0.08)">
              <b id="bcCount">…</b> <span class="hint">kontaktga yetkaziladi</span>
            </div>

            <label>Nima yuborilsin</label>
            <select name="flowId" id="bcFlow">
              <option value="">✉️ Matnli xabar</option>
              ${flows.map((f) => `<option value="${esc(f.id)}">🧩 Flow: ${esc(f.name)}</option>`).join("")}
            </select>

            <div id="bcMsg">
              <label>Xabar matni</label>
              <textarea name="message" id="bcText" rows="5" maxlength="2000" placeholder="Salom, {name|do'stim}! 🎉 Bugun barcha mahsulotlarga −20%"></textarea>
              ${hasAi ? `<div style="display:flex; gap:4px; flex-wrap:wrap">${[["improve", "✨ Yaxshilash"], ["sell", "Sotuvchi"], ["shorter", "Qisqa"], ["ru", "RU"]].map(([m, l]) => `<button type="button" class="secondary" data-ai="${m}" style="font-size:11.5px; padding:3px 9px; margin:4px 0 0">${l}</button>`).join("")}</div>` : ""}
              <p class="hint" style="font-size:12px; margin:6px 0 0">O'zgaruvchilar: {name|do'stim}, {first_name}, {username}, {points}, {phone} va boshqa maydonlar.</p>
              <label>Media (ixtiyoriy)</label>
              <select name="mediaId">
                <option value="">— Mediasiz —</option>
                ${(user.mediaLibrary || []).map((m) => `<option value="${esc(m.id)}">${{ image: "🖼️", video: "🎬", audio: "🎧", file: "📎" }[m.type] || "📎"} ${esc(m.name)}</option>`).join("")}
              </select>
              <p class="hint" style="font-size:12px; margin:4px 0 0">Fayllarni <a href="/media">Media kutubxona</a>ga yuklang.</p>
              <label>Havola tugmalari (har qatorda: Nomi | https://..., max 3)</label>
              <textarea name="buttons" rows="2" placeholder="Katalog | https://example.uz"></textarea>
            </div>

            <label>Yuborish vaqti (bo'sh — hozir)</label>
            <input type="datetime-local" name="scheduledLocal" id="bcWhen">
            <input type="hidden" name="scheduledAt" id="bcWhenIso">

            <button type="submit" class="btn" style="width:100%; margin-top:14px">📤 Yuborish</button>
          </form>
        </div>
      </div>
      <script>
      (function () {
        var form = document.getElementById("bcForm");
        var countEl = document.getElementById("bcCount");
        var flowSel = document.getElementById("bcFlow");
        var msgBox = document.getElementById("bcMsg");
        var text = document.getElementById("bcText");
        var timer;
        function refresh() {
          clearTimeout(timer);
          timer = setTimeout(function () {
            var fd = new FormData(form);
            var q = new URLSearchParams({ channel: fd.get("channel"), tags: fd.get("tags"), tagMode: fd.get("tagMode"), excludeTags: fd.get("excludeTags"), only24h: form.only24h[0].checked ? "true" : "false" });
            fetch("/broadcasts/audience?" + q).then(function (r) { return r.json(); }).then(function (d) {
              countEl.textContent = d.count + " / " + d.total;
            }).catch(function () { countEl.textContent = "?"; });
          }, 200);
        }
        form.addEventListener("input", refresh);
        form.addEventListener("change", refresh);
        flowSel.addEventListener("change", function () { msgBox.style.display = flowSel.value ? "none" : ""; });
        text.required = false;
        form.addEventListener("submit", function () {
          var v = document.getElementById("bcWhen").value;
          document.getElementById("bcWhenIso").value = v ? new Date(v).toISOString() : "";
        });
        Array.prototype.forEach.call(document.querySelectorAll("[data-ai]"), function (b) {
          b.addEventListener("click", function () {
            if (!text.value.trim()) return;
            b.disabled = true;
            fetch("/ai/rewrite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text.value, mode: b.getAttribute("data-ai") }) })
              .then(function (r) { return r.json(); })
              .then(function (d) { if (d.ok) text.value = d.text; else alert(d.error); })
              .then(function () { b.disabled = false; });
          });
        });
        refresh();
      })();
      </script>`,
      { user, active: "broadcasts" }
    )
  );
});

broadcastsRouter.get("/broadcasts/audience", requireAuth, (req, res) => {
  const count = resolveAudience(req.user, {
    channel: req.query.channel,
    tags: req.query.tags,
    tagMode: req.query.tagMode,
    excludeTags: req.query.excludeTags,
    only24h: req.query.only24h !== "false",
  }).length;
  res.json({ count, total: allContacts(req.user).length });
});

broadcastsRouter.post("/broadcasts/create", requireAuth, (req, res) => {
  const user = req.user;
  // Checkbox belgilanganda ikkala qiymat keladi: ["true", "false"] — birinchisi ustun
  const libItem = (user.mediaLibrary || []).find((m) => m.id === req.body?.mediaId);
  const body = {
    ...req.body,
    only24h: [].concat(req.body?.only24h || "false")[0],
    stopFooter: [].concat(req.body?.stopFooter || "false")[0],
    media: libItem ? { type: libItem.type, url: libItem.url, name: libItem.name } : null,
  };
  if (!isActive(user)) return res.redirect("/broadcasts?error=" + encodeURIComponent("Ommaviy xabarlar pullik tariflarda ishlaydi — Obuna & Tariflar sahifasiga o'ting"));
  const data = sanitizeBroadcast(body);
  if (!data.name) return res.redirect("/broadcasts?error=" + encodeURIComponent("Nomini kiriting"));
  if (data.flowId && !ensureFlows(user).list.some((f) => f.id === data.flowId)) data.flowId = "";
  if (!data.flowId && !data.message && !data.media) return res.redirect("/broadcasts?error=" + encodeURIComponent("Xabar matnini yozing, media tanlang yoki flow tanlang"));

  const b = createBroadcast(user, data);
  if (!data.scheduledAt) {
    runBroadcast(user, b.id).catch((err) => console.error("[Broadcast] xato:", err.message));
  }
  res.redirect(`/broadcasts?saved=${data.scheduledAt ? "scheduled" : "1"}`);
});

broadcastsRouter.post("/broadcasts/cancel", requireAuth, (req, res) => {
  const b = (req.user.broadcasts || []).find((x) => x.id === req.body?.id);
  if (b && b.status === "scheduled") {
    b.status = "cancelled";
    persist(req.user);
  }
  res.redirect("/broadcasts");
});

broadcastsRouter.post("/broadcasts/delete", requireAuth, (req, res) => {
  const user = req.user;
  user.broadcasts = (user.broadcasts || []).filter((b) => b.id !== req.body?.id || b.status === "sending");
  persist(user);
  res.redirect("/broadcasts");
});
