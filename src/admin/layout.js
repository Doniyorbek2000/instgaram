/**
 * Admin panel ko'rinishi — biznes panelidan alohida, mustaqil dizayn.
 */
import { esc } from "../web/layout.js";
import { logoMark } from "../web/brand.js";
import { icon } from "../web/icons.js";

const NAV = [
  ["/admin", "dashboard", "grid", "Boshqaruv"],
  ["/admin/businesses", "businesses", "users", "Bizneslar"],
  ["/admin/payments", "payments", "card", "To'lovlar"],
  ["/admin/plans", "plans", "chart", "Tariflar va kreditlar"],
  ["/admin/ai", "ai", "spark", "AI va kalitlar"],
  ["/admin/announce", "announce", "megaphone", "E'lonlar"],
  ["/admin/audit", "audit", "layout", "Audit jurnali"],
  ["/admin/system", "system", "gear", "Tizim holati"],
  ["/admin/security", "security", "shield", "Xavfsizlik"],
];

const CSS = `
  :root { --bg:#0a0d16; --panel:#111626; --panel-2:#161c30; --line:#222a42; --ink:#e6e9f2; --muted:#8a93ab; --brand:#8b5cf6; --brand-2:#ec4899;
    --ok:#10b981; --warn:#f59e0b; --bad:#ef4444; --info:#38bdf8; --r:14px; }
  * { box-sizing:border-box }
  html,body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.55 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing:antialiased }
  a { color:#c4b5fd; text-decoration:none } a:hover { color:#ddd6fe }
  .shell { display:grid; grid-template-columns:248px 1fr; min-height:100vh }
  .side { background:#0d1120; border-right:1px solid var(--line); padding:18px 12px; position:sticky; top:0; height:100vh; overflow-y:auto; align-self:start }
  .shell { background:linear-gradient(90deg, #0d1120 248px, transparent 248px) }
  .brand { display:flex; align-items:center; gap:10px; padding:4px 10px 18px; font-weight:800; font-size:16px; color:#fff }
  .brand small { display:block; font-size:10.5px; font-weight:700; letter-spacing:.12em; color:var(--brand); text-transform:uppercase }
  .nav a { display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:10px; color:#aeb5c9; font-weight:600; margin-bottom:2px }
  .nav a:hover { background:rgba(255,255,255,.04); color:#fff }
  .nav a.on { background:linear-gradient(120deg, rgba(139,92,246,.22), rgba(236,72,153,.14)); color:#fff; box-shadow:inset 3px 0 0 var(--brand) }
  .side .foot { margin-top:18px; padding:12px; border-top:1px solid var(--line); font-size:12.5px; color:var(--muted) }
  .main { min-width:0 }
  .top { display:flex; align-items:center; gap:12px; padding:16px 28px; border-bottom:1px solid var(--line); background:rgba(10,13,22,.85); backdrop-filter:blur(10px); position:sticky; top:0; z-index:5 }
  .top h1 { font-size:19px; margin:0; flex:1; letter-spacing:-.01em }
  .content { padding:24px 28px 60px; max-width:1400px }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:var(--r); padding:18px 20px; margin-bottom:16px }
  .card h2 { font-size:15.5px; margin:0 0 12px; display:flex; align-items:center; gap:8px }
  .grid { display:grid; gap:14px }
  .kpis { grid-template-columns:repeat(auto-fit, minmax(165px, 1fr)); margin-bottom:16px }
  .kpi { background:var(--panel); border:1px solid var(--line); border-radius:var(--r); padding:16px 18px }
  .kpi .l { color:var(--muted); font-size:12.5px; font-weight:600 }
  .kpi .v { font-size:26px; font-weight:800; letter-spacing:-.02em; margin-top:4px }
  .kpi .s { font-size:12px; color:var(--muted); margin-top:2px }
  .kpi .s.up { color:var(--ok) } .kpi .s.down { color:var(--bad) }
  .two { grid-template-columns:1.4fr 1fr } .half { grid-template-columns:1fr 1fr }
  table { width:100%; border-collapse:collapse; font-size:13.5px }
  th { text-align:left; font-size:11.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); font-weight:700; padding:10px 10px; border-bottom:1px solid var(--line); white-space:nowrap }
  td { padding:11px 10px; border-bottom:1px solid rgba(255,255,255,.04); vertical-align:middle }
  tr:hover td { background:rgba(255,255,255,.015) }
  .tw { overflow-x:auto; margin:0 -4px }
  .pill { display:inline-flex; align-items:center; gap:5px; padding:2px 9px; border-radius:99px; font-size:11.5px; font-weight:700; border:1px solid transparent; white-space:nowrap }
  .pill.ok { color:#34d399; background:rgba(16,185,129,.12); border-color:rgba(16,185,129,.25) }
  .pill.warn { color:#fbbf24; background:rgba(245,158,11,.12); border-color:rgba(245,158,11,.25) }
  .pill.bad { color:#f87171; background:rgba(239,68,68,.12); border-color:rgba(239,68,68,.25) }
  .pill.info { color:#7dd3fc; background:rgba(56,189,248,.12); border-color:rgba(56,189,248,.25) }
  .pill.mute { color:#aeb5c9; background:rgba(255,255,255,.05); border-color:var(--line) }
  input, select, textarea { width:100%; background:#0b0f1c; border:1px solid var(--line); color:var(--ink); border-radius:10px; padding:10px 12px; font:inherit; margin:4px 0 10px }
  input:focus, select:focus, textarea:focus { outline:none; border-color:var(--brand); box-shadow:0 0 0 3px rgba(139,92,246,.2) }
  label { display:block; font-size:12px; font-weight:700; color:#aeb5c9; margin-top:4px }
  .btn { display:inline-flex; align-items:center; justify-content:center; gap:7px; padding:9px 16px; border-radius:10px; border:0; cursor:pointer; font:inherit; font-weight:700;
    background:linear-gradient(120deg, var(--brand), var(--brand-2)); color:#fff; white-space:nowrap }
  .btn:hover { filter:brightness(1.08); color:#fff }
  .btn.sec { background:var(--panel-2); border:1px solid var(--line); color:var(--ink) }
  .btn.sec:hover { border-color:#3a4466 }
  .btn.danger { background:rgba(239,68,68,.14); border:1px solid rgba(239,68,68,.35); color:#fca5a5 }
  .btn.sm { padding:6px 11px; font-size:12.5px; border-radius:8px }
  .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap }
  .row > .grow { flex:1; min-width:180px }
  .hint { color:var(--muted); font-size:12.5px }
  .flash { padding:11px 14px; border-radius:10px; margin-bottom:16px; font-weight:600 }
  .flash.ok { background:rgba(16,185,129,.12); border:1px solid rgba(16,185,129,.3); color:#6ee7b7 }
  .flash.bad { background:rgba(239,68,68,.12); border:1px solid rgba(239,68,68,.3); color:#fca5a5 }
  .flash.warn { background:rgba(245,158,11,.12); border:1px solid rgba(245,158,11,.3); color:#fcd34d }
  .chart svg { width:100%; height:auto; display:block }
  .chart .bar { fill:url(#g) } .chart .bar:hover { fill:#f0abfc }
  .chart text { fill:var(--muted); font-size:10px }
  .kv { display:grid; grid-template-columns:170px 1fr; gap:6px 14px; font-size:13.5px }
  .kv div:nth-child(odd) { color:var(--muted) }
  .tabs { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px }
  .menu-toggle { display:none }
  code { background:#0b0f1c; border:1px solid var(--line); padding:1px 6px; border-radius:6px; font-size:12.5px }
  @media (max-width: 960px) {
    .shell { grid-template-columns:1fr; background:none }
    .side { position:fixed; inset:0 auto 0 0; width:260px; transform:translateX(-102%); transition:transform .2s; z-index:40; box-shadow:20px 0 50px rgba(0,0,0,.5) }
    #mt:checked ~ .shell .side { transform:none }
    .menu-toggle { display:inline-grid; place-items:center; width:38px; height:38px; border-radius:10px; border:1px solid var(--line); background:var(--panel); cursor:pointer; font-size:18px }
    .two, .half { grid-template-columns:1fr }
    .content { padding:18px 16px 60px } .top { padding:12px 16px }
    .kv { grid-template-columns:1fr }
  }
`;

export function adminPage(title, body, { active = "", flash = "", flashKind = "ok", actions = "" } = {}) {
  return `<!DOCTYPE html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Obunext Admin</title><meta name="robots" content="noindex, nofollow">
<link rel="icon" href="/favicon.png" type="image/png"><style>${CSS}</style></head><body>
<input type="checkbox" id="mt" hidden>
<div class="shell">
  <aside class="side">
    <div class="brand">${logoMark(30)}<div>Obunext<small>Admin panel</small></div></div>
    <nav class="nav">${NAV.map(([href, key, ic, label]) => `<a href="${href}" class="${active === key ? "on" : ""}">${icon(ic, { size: 17 })} ${esc(label)}</a>`).join("")}</nav>
    <div class="foot">
      <form method="post" action="/admin/logout" style="margin:0"><button class="btn sec sm" style="width:100%">⎋ Chiqish</button></form>
      <div style="margin-top:10px">Obunext platformasi</div>
    </div>
  </aside>
  <div class="main">
    <div class="top"><label for="mt" class="menu-toggle">☰</label><h1>${esc(title)}</h1>${actions}</div>
    <div class="content">${flash ? `<div class="flash ${flashKind}">${esc(flash)}</div>` : ""}${body}</div>
  </div>
</div></body></html>`;
}

/** Oddiy ustunli grafik (SVG + HTML yorliqlar, JS'siz). points: [{ label, value, title }] */
export function barChart(points, { height = 150, format = (v) => String(v) } = {}) {
  if (!points.some((p) => p.value > 0)) return `<div class="hint" style="height:${height}px; display:grid; place-items:center; border:1px dashed var(--line); border-radius:10px">Bu davrda ma'lumot yo'q</div>`;
  const n = Math.max(1, points.length);
  const max = Math.max(1, ...points.map((p) => p.value));
  const W = 1000;
  const bw = W / n;
  const bars = points.map((p, i) => {
    const h = (p.value / max) * (height - 6);
    return `<rect class="bar" x="${(i * bw + bw * 0.14).toFixed(1)}" y="${(height - h).toFixed(1)}" width="${(bw * 0.72).toFixed(1)}" height="${Math.max(h, p.value ? 2 : 0).toFixed(1)}" rx="4"><title>${esc(p.title || p.label)}: ${esc(format(p.value))}</title></rect>`;
  }).join("");
  const step = Math.ceil(n / 8);
  const labels = points.map((p, i) => `<span style="flex:1; text-align:center">${i % step === 0 ? esc(p.label) : ""}</span>`).join("");
  return `<div class="chart"><svg viewBox="0 0 ${W} ${height}" preserveAspectRatio="none" style="height:${height}px" role="img" aria-label="grafik">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>
    <line x1="0" x2="${W}" y1="${height - 0.5}" y2="${height - 0.5}" stroke="#222a42"/>${bars}</svg>
    <div style="display:flex; font-size:10.5px; color:var(--muted); margin-top:4px">${labels}</div>
    <div class="hint" style="text-align:right">eng ko'p: ${esc(format(max))} · jami: ${esc(format(points.reduce((s, p) => s + p.value, 0)))}</div></div>`;
}

export const money = (n) => `${String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} so'm`;
export const fmtDate = (d) => {
  const t = typeof d === "number" ? d : Date.parse(d);
  return Number.isFinite(t) ? new Date(t).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
};
