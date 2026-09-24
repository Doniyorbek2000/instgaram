import { logoMark } from "./brand.js";
import { isAdmin } from "../auth.js";
import { currentActor, canAccess } from "../team.js";
import { icon } from "./icons.js";

/** Barcha ilova sahifalari uchun Obunext uslubidagi to'q-binafsha Glassmorphism HTML qobig'i */
export function page(title, body, { user, active = "" } = {}) {
  // Admin menyusi faqat haqiqiy kirgan shaxs admin bo'lsa ko'rinadi (jamoa a'zosi
  // admin egasining ish maydoniga o'tganda ko'rinmaydi)
  const actor = currentActor();
  const admin = isAdmin(actor ? actor.user : user);
  return `<!DOCTYPE html>
<html lang="uz">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Obunext Automation Studio</title>
<link rel="icon" href="/favicon.png" type="image/png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root {
    --bg-dark: #0b0f19;
    --bg-card: #151d30;
    --bg-card-hover: #1c2742;
    --bg-input: #0e1424;
    --border: rgba(255, 255, 255, 0.08);
    --border-hover: rgba(255, 255, 255, 0.18);
    --text-main: #f8fafc;
    --text-muted: #94a3b8;
    
    --accent-violet: #8b5cf6;
    --accent-pink: #ec4899;
    --accent-emerald: #10b981;
    --accent-cyan: #06b6d4;
    --accent-blue: #3b82f6;
    
    --grad-primary: linear-gradient(135deg, #8b5cf6 0%, #d946ef 50%, #f43f5e 100%);
    --grad-glow: linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(217, 70, 239, 0.15) 100%);
    
    --ok-bg: rgba(16, 185, 129, 0.15); --ok-fg: #34d399; --ok-bd: rgba(16, 185, 129, 0.3);
    --err-bg: rgba(244, 63, 94, 0.15); --err-fg: #fb7185; --err-bd: rgba(244, 63, 94, 0.3);
    --warn-bg: rgba(245, 158, 11, 0.15); --warn-fg: #fbbf24; --warn-bd: rgba(245, 158, 11, 0.3);
    
    --radius: 14px;
    --radius-sm: 8px;
    --shadow-card: 0 10px 30px -5px rgba(0, 0, 0, 0.5);
    --ring: 0 0 0 3px rgba(139, 92, 246, 0.3);
  }

  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0; font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
    background: var(--bg-dark); color: var(--text-main); line-height: 1.6; -webkit-font-smoothing: antialiased;
    animation: fadeIn 0.25s ease-out;
  }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  a { color: #a78bfa; text-decoration: none; transition: 0.15s; }
  a:hover { color: #c4b5fd; text-decoration: none; }

  /* Klaviatura bilan navigatsiya qilganda (Tab) aniq ko'rinadigan fokus halqasi —
     sichqoncha bilan bosilganda chiqmaydi (accessibility, lekin vizual shovqin qilmaydi) */
  a:focus-visible, button:focus-visible, .btn:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible {
    outline: 2px solid var(--accent-violet); outline-offset: 2px;
  }

  /* Ingichka, mavzuga mos scrollbar (Chrome/Edge/Safari) */
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 20px; border: 2px solid transparent; background-clip: padding-box; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); background-clip: padding-box; }
  * { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) transparent; }

  /* Layout Shell */
  .shell { display: flex; min-height: 100vh; }
  .sidebar {
    width: 260px; flex: none; background: #0e1424; border-right: 1px solid var(--border);
    padding: 20px 16px; display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh; z-index: 30;
  }
  .sidebar .brand { display: flex; align-items: center; gap: 12px; font-weight: 800; font-size: 18px; padding: 4px 8px 20px; color: #fff; text-decoration: none; border-bottom: 1px solid var(--border); margin-bottom: 18px; }
  .side-nav { display: flex; flex-direction: column; gap: 3px; flex: 1; overflow-y: auto; }
  .side-sec { font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #64748b; padding: 12px 14px 4px; }
  .side-sec:first-child { padding-top: 0; }
  .side-nav a { display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-radius: 10px; color: var(--text-muted); font-weight: 600; font-size: 14px; transition: 0.15s; }
  .side-nav a:hover { background: rgba(255,255,255,0.05); color: #fff; }
  .side-nav a.active { background: var(--grad-primary); color: #fff; font-weight: 700; box-shadow: 0 4px 15px rgba(139, 92, 246, 0.4); }
  .side-nav a .i { display: inline-flex; align-items: center; justify-content: center; width: 22px; color: inherit; }

  .side-foot { border-top: 1px solid var(--border); padding-top: 14px; }
  .side-user { display: flex; align-items: center; gap: 12px; padding: 8px; margin-bottom: 8px; }
  .side-user .av { width: 38px; height: 38px; border-radius: 10px; background: var(--grad-primary); display: grid; place-items: center; color: #fff; font-weight: 800; font-size: 16px; }
  .side-user .nm { font-size: 14px; font-weight: 700; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .side-user .em { font-size: 12px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .side-logout { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 10px; color: #fb7185; font-size: 13.5px; font-weight: 600; background: rgba(244,63,94,0.1); }
  .side-logout:hover { background: rgba(244,63,94,0.2); }

  .content { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .topbar {
    position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: space-between;
    padding: 16px 32px; border-bottom: 1px solid var(--border);
    background: rgba(11, 15, 25, 0.85); backdrop-filter: blur(12px);
  }
  .topbar h1 { font-size: 20px; font-weight: 800; margin: 0; letter-spacing: -0.02em; color: #fff; }
  .topbar-right { display: flex; align-items: center; gap: 16px; }
  .status-tag { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; background: var(--ok-bg); color: var(--ok-fg); border: 1px solid var(--ok-bd); }
  .status-tag .dot { width: 7px; height: 7px; border-radius: 50%; background: #34d399; box-shadow: 0 0 8px #34d399; }

  main.app { width: 100%; max-width: 100%; margin: 20px 0; padding: 0 24px; }

  /* Public Header */
  header.pub { background: #0e1424; border-bottom: 1px solid var(--border); padding: 16px 32px; display: flex; justify-content: space-between; align-items: center; }
  header.pub .brand { display: inline-flex; align-items: center; gap: 12px; font-weight: 800; color: #fff; font-size: 18px; }
  main.pub { max-width: 860px; margin: 40px auto; padding: 0 20px; }

  /* Cards & Grid Containers */
  .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px; margin-bottom: 20px; box-shadow: var(--shadow-card); transition: 0.18s; }
  .card.center { max-width: 460px; margin: 8vh auto; }
  /* Bosiladigan (havola) kartalar — .card ustiga qo'shiladi, sichqoncha ustida
     ko'tarilib, binafsha chekka bilan "bosish mumkin"ligini bildiradi. */
  a.card-link { display: block; cursor: pointer; }
  a.card-link:hover { transform: translateY(-3px); border-color: rgba(139, 92, 246, 0.45); box-shadow: 0 14px 34px -8px rgba(139, 92, 246, 0.35); }
  h1 { font-size: 26px; font-weight: 800; margin: 0 0 10px; letter-spacing: -0.03em; color: #fff; }
  h2 { font-size: 20px; font-weight: 700; margin: 0 0 14px; letter-spacing: -0.02em; color: #fff; }
  h3 { font-size: 16px; font-weight: 700; margin: 0 0 10px; letter-spacing: -0.01em; color: #fff; }
  p { margin: 0 0 12px; color: #cbd5e1; } p.hint { color: var(--text-muted); font-size: 13.5px; margin-top: 4px; }

  /* Bo'sh holat (ma'lumot hali yo'q) — ro'yxat/jadval bo'sh bo'lganda barcha
     sahifalarda bir xil, ozoda ko'rinish uchun. */
  .empty-state { text-align: center; padding: 48px 20px; color: var(--text-muted); }
  .empty-state .ic { font-size: 40px; margin-bottom: 12px; opacity: 0.7; }
  .empty-state b { display: block; color: #fff; font-size: 15px; margin-bottom: 4px; }

  /* Responsive grid utility (butun panel bo'ylab .grid.cols-2/3/4 sifatida ishlatiladi) */
  .grid { display: grid; gap: 16px; margin-bottom: 20px; }
  .grid.cols-2 { grid-template-columns: repeat(2, 1fr); }
  .grid.cols-3 { grid-template-columns: repeat(3, 1fr); }
  .grid.cols-4 { grid-template-columns: repeat(4, 1fr); }
  /* Asosiy kontent + o'ng tomonda sobit kenglikdagi "yangi qo'shish" forma paneli
     (Triggers/Broadcasts/Scheduler'da ishlatiladi) — mobil'da bitta ustunga tushadi. */
  .grid.split-form { grid-template-columns: 1fr 400px; gap: 24px; }

  /* Jadvallar — tor ekranda butun sahifa emas, faqat jadvalning o'zi gorizontal aylanadi */
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; border: 1px solid var(--border); border-radius: var(--radius); }
  table.tbl { width: 100%; border-collapse: collapse; font-size: 13.5px; white-space: nowrap; }
  table.tbl th { text-align: left; padding: 12px 14px; color: var(--text-muted); font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid var(--border); }
  table.tbl td { padding: 12px 14px; border-bottom: 1px solid var(--border); }
  table.tbl tr:last-child td { border-bottom: 0; }
  table.tbl tbody tr:hover { background: rgba(255,255,255,0.03); }

  /* Form Elements */
  label { display: block; font-size: 13px; font-weight: 700; margin: 16px 0 6px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.04em; }
  input, textarea, select { width: 100%; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 14px; font-family: inherit; color: #fff; background: var(--bg-input); transition: 0.15s; }
  input::placeholder, textarea::placeholder { color: #475569; }
  input:focus, textarea:focus, select:focus { outline: none; border-color: var(--accent-violet); box-shadow: var(--ring); }
  textarea { min-height: 120px; resize: vertical; line-height: 1.5; }

  /* Buttons */
  button, .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: var(--grad-primary); color: #fff; border: 0; border-radius: var(--radius-sm); padding: 11px 22px; font-size: 14px; font-weight: 700; cursor: pointer; transition: 0.15s; text-decoration: none; box-shadow: 0 4px 15px rgba(139, 92, 246, 0.3); }
  button:hover, .btn:hover { opacity: 0.95; transform: translateY(-1px); box-shadow: 0 6px 20px rgba(139, 92, 246, 0.5); text-decoration: none; color: #fff; }
  button.secondary, .btn.secondary { background: #1e293b; color: #f8fafc; border: 1px solid var(--border); box-shadow: none; }
  button.secondary:hover, .btn.secondary:hover { background: #334155; border-color: #475569; }
  button.danger, .btn.danger, .danger { background: var(--err-bg); color: var(--err-fg); border: 1px solid var(--err-bd); box-shadow: none; }
  button.danger:hover, .btn.danger:hover, .danger:hover { background: rgba(244, 63, 94, 0.28); }

  /* Badges & Status Banners */
  .ok { background: var(--ok-bg); color: var(--ok-fg); border: 1px solid var(--ok-bd); padding: 12px 16px; border-radius: var(--radius-sm); margin-bottom: 20px; font-weight: 600; }
  .error { background: var(--err-bg); color: var(--err-fg); border: 1px solid var(--err-bd); padding: 12px 16px; border-radius: var(--radius-sm); margin-bottom: 20px; font-weight: 600; }
  .badge, .badge-warn, .badge-success { display: inline-flex; align-items: center; gap: 5px; padding: 4px 11px; border-radius: 20px; font-size: 12px; font-weight: 700; white-space: nowrap; }
  .badge { background: rgba(255, 255, 255, 0.08); color: var(--text-muted); }
  .badge.on { background: var(--ok-bg); color: var(--ok-fg); }
  .badge.off, .badge-warn { background: var(--warn-bg); color: var(--warn-fg); }
  .badge-success { background: var(--ok-bg); color: var(--ok-fg); }

  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 13px; border-radius: 20px; font-size: 12.5px; font-weight: 600; background: rgba(255, 255, 255, 0.08); color: #cbd5e1; }
  .chip.warn { background: var(--warn-bg); color: var(--warn-fg); }

  .tag { display: inline-flex; align-items: center; padding: 3px 11px; border-radius: 20px; font-size: 11.5px; font-weight: 700; background: rgba(139, 92, 246, 0.18); color: #c4b5fd; }

  /* Sarlavha qatori (bo'lim nomi + o'ng tomonda tag/amal) */
  .sec-title { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
  .sec-title h2 { margin: 0; }

  /* Xush kelibsiz/banner karta */
  .welcome { background: var(--grad-glow); border: 1px solid var(--border); border-radius: var(--radius); padding: 22px 26px; margin-bottom: 20px; }
  .welcome h1 { margin: 0 0 6px; }

  /* KPI statistika kartalari */
  .kpi { display: flex; align-items: center; gap: 14px; }
  .kpi .ic { width: 44px; height: 44px; border-radius: 12px; background: rgba(139, 92, 246, 0.15); display: grid; place-items: center; font-size: 20px; flex: none; }
  .kpi .num { font-size: 24px; font-weight: 800; color: #fff; line-height: 1.2; }
  .kpi .lbl { font-size: 12.5px; color: var(--text-muted); }
  .info { background: var(--warn-bg); color: var(--warn-fg); border: 1px solid var(--warn-bd); padding: 12px 16px; border-radius: var(--radius-sm); margin-bottom: 20px; font-weight: 600; }

  /* Responsive Layout */
  @media (max-width: 960px) {
    .shell { flex-direction: column; }
    .sidebar { width: 100%; height: auto; position: relative; border-right: 0; border-bottom: 1px solid var(--border); padding: 14px 0 10px; }
    .sidebar .brand { padding-left: 20px; padding-right: 20px; }
    /* Mobil/planshetda vertikal ro'yxat o'rniga gorizontal aylanadigan "tab bar" —
       flex-wrap uneven grid hosil qilib, tartibsiz ko'rinar edi. */
    .side-nav {
      flex-direction: row;
      flex-wrap: nowrap;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: thin;
      padding: 0 20px 6px;
      gap: 8px;
    }
    .side-nav a { flex: none; padding: 9px 14px; font-size: 13px; white-space: nowrap; background: rgba(255,255,255,0.04); }
    .side-sec { display: none; }
    .side-foot { display: none; }
    main.app { padding: 0 16px; margin: 16px auto; }
    .grid.cols-3, .grid.cols-4 { grid-template-columns: repeat(2, 1fr); }
    .grid.split-form { grid-template-columns: 1fr; }
    .topbar { padding: 14px 16px; }
  }

  @media (max-width: 640px) {
    .grid.cols-2, .grid.cols-3, .grid.cols-4 { grid-template-columns: 1fr; }
    .card { padding: 18px; }
    .topbar { flex-wrap: wrap; gap: 10px; }
    .topbar h1 { font-size: 18px; }
    h1 { font-size: 22px; }
    table.tbl { font-size: 12.5px; }
    table.tbl th, table.tbl td { padding: 10px; }
  }

  /* Harakatga sezgir foydalanuvchilar (vestibular buzilish va h.k.) uchun —
     tizim darajasida "Reduce Motion" yoqilgan bo'lsa animatsiyalar o'chadi. */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; scroll-behavior: auto !important; }
    a.card-link:hover { transform: none; }
  }
</style>
</head>
<body>
${
  user
    ? `<div class="shell">
        <aside class="sidebar">
          <a class="brand" href="/dashboard">${logoMark(32)}<span>Obunext</span></a>
          <nav class="side-nav">
            ${navSections(active, admin)}
          </nav>
          <div class="side-foot">
            <div class="side-user">
              <div class="av">${esc((user.businessName || user.email || "?").trim().charAt(0).toUpperCase())}</div>
              <div style="min-width:0">
                <div class="nm">${esc(user.businessName || "Biznesim")}</div>
                <div class="em">${esc(actor ? `${actor.user.email} · ${ROLE_LABELS[actor.role] || actor.role}` : user.email)}</div>
              </div>
            </div>
            <a class="side-logout" href="/workspace" style="margin-bottom:6px; background:rgba(255,255,255,0.04); color:#cbd5e1"><span>⇄</span> Ish maydoni</a>
            <a class="side-logout" href="/logout"><span>↩</span> Chiqish</a>
          </div>
        </aside>
        <div class="content">
          <div class="topbar">
            <h1>${esc(title)}</h1>
            <div class="topbar-right">
              <div class="status-tag"><span class="dot"></span> Tizim Faol</div>
              <a class="btn secondary" style="padding:6px 14px; font-size:13px; margin:0; gap:6px" href="/" target="_blank">${icon("globe", { size: 15 })} Sayt</a>
            </div>
          </div>
          <main class="app">${body}</main>
        </div>
      </div>`
    : `<header class="pub">
        <a class="brand" href="/">${logoMark(32)}<span>Obunext</span></a>
        <nav><a href="/login">Kirish</a> &nbsp; <a href="/register" class="btn" style="margin:0; padding:8px 18px">Ro'yxatdan o'tish</a></nav>
      </header>
      <main class="pub">${body}</main>`
}
</body>
</html>`;
}

/**
 * Yon menyu bo'limlari. Jamoa a'zosining roli (operator/kuzatuvchi) cheklangan
 * bo'lsa, ruxsat berilmagan sahifalar menyuda ko'rsatilmaydi.
 */
const ROLE_LABELS = { admin: "Administrator", operator: "Operator", viewer: "Kuzatuvchi" };

const NAV = [
  ["Asosiy", [
    ["/dashboard", "dashboard", "grid", "Dashboard"],
    ["/inbox", "inbox", "chat", "Live Inbox"],
    ["/clients", "contacts", "users", "Kontaktlar CRM"],
    ["/analytics", "analytics", "chart", "Analitika"],
  ]],
  ["Avtomatlashtirish", [
    ["/flows", "flows", "flow", "Flow Builder"],
    ["/triggers", "triggers", "bolt", "Tezkor qoidalar"],
    ["/forms", "forms", "form", "Lid formalari"],
    ["/media", "media", "camera", "Media kutubxona"],
    ["/templates", "templates", "layout", "Shablonlar Hubi"],
  ]],
  ["O'sish", [
    ["/game", "game", "trophy", "Geymifikatsiya"],
    ["/broadcasts", "broadcasts", "megaphone", "Ommaviy xabarlar"],
    ["/content", "content", "film", "AI Kontent studiya"],
    ["/growth", "growth", "trending", "O'sish vositalari"],
    ["/scheduler", "scheduler", "calendar", "Scheduler"],
  ]],
  ["Sozlamalar", [
    ["/ai-settings", "ai-settings", "spark", "AI javob sozlamalari"],
    ["/integrations", "integrations", "plug", "Integratsiyalar"],
    ["/team", "team", "team", "Jamoa"],
    ["/billing", "billing", "card", "Obuna & Tariflar"],
    ["/account", "account", "spark", "AI Studio & Akkaunt"],
    ["/settings", "settings", "gear", "Sozlamalar & Yordam"],
  ]],
];

function navSections(active, admin) {
  const ctx = currentActor();
  const allowed = (href) => !ctx || canAccess(ctx.role, "GET", href);
  const html = NAV.map(([title, items]) => {
    const links = items.filter(([href]) => allowed(href)).map(([href, key, ic, label]) => sideLink(href, key, ic, label, active)).join("");
    return links ? `<div class="side-sec">${title}</div>${links}` : "";
  }).join("");
  return html + (admin ? `<div class="side-sec">Platforma</div>${sideLink("/admin", "admin", "key", "Admin Panel", active)}` : "");
}

function sideLink(href, key, iconName, label, active) {
  return `<a href="${href}" class="${active === key ? "active" : ""}"><span class="i">${icon(iconName, { size: 18 })}</span> ${label}</a>`;
}

/** HTML belgilarini xavfsiz qiladi (XSS oldini olish) */
export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

