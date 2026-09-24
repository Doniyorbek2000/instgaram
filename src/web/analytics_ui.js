/**
 * Analitika (/analytics) — ChatPlace "Analytics" bo'limi ekvivalenti:
 * kunlik xabarlar, flow'lar (boshlandi / konversiya), har bir flow va qoida
 * bo'yicha jadval. Davr: 7 / 30 / 90 kun.
 */
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { ensureFlows, dailySeries } from "../flows.js";
import { ensureRules } from "../rules.js";
import { allContacts, lastInboundAt } from "../broadcasts.js";

export const analyticsRouter = Router();

const PERIODS = [7, 30, 90];

function safeJson(v) {
  return JSON.stringify(v).replace(/</g, "\\u003c");
}

function periodTotals(tenant, flows, series, days) {
  const since = Date.now() - days * 86400000;
  const sum = (k) => series.reduce((a, r) => a + (r[k] || 0), 0);
  return {
    messages: sum("messages"),
    active: allContacts(tenant).filter((k) => lastInboundAt(tenant, k) >= since).length,
    started: sum("started"),
    conversions: sum("conversions"),
  };
}

analyticsRouter.get("/analytics", requireAuth, (req, res) => {
  const u = req.user;
  const days = PERIODS.includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const flows = ensureFlows(u).list;
  const series = dailySeries(u, flows, days).map((r) => ({ ...r, messages: u.stats?.days?.[r.date] || 0 }));
  const t = periodTotals(u, flows, series, days);
  const cr = t.started ? Math.round((t.conversions / t.started) * 1000) / 10 : 0;
  const rules = ensureRules(u);

  const tile = (label, value, sub = "") => `
    <div class="card viz-tile">
      <div class="viz-tile-label">${label}</div>
      <div class="viz-tile-value">${value}</div>
      ${sub ? `<div class="viz-tile-sub">${sub}</div>` : ""}
    </div>`;

  const flowRows = flows
    .map((f) => {
      const s = f.stats || {};
      const periodDays = series.map((r) => f.stats?.daily?.[r.date] || {});
      const ps = periodDays.reduce((a, d) => a + (d.started || 0), 0);
      const pc = periodDays.reduce((a, d) => a + (d.conversions || 0), 0);
      return `<tr>
        <td><a href="/flows/${encodeURIComponent(f.id)}">${esc(f.name)}</a> ${f.enabled ? "" : `<span class="hint">(o'chiq)</span>`}</td>
        <td class="num">${ps}</td><td class="num">${pc}</td>
        <td class="num">${ps ? Math.round((pc / ps) * 100) : 0}%</td>
        <td class="num hint">${s.started || 0} / ${s.conversions || 0}</td>
      </tr>`;
    })
    .join("");

  const ruleRows = rules
    .map((r) => {
      const s = r.stats || {};
      return `<tr>
        <td><a href="/triggers/edit/${encodeURIComponent(r.id)}">${esc(r.name)}</a></td>
        <td class="num">${s.triggered || 0}</td><td class="num">${s.sent || 0}</td>
        <td class="num">${s.gatePassed || 0}</td>
        <td class="num">${s.triggered ? Math.round(((s.sent || 0) / s.triggered) * 100) : 0}%</td>
      </tr>`;
    })
    .join("");

  res.send(
    page(
      "Analitika",
      `
      <style>
        .viz-filters { display:flex; gap:6px; margin-bottom:16px; flex-wrap:wrap }
        .viz-filters a { margin:0; padding:7px 14px; font-size:13px }
        .viz-tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px; margin-bottom:16px }
        .viz-tile { margin:0 }
        .viz-tile-label { font-size:12.5px; color:var(--text-muted) }
        .viz-tile-value { font-size:28px; font-weight:800; color:#fff; line-height:1.2; font-variant-numeric:tabular-nums }
        .viz-tile-sub { font-size:12px; color:var(--text-muted) }
        .viz-card h3 { margin:0 0 2px; font-size:16px }
        .viz-card .hint { margin:0 0 10px }
        .viz-host { position:relative; width:100%; min-height:240px }
        .viz-host svg { display:block; width:100%; height:auto; overflow:visible }
        .viz-tip { position:absolute; pointer-events:none; background:#0b0f19; border:1px solid rgba(255,255,255,0.14); border-radius:8px; padding:6px 10px; font-size:12px; white-space:nowrap; box-shadow:0 8px 20px rgba(0,0,0,.5); z-index:3 }
        .viz-tip-date { color:var(--text-muted); margin-bottom:2px }
        .viz-tip-row { display:flex; align-items:center; gap:6px }
        .viz-tip-row b { color:#fff }
        .viz-key { display:inline-block; width:12px; height:2px; border-radius:2px }
        .viz-legend { display:flex; gap:14px; font-size:12.5px; color:#cbd5e1; margin-bottom:6px }
        .viz-legend span { display:inline-flex; align-items:center; gap:6px }
        .viz-table { width:100%; border-collapse:collapse; font-size:13.5px }
        .viz-table th { text-align:left; font-size:11.5px; color:var(--text-muted); font-weight:700; padding:6px 8px; border-bottom:1px solid var(--border) }
        .viz-table td { padding:8px; border-bottom:1px solid rgba(255,255,255,0.04) }
        .viz-table .num { text-align:right; font-variant-numeric:tabular-nums }
        .viz-table th.num { text-align:right }
      </style>
      <div class="viz-filters">
        ${PERIODS.map((d) => `<a class="btn ${d === days ? "" : "secondary"}" href="/analytics?days=${d}">Oxirgi ${d} kun</a>`).join("")}
      </div>
      <div class="viz-tiles">
        ${tile("Kiruvchi xabarlar", t.messages.toLocaleString("ru-RU"), `oxirgi ${days} kun`)}
        ${tile("Faol kontaktlar", t.active.toLocaleString("ru-RU"), "shu davrda yozganlar")}
        ${tile("Flow ishga tushdi", t.started.toLocaleString("ru-RU"))}
        ${tile("Konversiyalar", t.conversions.toLocaleString("ru-RU"), `konversiya darajasi ${cr}%`)}
      </div>

      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(360px,1fr)); gap:16px">
        <div class="card viz-card">
          <h3>Kunlik kiruvchi xabarlar</h3>
          <p class="hint">Barcha kanallar bo'yicha</p>
          <div class="viz-host" id="vizMessages"></div>
        </div>
        <div class="card viz-card">
          <h3>Flow'lar: boshlanish va konversiya</h3>
          <p class="hint">Konversiya — flow'dagi "Konversiyani qayd etish" amaliga yetganlar</p>
          <div class="viz-legend">
            <span><i class="viz-key" style="background:#3987e5"></i>Boshlandi</span>
            <span><i class="viz-key" style="background:#d95926"></i>Konversiya</span>
          </div>
          <div class="viz-host" id="vizFlows"></div>
        </div>
      </div>

      <div class="card" style="margin-top:16px; overflow-x:auto">
        <h3 style="margin-top:0">🧩 Flow'lar</h3>
        ${flows.length ? `<table class="viz-table">
          <thead><tr><th>Flow</th><th class="num">Boshlandi</th><th class="num">Konversiya</th><th class="num">CR</th><th class="num">Jami (boshl. / konv.)</th></tr></thead>
          <tbody>${flowRows}</tbody></table>` : `<p class="hint">Hali flow yo'q — <a href="/flows">yaratish</a></p>`}
      </div>

      <div class="card" style="overflow-x:auto">
        <h3 style="margin-top:0">⚡ Tezkor qoidalar</h3>
        ${rules.length ? `<table class="viz-table">
          <thead><tr><th>Qoida</th><th class="num">Ishga tushdi</th><th class="num">Yuborildi</th><th class="num">Obuna bo'ldi</th><th class="num">CR</th></tr></thead>
          <tbody>${ruleRows}</tbody></table>` : `<p class="hint">Qoidalar yo'q</p>`}
      </div>

      <details class="card">
        <summary style="cursor:pointer; font-weight:700">📋 Kunlik jadval (grafik ma'lumotlari)</summary>
        <div style="overflow-x:auto; margin-top:10px">
          <table class="viz-table">
            <thead><tr><th>Sana</th><th class="num">Xabarlar</th><th class="num">Flow boshlandi</th><th class="num">Yakunlandi</th><th class="num">Konversiya</th></tr></thead>
            <tbody>${series.slice().reverse().map((r) => `<tr><td>${r.date}</td><td class="num">${r.messages}</td><td class="num">${r.started}</td><td class="num">${r.completed}</td><td class="num">${r.conversions}</td></tr>`).join("")}</tbody>
          </table>
        </div>
      </details>

      <script type="application/json" id="vizData">${safeJson(series)}</script>
      <script src="/assets/charts.js"></script>`,
      { user: u, active: "analytics" }
    )
  );
});
