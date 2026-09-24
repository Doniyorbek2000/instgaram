/**
 * Geymifikatsiya paneli (/game) va ochiq reyting sahifasi (/top/:slug).
 * Backend: src/gamification.js (ballar, referal, sovg'alar, viktorina).
 */
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { persist, listUsers } from "../db.js";
import * as game from "../gamification.js";
import { splitKey } from "../outbound.js";

export const gameRouter = Router();

const TABS = [
  ["settings", "⚙️ Sozlamalar"],
  ["rewards", "🎁 Sovg'alar"],
  ["quiz", "❓ Viktorina"],
  ["players", "🏆 Ishtirokchilar"],
  ["log", "📜 Jurnal"],
];

const int = (v, min, max, def = 0) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const on = (v) => v === "on" || v === "true" || v === "1";

function settingsTab(g, tenant) {
  const actionRows = Object.entries(game.ACTIONS)
    .map(([k, a]) => `<div class="fb-row" style="display:flex; gap:10px; align-items:center; margin-top:6px">
        <span style="flex:1">${esc(a.label)}</span>
        <input type="number" name="points_${k}" value="${g.points[k]}" min="0" max="10000" style="width:110px; margin:0">
      </div>`)
    .join("");
  return `
    <form method="post" action="/game/settings" class="grid split-form">
      <div class="card">
        <label style="display:flex; gap:10px; align-items:center; cursor:pointer; font-size:16px; font-weight:800; margin:0">
          <input type="checkbox" name="enabled" ${g.enabled ? "checked" : ""} style="width:auto; margin:0"> Geymifikatsiya yoqilgan
        </label>
        <p class="hint" style="margin:6px 0 0">Yoqilganda mijozlar komment, story, referal va viktorina uchun avtomatik ball oladi.</p>
        <label>Reyting nomi</label>
        <input name="title" value="${esc(g.title)}" maxlength="80">
        <label>Tavsif (ochiq sahifada ko'rinadi)</label>
        <textarea name="description" rows="3" maxlength="500">${esc(g.description)}</textarea>
        <h3>Harakatlar uchun ballar</h3>
        ${actionRows}
        <h3>Erta komment bonusi</h3>
        <div style="display:flex; gap:10px">
          <div style="flex:1"><label>Birinchi N ta komment</label><input type="number" name="earlyN" value="${g.earlyBonus.firstN}" min="0" max="1000"></div>
          <div style="flex:1"><label>Qo'shimcha ball</label><input type="number" name="earlyPoints" value="${g.earlyBonus.points}" min="0" max="10000"></div>
        </div>
      </div>
      <div>
        <div class="card">
          <h3 style="margin-top:0">🛡️ Cheklovlar</h3>
          <label>Kunlik ball limiti (0 — cheksiz)</label>
          <input type="number" name="dailyLimit" value="${g.dailyLimit}" min="0" max="100000">
          <label style="display:flex; gap:8px; align-items:center; cursor:pointer; margin-top:12px">
            <input type="checkbox" name="followersOnly" ${g.followersOnly ? "checked" : ""} style="width:auto; margin:0"> Faqat obunachilar ball oladi
          </label>
          <label>Instagram: minimal obunachilar soni (bot/soxta akkauntlardan himoya)</label>
          <input type="number" name="minFollowers" value="${g.minFollowers}" min="0" max="1000000">
          <label style="display:flex; gap:8px; align-items:center; cursor:pointer; margin-top:12px">
            <input type="checkbox" name="notifyOnAward" ${g.notifyOnAward ? "checked" : ""} style="width:auto; margin:0"> Ball berilganda mijozga xabar yuborish
          </label>
        </div>
        <div class="card">
          <h3 style="margin-top:0">💬 DM buyruqlari</h3>
          <p class="hint" style="margin-top:0; font-size:12.5px">Mijoz shu so'zlarni yozsa bot tegishli javobni beradi.</p>
          ${[["balance", "Balni ko'rish"], ["top", "Reyting"], ["shop", "Sovg'alar"], ["quiz", "Viktorina"], ["ref", "Taklif havolasi"]]
            .map(([k, l]) => `<label>${l}</label><input name="kw_${k}" value="${esc(g.keywords[k])}" maxlength="30">`)
            .join("")}
        </div>
        <div class="card">
          <h3 style="margin-top:0">🔗 Ochiq reyting sahifasi</h3>
          <div style="display:flex; gap:6px"><input readonly value="${esc(game.publicBoardUrl(tenant))}" style="margin:0; font-family:monospace; font-size:12px"><a class="btn secondary" href="/top/${esc(g.slug)}" target="_blank" style="margin:0">Ochish</a></div>
          <p class="hint" style="font-size:12px">Bio yoki story'ga qo'ying — mijozlar o'z o'rnini real vaqtda ko'radi.</p>
        </div>
        <button class="btn" style="width:100%">💾 Saqlash</button>
      </div>
    </form>
    <form method="post" action="/game/reset" onsubmit="return confirm('Barcha ballar nolga tushadi. Davom etilsinmi?')" style="margin-top:12px">
      <button class="secondary" style="color:#f87171">🔄 Yangi mavsum (ballarni nollash)</button>
    </form>`;
}

function rewardsTab(g) {
  const list = g.rewards.length
    ? g.rewards
        .map((r) => `<div class="card" style="margin-bottom:12px; border-left:4px solid ${game.rewardAvailable(r) ? "#4ade80" : "#64748b"}">
          <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap">
            <div><b style="font-size:16px">${esc(r.title)}</b> — <b style="color:#fbbf24">${r.cost} ball</b>
              <div class="hint" style="font-size:12.5px">${esc(r.description || "")}</div>
              <div class="hint" style="font-size:12px">Olindi: ${r.redeemedCount || 0}${r.limit ? ` / ${r.limit}` : ""}${r.codesMode ? ` · qolgan kodlar: ${(r.codes || []).length}` : ""}</div>
            </div>
            <div style="display:flex; gap:6px">
              <form method="post" action="/game/rewards/${esc(r.id)}/toggle" style="margin:0"><button class="secondary" style="padding:5px 10px; font-size:12px; margin:0">${r.active === false ? "⏸️ O'chiq" : "✅ Faol"}</button></form>
              <form method="post" action="/game/rewards/${esc(r.id)}/delete" style="margin:0" onsubmit="return confirm('O\\'chirilsinmi?')"><button class="secondary" style="padding:5px 10px; font-size:12px; margin:0; color:#f87171">🗑️</button></form>
            </div>
          </div>
        </div>`)
        .join("")
    : `<div class="card hint" style="text-align:center; padding:28px">Hali sovg'a yo'q</div>`;
  return `<div class="grid split-form">
    <div>${list}</div>
    <div class="card" style="border:1px solid #7c3aed; height:fit-content">
      <h3 style="margin-top:0">➕ Yangi sovg'a</h3>
      <form method="post" action="/game/rewards">
        <label>Nomi</label><input name="title" required maxlength="60" placeholder="10% chegirma">
        <label>Narxi (ball)</label><input type="number" name="cost" required min="1" max="1000000" value="100">
        <label>Tavsif</label><input name="description" maxlength="200" placeholder="Istalgan buyurtmaga">
        <label>Olganda yuboriladigan xabar</label><textarea name="message" rows="2" maxlength="500" placeholder="Menejer 24 soat ichida bog'lanadi"></textarea>
        <label>Soni cheklovi (0 — cheksiz)</label><input type="number" name="limit" min="0" max="100000" value="0">
        <label>Promokodlar (har qatorda bittasi — har bir oluvchiga alohida kod beriladi)</label>
        <textarea name="codes" rows="3" placeholder="SALE-7F2K&#10;SALE-9QX1"></textarea>
        <button class="btn" style="width:100%; margin-top:12px">Qo'shish</button>
      </form>
    </div>
  </div>`;
}

function quizTab(g) {
  const list = g.quizzes.length
    ? g.quizzes
        .map((q) => `<div class="card" style="margin-bottom:12px">
          <div style="display:flex; justify-content:space-between; gap:10px">
            <b>❓ ${esc(q.question)}</b>
            <form method="post" action="/game/quiz/${esc(q.id)}/delete" style="margin:0"><button class="secondary" style="padding:5px 10px; font-size:12px; margin:0; color:#f87171">🗑️</button></form>
          </div>
          <ol style="margin:8px 0 0; padding-left:20px">${q.options.map((o, i) => `<li style="${i === Number(q.correct) ? "color:#34d399; font-weight:700" : ""}">${esc(o)}</li>`).join("")}</ol>
          <div class="hint" style="font-size:12px; margin-top:6px">+${q.points || g.points.quiz} ball · javoblar: ${q.answers || 0} · to'g'ri: ${q.correctAnswers || 0}</div>
        </div>`)
        .join("")
    : `<div class="card hint" style="text-align:center; padding:28px">Hali savol yo'q</div>`;
  return `<div class="grid split-form">
    <div>${list}</div>
    <div class="card" style="border:1px solid #7c3aed; height:fit-content">
      <h3 style="margin-top:0">➕ Yangi savol</h3>
      <form method="post" action="/game/quiz">
        <label>Savol</label><textarea name="question" rows="2" required maxlength="300"></textarea>
        <label>Variantlar (har qatorda bittasi, 2-6 ta)</label><textarea name="options" rows="4" required placeholder="Variant A&#10;Variant B&#10;Variant C"></textarea>
        <label>To'g'ri javob raqami</label><input type="number" name="correct" min="1" max="6" value="1" required>
        <label>Ball (bo'sh — standart ${g.points.quiz})</label><input type="number" name="points" min="0" max="10000">
        <label>Izoh (javobdan keyin ko'rsatiladi)</label><input name="explanation" maxlength="300">
        <button class="btn" style="width:100%; margin-top:12px">Qo'shish</button>
      </form>
    </div>
  </div>`;
}

function playersTab(tenant, g) {
  const board = game.leaderboard(tenant, 100);
  const rows = board.length
    ? board.map((r) => `<tr>
        <td>${r.rank}</td><td>${esc(r.name)} <span class="hint" style="font-size:11px">${esc(r.channel)}</span></td>
        <td class="num"><b>${r.points}</b></td><td class="num">${g.participants[r.key]?.referrals || 0}</td>
        <td>
          <form method="post" action="/game/adjust" style="display:flex; gap:4px; margin:0">
            <input type="hidden" name="key" value="${esc(r.key)}">
            <input type="number" name="delta" placeholder="±ball" style="width:90px; margin:0">
            <button class="secondary" style="margin:0; padding:5px 10px; font-size:12px">OK</button>
          </form>
        </td>
      </tr>`).join("")
    : `<tr><td colspan="5" class="hint" style="text-align:center; padding:20px">Hali ishtirokchi yo'q</td></tr>`;
  const reds = g.redemptions.slice(0, 50);
  return `<div class="grid split-form">
    <div class="card" style="overflow-x:auto">
      <h3 style="margin-top:0">🏆 Reyting</h3>
      <table class="viz-table" style="width:100%; border-collapse:collapse; font-size:13.5px">
        <thead><tr style="text-align:left; color:var(--text-muted); font-size:12px"><th>#</th><th>Ishtirokchi</th><th class="num">Ball</th><th class="num">Taklif</th><th>Qo'lda</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="card" style="height:fit-content">
      <h3 style="margin-top:0">🎁 Olingan sovg'alar</h3>
      ${reds.length ? reds.map((r) => `<div style="display:flex; justify-content:space-between; gap:8px; padding:8px 0; border-bottom:1px solid var(--border)">
          <div><b>${esc(r.rewardTitle)}</b><div class="hint" style="font-size:12px">${esc(r.name)} · ${r.cost} ball${r.code ? ` · ${esc(r.code)}` : ""}</div></div>
          <form method="post" action="/game/redemptions/${esc(r.id)}/toggle" style="margin:0"><button class="secondary" style="margin:0; padding:4px 10px; font-size:12px">${r.status === "done" ? "✅ Berildi" : "🕐 Yangi"}</button></form>
        </div>`).join("") : `<p class="hint">Hali yo'q</p>`}
    </div>
  </div>`;
}

function logTab(tenant, g) {
  return `<div class="card">
    ${g.log.length ? g.log.slice(0, 150).map((l) => `<div style="display:flex; justify-content:space-between; gap:8px; padding:6px 0; border-bottom:1px solid var(--border); font-size:13.5px">
        <span>${esc(l.key === "-" ? "—" : game.participantName(tenant, l.key))} · ${esc(game.ACTIONS[l.action]?.label || l.action)}${l.note ? ` <span class="hint">(${esc(l.note)})</span>` : ""}</span>
        <span style="white-space:nowrap"><b style="color:${l.points >= 0 ? "#34d399" : "#f87171"}">${l.points > 0 ? "+" : ""}${l.points}</b> <span class="hint" style="font-size:11.5px">${esc(String(l.at).slice(0, 16).replace("T", " "))}</span></span>
      </div>`).join("") : `<p class="hint">Jurnal bo'sh</p>`}
  </div>`;
}

gameRouter.get("/game", requireAuth, (req, res) => {
  const u = req.user;
  const g = game.ensureGame(u);
  const tab = TABS.some(([k]) => k === req.query.tab) ? req.query.tab : "settings";
  const body = tab === "rewards" ? rewardsTab(g) : tab === "quiz" ? quizTab(g) : tab === "players" ? playersTab(u, g) : tab === "log" ? logTab(u, g) : settingsTab(g, u);
  const participants = Object.keys(g.participants).length;
  res.send(
    page(
      "Geymifikatsiya",
      `${req.query.saved ? `<div class="ok">Saqlandi ✅</div>` : ""}
      ${req.query.error ? `<div class="error">${esc(req.query.error)}</div>` : ""}
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:14px">
        <div class="status-tag" style="font-size:13px">${g.enabled ? "🟢 Faol" : "⚪ O'chiq"} · ${participants} ishtirokchi · ${g.rewards.length} sovg'a · ${g.quizzes.length} savol</div>
        <a class="btn secondary" href="/top/${esc(g.slug)}" target="_blank" style="margin:0">🏆 Ochiq reyting ↗</a>
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:16px">
        ${TABS.map(([k, l]) => `<a class="btn ${k === tab ? "" : "secondary"}" href="/game?tab=${k}" style="margin:0; padding:7px 14px; font-size:13px">${l}</a>`).join("")}
      </div>
      <style>.num{text-align:right}</style>
      ${body}`,
      { user: u, active: "game" }
    )
  );
});

gameRouter.post("/game/settings", requireAuth, (req, res) => {
  const g = game.ensureGame(req.user);
  const b = req.body || {};
  g.enabled = on(b.enabled);
  g.title = String(b.title || g.title).trim().slice(0, 80) || g.title;
  g.description = String(b.description || "").trim().slice(0, 500);
  for (const k of Object.keys(game.ACTIONS)) g.points[k] = int(b[`points_${k}`], 0, 10000, g.points[k]);
  g.earlyBonus = { firstN: int(b.earlyN, 0, 1000, 0), points: int(b.earlyPoints, 0, 10000, 0) };
  g.dailyLimit = int(b.dailyLimit, 0, 100000, g.dailyLimit);
  g.followersOnly = on(b.followersOnly);
  g.minFollowers = int(b.minFollowers, 0, 1000000, 0);
  g.notifyOnAward = on(b.notifyOnAward);
  for (const k of ["balance", "top", "shop", "quiz", "ref"]) {
    const v = String(b[`kw_${k}`] || "").trim().toLowerCase().slice(0, 30);
    if (v) g.keywords[k] = v;
  }
  persist(req.user);
  res.redirect("/game?saved=1");
});

gameRouter.post("/game/reset", requireAuth, (req, res) => {
  game.resetSeason(req.user);
  res.redirect("/game?tab=players&saved=1");
});

gameRouter.post("/game/rewards", requireAuth, (req, res) => {
  const g = game.ensureGame(req.user);
  const b = req.body || {};
  const title = String(b.title || "").trim().slice(0, 60);
  const cost = int(b.cost, 1, 1000000, 0);
  if (!title || !cost) return res.redirect("/game?tab=rewards&error=" + encodeURIComponent("Nomi va narxini kiriting"));
  const codes = String(b.codes || "").split("\n").map((c) => c.trim()).filter(Boolean).slice(0, 5000);
  g.rewards.push({
    id: game.rid("rw"),
    title,
    cost,
    description: String(b.description || "").trim().slice(0, 200),
    message: String(b.message || "").trim().slice(0, 500),
    limit: int(b.limit, 0, 100000, 0),
    codesMode: codes.length > 0,
    codes,
    redeemedCount: 0,
    active: true,
  });
  persist(req.user);
  res.redirect("/game?tab=rewards&saved=1");
});

gameRouter.post("/game/rewards/:id/toggle", requireAuth, (req, res) => {
  const r = game.ensureGame(req.user).rewards.find((x) => x.id === req.params.id);
  if (r) { r.active = r.active === false; persist(req.user); }
  res.redirect("/game?tab=rewards");
});

gameRouter.post("/game/rewards/:id/delete", requireAuth, (req, res) => {
  const g = game.ensureGame(req.user);
  g.rewards = g.rewards.filter((x) => x.id !== req.params.id);
  persist(req.user);
  res.redirect("/game?tab=rewards");
});

gameRouter.post("/game/quiz", requireAuth, (req, res) => {
  const g = game.ensureGame(req.user);
  const b = req.body || {};
  const question = String(b.question || "").trim().slice(0, 300);
  const options = String(b.options || "").split("\n").map((o) => o.trim().slice(0, 60)).filter(Boolean).slice(0, 6);
  const correct = int(b.correct, 1, options.length || 1, 1) - 1;
  if (!question || options.length < 2) return res.redirect("/game?tab=quiz&error=" + encodeURIComponent("Savol va kamida 2 ta variant kiriting"));
  g.quizzes.push({
    id: game.rid("qz"),
    question,
    options,
    correct,
    points: b.points === "" || b.points === undefined ? 0 : int(b.points, 0, 10000, 0),
    explanation: String(b.explanation || "").trim().slice(0, 300),
    active: true,
    answers: 0,
    correctAnswers: 0,
  });
  persist(req.user);
  res.redirect("/game?tab=quiz&saved=1");
});

gameRouter.post("/game/quiz/:id/delete", requireAuth, (req, res) => {
  const g = game.ensureGame(req.user);
  g.quizzes = g.quizzes.filter((q) => q.id !== req.params.id);
  persist(req.user);
  res.redirect("/game?tab=quiz");
});

gameRouter.post("/game/adjust", requireAuth, (req, res) => {
  const g = game.ensureGame(req.user);
  const key = String(req.body?.key || "");
  const delta = int(req.body?.delta, -1000000, 1000000, 0);
  if (g.participants[key] && delta) game.adjustPoints(req.user, key, delta, "Panel orqali");
  res.redirect("/game?tab=players");
});

gameRouter.post("/game/redemptions/:id/toggle", requireAuth, (req, res) => {
  const r = game.ensureGame(req.user).redemptions.find((x) => x.id === req.params.id);
  if (r) { r.status = r.status === "done" ? "new" : "done"; persist(req.user); }
  res.redirect("/game?tab=players");
});

// ==== Ochiq reyting sahifasi ====

async function findBySlug(slug) {
  const s = String(slug || "");
  if (!/^[a-f0-9]{6,20}$/.test(s)) return null;
  return (await listUsers()).find((u) => u.gamification?.slug === s) || null;
}

/** Ochiq sahifada ism to'liq ko'rinmasin (username — ochiq, telefon/ism — qisqartiriladi). */
function publicName(tenant, key) {
  const p = tenant.gamification.participants[key];
  if (p?.username) return "@" + p.username;
  const name = game.participantName(tenant, key);
  return name.length > 3 ? name.slice(0, 3) + "***" : name;
}

gameRouter.get("/top/:slug", async (req, res) => {
  const tenant = await findBySlug(req.params.slug);
  if (!tenant || !tenant.gamification?.enabled) {
    return res.status(404).send(page("Reyting topilmadi", `<div class="card center"><h2>Reyting topilmadi</h2><p class="hint">Havola noto'g'ri yoki reyting hozircha o'chiq.</p></div>`, {}));
  }
  const g = game.ensureGame(tenant);
  const board = game.leaderboard(tenant, 100);
  const medal = (i) => (i === 1 ? "🥇" : i === 2 ? "🥈" : i === 3 ? "🥉" : String(i));
  const rewards = g.rewards.filter(game.rewardAvailable);
  const chanIcon = { ig: "📷", tg: "✈️", fb: "🔵", wa: "💬" };
  res.setHeader("Cache-Control", "no-cache");
  res.send(
    page(
      `${g.title} — ${tenant.businessName || ""}`,
      `<meta http-equiv="refresh" content="60">
      <style>
        .lb-hero { text-align:center; padding:24px 12px 8px }
        .lb-hero h1 { margin:0; font-size:30px }
        .lb-row { display:flex; align-items:center; gap:12px; padding:12px 16px; border-bottom:1px solid var(--border) }
        .lb-row:last-child { border-bottom:0 }
        .lb-rank { width:34px; text-align:center; font-weight:800; font-size:18px }
        .lb-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600 }
        .lb-pts { font-weight:800; font-variant-numeric:tabular-nums }
        .lb-top3 { background:rgba(139,92,246,0.08) }
      </style>
      <div class="lb-hero">
        <div class="hint">${esc(tenant.businessName || "")}</div>
        <h1>🏆 ${esc(g.title)}</h1>
        <p class="hint" style="max-width:560px; margin:10px auto">${esc(g.description)}</p>
      </div>
      <div class="card" style="padding:0; overflow:hidden">
        ${board.length ? board.map((r) => `<div class="lb-row ${r.rank <= 3 ? "lb-top3" : ""}">
            <div class="lb-rank">${medal(r.rank)}</div>
            <div class="lb-name">${chanIcon[splitKey(r.key).chan] || ""} ${esc(publicName(tenant, r.key))}</div>
            <div class="lb-pts">${r.points.toLocaleString("ru-RU")}</div>
          </div>`).join("") : `<p class="hint" style="text-align:center; padding:30px">Hali hech kim ball to'plamagan — birinchi bo'ling! 🚀</p>`}
      </div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:14px">
        <div class="card">
          <h3 style="margin-top:0">⭐ Qanday ball to'planadi</h3>
          <div style="white-space:pre-line; font-size:14px">${esc(game.earnRulesText(tenant))}</div>
          <p class="hint" style="font-size:12.5px">Balingizni bilish uchun Direct'ga "<b>${esc(g.keywords.balance)}</b>" deb yozing.</p>
        </div>
        ${rewards.length ? `<div class="card"><h3 style="margin-top:0">🎁 Sovg'alar</h3>${rewards.map((r) => `<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border)"><span>${esc(r.title)}</span><b>${r.cost} ball</b></div>`).join("")}<p class="hint" style="font-size:12.5px">Olish uchun Direct'ga "<b>${esc(g.keywords.shop)}</b>" deb yozing.</p></div>` : ""}
      </div>
      <p class="hint" style="text-align:center; font-size:12px">Sahifa har daqiqada yangilanadi</p>`,
      {}
    )
  );
});
