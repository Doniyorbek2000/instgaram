/**
 * Bosh sahifaning yangi bo'limlari: hero sahnasi, integratsiyalar qatori,
 * mahsulot ko'rgazmasi (Flow Builder / Inbox / Analitika maketlari),
 * imkoniyatlar (bento), kanallar va soha bo'yicha ssenariylar.
 * /features sahifasi ham shu bo'laklardan foydalanadi.
 */
import { esc } from "./layout.js";
import { icon, brandIcon } from "./icons.js";
import { home } from "./i18n_home.js";

export const HOME_CSS = `
  /* ===== Hero sahnasi ===== */
  .hx-hero h1 { font-size: clamp(34px, 5vw, 56px); font-weight: 800; letter-spacing: -.035em; }
  .hx-trust { margin-top: 26px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; color: var(--muted); font-size: 14px; }
  .hx-avatars { display: flex; }
  .hx-avatars span { width: 34px; height: 34px; border-radius: 50%; border: 2px solid #fff; margin-left: -9px; display: grid; place-items: center;
    font-size: 12.5px; font-weight: 700; color: #fff; box-shadow: 0 4px 10px -4px rgba(30,10,60,.35); }
  .hx-avatars span:first-child { margin-left: 0; }
  .hx-trust b { color: var(--ink); }
  .hx-chan { display: flex; align-items: center; gap: 10px; margin-top: 18px; color: var(--muted); font-size: 13px; font-weight: 600; }
  .hx-chan .ics { display: flex; gap: 6px; }
  .hx-stage { position: relative; display: flex; flex-direction: column; align-items: center; gap: 16px; }
  .hx-stage::before { content: ""; position: absolute; width: 440px; height: 440px; max-width: 110%; top: 70px; left: 50%; transform: translateX(-50%);
    background: radial-gradient(closest-side, rgba(124,58,237,.28), rgba(219,39,119,.14) 55%, transparent 75%); filter: blur(10px); z-index: -1; }
  .hx-float { position: absolute; z-index: 3; display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,.92); backdrop-filter: blur(10px);
    border: 1px solid rgba(124,58,237,.12); border-radius: 14px; padding: 10px 14px; box-shadow: 0 18px 40px -16px rgba(30,10,60,.35);
    font-size: 12.5px; line-height: 1.3; opacity: 0; animation: hxIn .6s forwards, hxBob 6s ease-in-out infinite; }
  .hx-float b { display: block; font-size: 13.5px; color: var(--ink); }
  .hx-float span { color: var(--muted); }
  .hx-float .fi { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; flex: none; color: #fff; }
  .hx-float.f1 { top: 340px; left: -30px; animation-delay: .5s, 1.1s; }
  .hx-float.f2 { top: 96px; right: -26px; animation-delay: 1s, 1.6s; }
  .hx-float.f3 { bottom: 22px; right: -34px; animation-delay: 1.6s, 2.2s; }
  .hx-float.f2 .big { font-size: 20px; font-weight: 800; color: var(--brand); letter-spacing: -.02em; }
  @keyframes hxIn { from { opacity: 0; transform: translateY(10px) scale(.97); } to { opacity: 1; transform: none; } }
  @keyframes hxBob { 0%,100% { translate: 0 0; } 50% { translate: 0 -6px; } }
  .qr { display: flex; flex-wrap: wrap; gap: 6px; align-self: flex-end; justify-content: flex-end; max-width: 90%; opacity: 0; animation: pop .5s 1.35s forwards; }
  .qr span { font-size: 12px; font-weight: 600; color: var(--brand); background: #fff; border: 1px solid #e6dcfb; padding: 5px 11px; border-radius: 999px; }

  /* ===== Integratsiyalar qatori ===== */
  .hx-plat { padding: 30px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); background: var(--bg-2); }
  .hx-plat p { text-align: center; color: var(--muted); font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; margin: 0 0 16px; }
  .hx-plat .row { display: flex; justify-content: center; flex-wrap: wrap; gap: 10px; }
  .hx-pill { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 12px; background: #fff; border: 1px solid var(--line);
    font-weight: 650; font-size: 14px; color: var(--ink-2); }
  .hx-pill .gi { color: var(--brand); display: grid; }

  /* ===== Mahsulot ko'rgazmasi ===== */
  .hx-rows { display: flex; flex-direction: column; gap: 88px; }
  .hx-row { display: grid; grid-template-columns: .9fr 1.1fr; gap: 56px; align-items: center; }
  .hx-row.rev { grid-template-columns: 1.1fr .9fr; }
  .hx-row.rev .hx-copy { order: 2; }
  .hx-copy .kick { font-size: 13px; font-weight: 700; color: var(--brand); letter-spacing: .05em; text-transform: uppercase; }
  .hx-copy h3 { font-size: clamp(24px, 3vw, 32px); margin: 10px 0 14px; }
  .hx-copy p { color: var(--muted); font-size: 16.5px; margin: 0 0 18px; }
  .hx-copy ul { list-style: none; padding: 0; margin: 0 0 22px; display: grid; gap: 10px; }
  .hx-copy li { display: flex; gap: 10px; align-items: flex-start; font-size: 15px; color: var(--ink-2); }
  .hx-copy li::before { content: ""; flex: none; width: 20px; height: 20px; margin-top: 2px; border-radius: 6px; background: #f3effe
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237c3aed' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12l5 5L20 7'/%3E%3C/svg%3E") center/12px no-repeat; }
  .hx-link { font-weight: 700; color: var(--brand); display: inline-flex; gap: 6px; align-items: center; }
  .hx-link:hover { gap: 10px; }
  .hx-frame { position: relative; border-radius: 20px; padding: 10px; background: linear-gradient(140deg, rgba(124,58,237,.18), rgba(219,39,119,.12), rgba(249,115,22,.14));
    box-shadow: 0 40px 80px -40px rgba(30,10,60,.45); }
  .hx-frame .bar { display: flex; gap: 6px; padding: 4px 6px 10px; }
  .hx-frame .bar i { width: 10px; height: 10px; border-radius: 50%; background: rgba(255,255,255,.7); }

  /* Flow Builder maketi */
  .mk-flow { position: relative; aspect-ratio: 16 / 11; border-radius: 14px; overflow: hidden; background-color: #0b1020;
    background-image: radial-gradient(rgba(148,163,184,.22) 1px, transparent 1px); background-size: 18px 18px; font-size: clamp(8px, 1.05vw, 12px); }
  .mk-flow svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .mk-flow svg path { fill: none; stroke-width: .45; stroke-linecap: round; stroke-dasharray: 2 1.4; animation: mkDash 3s linear infinite; }
  @keyframes mkDash { to { stroke-dashoffset: -10; } }
  .mk-node { position: absolute; width: 30%; background: #151d30; border: 1px solid rgba(255,255,255,.1); border-radius: .9em; color: #cbd5e1;
    box-shadow: 0 12px 26px -12px rgba(0,0,0,.8); }
  .mk-node header { padding: .55em .8em; border-bottom: 1px solid rgba(255,255,255,.06); font-weight: 800; display: flex; align-items: center; gap: .4em; }
  .mk-node .b { padding: .55em .8em .7em; line-height: 1.35; }
  .mk-node .btn2 { margin: 0 .8em .7em; padding: .35em .6em; border-radius: .5em; background: rgba(56,189,248,.14); color: #7dd3fc; font-weight: 700; text-align: center; }
  .mk-node .yn { display: flex; gap: .4em; padding: 0 .8em .7em; }
  .mk-node .yn span { flex: 1; text-align: center; padding: .3em; border-radius: .5em; font-weight: 700; }
  .mk-node.sel { border-color: #a78bfa; box-shadow: 0 0 0 .25em rgba(139,92,246,.3), 0 12px 26px -12px rgba(0,0,0,.8); }
  .mk-node .start { position: absolute; top: -.95em; right: .8em; background: #10b981; color: #04130d; font-weight: 800; font-size: .85em; padding: .1em .6em; border-radius: 99px; }
  .mk-t1 header { color: #fbbf24 } .mk-t2 header { color: #c4b5fd } .mk-t3 header { color: #34d399 } .mk-t4 header { color: #fbbf24 } .mk-t5 header { color: #f472b6 }

  /* Inbox maketi */
  .mk-inbox { display: grid; grid-template-columns: 1.25fr 1fr; background: #fff; border-radius: 14px; overflow: hidden; font-size: 13px; min-height: 330px; }
  .mk-list { border-right: 1px solid var(--line); }
  .mk-list .top { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--line); font-weight: 800; }
  .mk-list .tabs { display: flex; gap: 4px; }
  .mk-list .tabs span { font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 99px; background: var(--bg-2); color: var(--muted); }
  .mk-list .tabs span.on { background: #f3effe; color: var(--brand); }
  .mk-chat { display: flex; gap: 10px; align-items: center; padding: 11px 14px; border-bottom: 1px solid #f4f4f8; }
  .mk-chat.on { background: #faf7ff; box-shadow: inset 3px 0 0 var(--brand); }
  .mk-av { position: relative; width: 36px; height: 36px; border-radius: 50%; flex: none; display: grid; place-items: center; color: #fff; font-weight: 700; font-size: 13px; }
  .mk-av .ch { position: absolute; right: -3px; bottom: -3px; background: #fff; border-radius: 50%; padding: 1px; display: grid; }
  .mk-chat .mid { min-width: 0; flex: 1; }
  .mk-chat .mid b { display: block; font-size: 13px; color: var(--ink); }
  .mk-chat .mid span { display: block; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mk-chat .rt { text-align: right; font-size: 11px; color: var(--muted); display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
  .mk-tag { font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 99px; background: #f3effe; color: var(--brand); }
  .mk-card { padding: 16px; display: flex; flex-direction: column; gap: 12px; background: var(--bg-2); }
  .mk-card .hd { display: flex; align-items: center; gap: 10px; }
  .mk-card .hd b { font-size: 15px; }
  .mk-card .kv { background: #fff; border: 1px solid var(--line); border-radius: 11px; padding: 9px 11px; }
  .mk-card .kv small { display: block; font-size: 11px; color: var(--muted); }
  .mk-card .kv div { font-weight: 650; font-size: 13px; }
  .mk-card .ok { color: #059669; }
  .mk-toggle { display: flex; align-items: center; justify-content: space-between; }
  .mk-toggle i { width: 34px; height: 20px; border-radius: 99px; background: #10b981; position: relative; }
  .mk-toggle i::after { content: ""; position: absolute; right: 3px; top: 3px; width: 14px; height: 14px; border-radius: 50%; background: #fff; }

  /* Analitika maketi */
  .mk-stats { background: #fff; border-radius: 14px; padding: 16px; font-size: 13px; }
  .mk-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .mk-kpis div { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; }
  .mk-kpis small { display: block; color: var(--muted); font-size: 11.5px; }
  .mk-kpis b { font-size: clamp(16px, 2vw, 21px); letter-spacing: -.02em; }
  .mk-chart { margin-top: 14px; border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px 8px; }
  .mk-chart .ttl { font-weight: 700; font-size: 12.5px; color: var(--ink-2); margin-bottom: 10px; }
  .mk-bars { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; align-items: end; height: 130px; border-bottom: 1px solid var(--line); }
  .mk-bars div { position: relative; background: linear-gradient(180deg, #8b5cf6, #7c3aed); border-radius: 4px 4px 0 0; transform-origin: bottom; animation: mkGrow .9s cubic-bezier(.2,.8,.2,1) both; }
  .mk-bars div.hi { background: linear-gradient(180deg, #ec4899, #db2777); }
  .mk-bars div span { position: absolute; top: -17px; left: 50%; transform: translateX(-50%); font-size: 10.5px; font-weight: 700; color: var(--ink-2); }
  .mk-days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; text-align: center; font-size: 10.5px; color: var(--muted); padding-top: 5px; }
  @keyframes mkGrow { from { transform: scaleY(0); } }
  .mk-toast { margin-top: 12px; display: flex; align-items: center; gap: 10px; border-radius: 12px; padding: 10px 12px; background: #0f1222; color: #e2e8f0; }
  .mk-toast .fi { width: 32px; height: 32px; border-radius: 9px; background: var(--grad); display: grid; place-items: center; color: #fff; flex: none; }
  .mk-toast small { display: block; color: #94a3b8; font-size: 11.5px; }
  .mk-toast .ok { margin-left: auto; color: #34d399; font-weight: 700; font-size: 12px; white-space: nowrap; }

  /* ===== Bento imkoniyatlar ===== */
  .hx-bento { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  .hx-b { background: #fff; border: 1px solid var(--line); border-radius: 18px; padding: 22px; transition: transform .18s, box-shadow .18s, border-color .18s; position: relative; overflow: hidden; }
  .hx-b:hover { transform: translateY(-3px); box-shadow: var(--shadow); border-color: #e5ddfa; }
  .hx-b.w2 { grid-column: span 2; }
  .hx-b.dark { background: radial-gradient(420px 200px at 100% 0%, rgba(219,39,119,.35), transparent 60%), radial-gradient(420px 220px at 0% 100%, rgba(124,58,237,.45), transparent 60%), #120f1f; border-color: #231d38; color: #fff; }
  .hx-b.dark p { color: #c9c6d8; }
  .hx-b.dark .ico { background: rgba(255,255,255,.1); color: #fff; }
  .hx-b .ico { width: 44px; height: 44px; border-radius: 12px; background: #f3effe; color: var(--brand); display: grid; place-items: center; margin-bottom: 14px; }
  .hx-b h3 { font-size: 16.5px; margin-bottom: 6px; }
  .hx-b p { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.55; }

  /* ===== Kanallar ===== */
  .hx-ch { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  .hx-chc { background: #fff; border: 1px solid var(--line); border-radius: 18px; padding: 22px; position: relative; overflow: hidden; transition: transform .18s, box-shadow .18s; }
  .hx-chc:hover { transform: translateY(-3px); box-shadow: var(--shadow); }
  .hx-chc::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 3px; }
  .hx-chc.ig::before { background: linear-gradient(90deg, #f58529, #dd2a7b, #8134af); }
  .hx-chc.tg::before { background: #229ed9; } .hx-chc.wa::before { background: #25d366; } .hx-chc.fb::before { background: #0084ff; }
  .hx-chc h3 { font-size: 18px; margin: 14px 0 4px; }
  .hx-chc p { color: var(--muted); font-size: 14px; margin: 0 0 12px; }
  .hx-chc ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 7px; font-size: 13.5px; color: var(--ink-2); }
  .hx-chc li { display: flex; gap: 8px; } .hx-chc li::before { content: "✓"; color: var(--brand); font-weight: 800; }

  /* ===== Soha ssenariylari ===== */
  .hx-cases { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  .hx-case { background: #fff; border: 1px solid var(--line); border-radius: 18px; padding: 22px; display: flex; flex-direction: column; }
  .hx-case .em { font-size: 30px; line-height: 1; }
  .hx-case h3 { font-size: 17px; margin: 14px 0 6px; }
  .hx-case p { color: var(--muted); font-size: 14px; margin: 0 0 16px; flex: 1; }
  .hx-steps { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 700; }
  .hx-steps span { background: var(--bg-2); border: 1px solid var(--line); color: var(--ink-2); padding: 3px 8px; border-radius: 8px; }
  .hx-steps i { color: #c4b5fd; font-style: normal; }
  .hx-steps span:last-child { background: #f3effe; border-color: #e6dcfb; color: var(--brand); }

  /* Qadamlar orasidagi chiziq, sharhlar */
  .steps { position: relative; }
  .steps::before { content: ""; position: absolute; top: 26px; left: 16.6%; right: 16.6%; height: 2px; background: repeating-linear-gradient(90deg, #d8ccfa 0 8px, transparent 8px 14px); z-index: 0; }
  .step .n { position: relative; z-index: 1; }
  .quote .st { color: #f59e0b; letter-spacing: 2px; font-size: 13px; margin-bottom: 10px; }
  .quote .av { display: grid; place-items: center; color: #fff; font-weight: 700; }

  @media (max-width: 1024px) {
    .hx-bento { grid-template-columns: repeat(2, 1fr); }
    .hx-ch, .hx-cases { grid-template-columns: repeat(2, 1fr); }
    .hx-float.f1 { left: 0; } .hx-float.f2 { right: 0; } .hx-float.f3 { right: 0; }
  }
  @media (max-width: 900px) {
    .hx-row, .hx-row.rev { grid-template-columns: 1fr; gap: 28px; }
    .hx-row.rev .hx-copy { order: 0; }
    .hx-rows { gap: 64px; }
    .hx-chan, .hx-trust { justify-content: center; }
    .steps::before { display: none; }
  }
  @media (max-width: 640px) {
    .hx-bento, .hx-ch, .hx-cases { grid-template-columns: 1fr; }
    .hx-b.w2 { grid-column: auto; }
    .hx-bento { gap: 10px; }
    .hx-b { display: grid; grid-template-columns: 42px 1fr; column-gap: 14px; padding: 16px; border-radius: 14px; }
    .hx-b .ico { grid-row: span 2; width: 42px; height: 42px; margin: 0; }
    .hx-b h3 { font-size: 15.5px; margin-bottom: 3px; }
    .hx-b p { font-size: 13.5px; }
    .hx-chc, .hx-case { padding: 18px; }
    .mk-inbox { grid-template-columns: 1fr; }
    .mk-card { display: none; }
    .hx-float { font-size: 11.5px; padding: 8px 11px; }
    .hx-float .fi { width: 28px; height: 28px; }
    .hx-float.f1 { top: auto; bottom: 150px; left: -4px; } .hx-float.f2 { top: 70px; right: -4px; } .hx-float.f3 { display: none; }
  }
`;

const AVATAR_BG = ["#7c3aed", "#db2777", "#f97316", "#0ea5e9", "#10b981"];
const initials = (name) => String(name).trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

/** Hero o'ng tomoni: kanal tanlagich, telefon va suzuvchi kartochkalar. */
export function heroStage(lang) {
  const H = home(lang);
  const f = H.float;
  const ig = H.sim.ig;
  const tabs = [["ig", "instagram", "Instagram"], ["tg", "telegram", "Telegram"], ["wa", "whatsapp", "WhatsApp"], ["fb", "facebook", "Messenger"]];
  return `<div class="hx-stage">
    <div class="ch-tabs" role="tablist">
      ${tabs.map(([k, b, l], i) => `<button type="button" role="tab" aria-selected="${i === 0}" data-ch="${k}" class="ch-tab${i === 0 ? " active" : ""}" style="gap:6px">${brandIcon(b, { size: 16 })} ${l}</button>`).join("")}
    </div>
    <div class="phone"><div class="phone-screen">
      <div class="ig-top">
        <div class="ig-av"></div>
        <div><div class="ig-name" id="chHandle">${esc(ig.handle)}</div><div class="ig-sub" id="chSub">${esc(ig.sub)}</div></div>
        <div class="ig-cam">💬</div>
      </div>
      <div class="chat" id="chChat">
        <div class="msg in m1" id="cm1">${esc(ig.c1)}</div>
        <div class="msg out m2" id="cm2">${esc(ig.b1)}</div>
        <div class="qr" id="cq">${ig.q.map((x) => `<span>${esc(x)}</span>`).join("")}</div>
        <div class="msg in m3" id="cm3">${esc(ig.c2)}</div>
        <div class="typing"><i></i><i></i><i></i></div>
        <div class="msg out m4" id="cm4">${esc(ig.b2)}</div>
      </div>
      <div class="ig-bar"><div class="ig-input"></div><span>➤</span></div>
    </div></div>
    <div class="hx-float f1" aria-hidden="true"><span class="fi" style="background:linear-gradient(135deg,#f58529,#dd2a7b,#8134af)">${icon("bolt", { size: 18 })}</span><div><b>${esc(f.comment)}</b><span>${esc(f.commentSub)}</span></div></div>
    <div class="hx-float f2" aria-hidden="true"><div><div class="big">${esc(f.speed)}</div><span>${esc(f.speedSub)}</span></div></div>
    <div class="hx-float f3" aria-hidden="true"><span class="fi" style="background:#10b981">${icon("user", { size: 18 })}</span><div><b>✓ ${esc(f.lead)}</b><span>${esc(f.leadSub)}</span></div></div>
    <script type="application/json" id="chData">${JSON.stringify(H.sim).replace(/</g, "\\u003c")}</script>
    <script>
      (function () {
        var data = JSON.parse(document.getElementById("chData").textContent);
        var set = function (id, v) { document.getElementById(id).textContent = v; };
        document.querySelectorAll(".ch-tab[data-ch]").forEach(function (b) {
          b.addEventListener("click", function () {
            document.querySelectorAll(".ch-tab[data-ch]").forEach(function (x) { x.classList.remove("active"); x.setAttribute("aria-selected", "false"); });
            b.classList.add("active"); b.setAttribute("aria-selected", "true");
            var d = data[b.getAttribute("data-ch")];
            set("chHandle", d.handle); set("chSub", d.sub); set("cm1", d.c1); set("cm2", d.b1); set("cm3", d.c2); set("cm4", d.b2);
            var q = document.getElementById("cq"); q.innerHTML = "";
            d.q.forEach(function (x) { var s = document.createElement("span"); s.textContent = x; q.appendChild(s); });
            // Suhbat animatsiyasini qaytadan ko'rsatish
            var chat = document.getElementById("chChat");
            var clone = chat.cloneNode(true); chat.parentNode.replaceChild(clone, chat);
          });
        });
      })();
    </script>
  </div>`;
}

/** Hero chap tomonidagi ishonch qatori. */
export function heroTrust(lang, trustText, rating = "") {
  const H = home(lang);
  // Reyting faqat admin haqiqiy qiymat kiritganda ko'rsatiladi
  return `${trustText ? `<div class="hx-trust">
      <div>${rating ? `<span class="stars">★★★★★</span> <b>${esc(rating)}</b> · ` : "✓ "}${esc(trustText)}</div>
    </div>` : ""}
    <div class="hx-chan"><span class="ics">${["instagram", "telegram", "whatsapp", "facebook"].map((b) => brandIcon(b, { size: 18 })).join("")}</span>${esc(H.heroChannels)}</div>`;
}

export function platformsStrip(lang) {
  const P = home(lang).platforms;
  const extraIcons = ["chart", "plug", "card", "key"];
  return `<div class="hx-plat"><div class="wrap">
    <p>${esc(P.title)}</p>
    <div class="row">
      ${[["instagram", "Instagram"], ["telegram", "Telegram"], ["whatsapp", "WhatsApp"], ["facebook", "Messenger"]].map(([b, l]) => `<span class="hx-pill">${brandIcon(b, { size: 18 })} ${l}</span>`).join("")}
      ${P.extra.map((l, i) => `<span class="hx-pill"><span class="gi">${icon(extraIcons[i], { size: 17 })}</span> ${esc(l)}</span>`).join("")}
    </div>
  </div></div>`;
}

function flowMock(m) {
  const f = m.flow;
  // Tugunlar % koordinatalarda; chiziqlar viewBox 0..100 x 0..69 da (16:11)
  return `<div class="mk-flow" aria-hidden="true">
    <svg></svg>
    <div class="mk-node mk-t1" style="left:3%;top:9%"><span class="start">▶ START</span><header>🎯 ${esc(f.trigger)}</header><div class="b">${esc(f.triggerText)}</div></div>
    <div class="mk-node mk-t2 sel" style="left:37%;top:6%"><header>💬 ${esc(f.message)}</header><div class="b">${esc(f.messageText)}</div><div class="btn2">🔘 ${esc(f.button)}</div></div>
    <div class="mk-node mk-t3" style="left:67%;top:40%"><header>🔀 ${esc(f.condition)}</header><div class="b">${esc(f.conditionText)}</div><div class="yn"><span style="background:rgba(52,211,153,.14);color:#34d399">✅ ${esc(f.yes)}</span><span style="background:rgba(248,113,113,.14);color:#f87171">❌ ${esc(f.no)}</span></div></div>
    <div class="mk-node mk-t4" style="left:37%;top:58%"><header>📝 ${esc(f.input)}</header><div class="b">${esc(f.inputText)}</div></div>
    <div class="mk-node mk-t5" style="left:3%;top:62%"><header>⚡ ${esc(f.action)}</header><div class="b">${esc(f.actionText)}</div></div>
  </div>`;
}

/** Tugunlar orasidagi chiziqlar — maket o'lchamidan qat'i nazar to'g'ri turishi uchun JS bilan chiziladi. */
const FLOW_EDGES_JS = `
<script>
(function () {
  document.querySelectorAll(".mk-flow").forEach(function (box) {
    var svg = box.querySelector("svg");
    var nodes = box.querySelectorAll(".mk-node");
    function draw() {
      var r = box.getBoundingClientRect();
      if (!r.width) return;
      svg.setAttribute("viewBox", "0 0 " + r.width + " " + r.height);
      svg.setAttribute("preserveAspectRatio", "none");
      var pt = function (el, side, dy) {
        var q = el.getBoundingClientRect();
        return { x: (side === "r" ? q.right : q.left) - r.left, y: q.top - r.top + (dy === undefined ? q.height / 2 : dy) };
      };
      var c = function (a, b, color) {
        var dx = Math.max(30, Math.abs(b.x - a.x) / 2);
        return '<path stroke="' + color + '" stroke-width="2" d="M' + a.x + "," + a.y + " C" + (a.x + dx) + "," + a.y + " " + (b.x - dx) + "," + b.y + " " + b.x + "," + b.y + '"/>';
      };
      var n = nodes;
      var btn = n[1].querySelector(".btn2").getBoundingClientRect();
      var yes = n[2].querySelector(".yn span").getBoundingClientRect();
      svg.innerHTML =
        c(pt(n[0], "r"), pt(n[1], "l", 22), "#a78bfa") +
        c({ x: btn.right - r.left, y: btn.top - r.top + btn.height / 2 }, pt(n[2], "l", 22), "#38bdf8") +
        c({ x: yes.left - r.left + yes.width / 2, y: yes.bottom - r.top }, pt(n[3], "r", 22), "#34d399") +
        c(pt(n[3], "l", 22), pt(n[4], "r", 22), "#a78bfa");
      svg.querySelectorAll("path").forEach(function (p) { p.style.strokeWidth = "2"; p.style.strokeDasharray = "6 5"; });
    }
    draw();
    addEventListener("resize", draw);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
  });
})();
</script>`;

function inboxMock(m) {
  const i = m.inbox;
  const chats = i.chats
    .map((c, k) => `<div class="mk-chat${k === 0 ? " on" : ""}">
      <div class="mk-av" style="background:${AVATAR_BG[k]}">${esc(initials(c.n))}<span class="ch">${brandIcon(c.ch, { size: 13 })}</span></div>
      <div class="mid"><b>${esc(c.n)}</b><span>${esc(c.m)}</span></div>
      <div class="rt">${esc(c.t)}<span class="mk-tag">${esc(c.tag)}</span></div>
    </div>`)
    .join("");
  const first = i.chats[0];
  return `<div class="mk-inbox" aria-hidden="true">
    <div class="mk-list">
      <div class="top">${esc(i.title)}<div class="tabs"><span class="on">${esc(i.all)}</span><span>${esc(i.ai)}</span><span>${esc(i.operator)}</span></div></div>
      ${chats}
    </div>
    <div class="mk-card">
      <div class="hd"><div class="mk-av" style="background:${AVATAR_BG[0]}">${esc(initials(first.n))}</div><div><b>${esc(first.n)}</b><div style="font-size:11.5px;color:var(--muted)">${esc(i.card)}</div></div></div>
      <div class="kv"><small>${esc(i.phone)}</small><div>+998 90 ••• 45 67</div></div>
      <div class="kv"><small>${esc(i.window)}</small><div class="ok">● ${esc(i.windowLeft)}</div></div>
      <div class="kv"><small>${esc(i.tags)}</small><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:3px"><span class="mk-tag">${esc(first.tag)}</span><span class="mk-tag">instagram</span></div></div>
      <div class="kv mk-toggle"><div>${esc(i.aiOn)}</div><i></i></div>
    </div>
  </div>`;
}

function statsMock(m) {
  const s = m.stats;
  const values = [124, 168, 142, 205, 238, 191, 216];
  const max = Math.max(...values);
  return `<div class="mk-stats" aria-hidden="true">
    <div class="mk-kpis">${s.kpi.map((k) => `<div><small>${esc(k.l)}</small><b>${esc(k.v)}</b></div>`).join("")}</div>
    <div class="mk-chart">
      <div class="ttl">${esc(s.chart)}</div>
      <div class="mk-bars">${values.map((v, i) => `<div class="${v === max ? "hi" : ""}" style="height:${Math.round((v / max) * 88)}%;animation-delay:${i * 70}ms"><span>${v}</span></div>`).join("")}</div>
      <div class="mk-days">${s.days.map((d) => `<span>${esc(d)}</span>`).join("")}</div>
    </div>
    <div class="mk-toast"><span class="fi">${icon("megaphone", { size: 17 })}</span><div><b>${esc(s.broadcast)}</b><small>${esc(s.broadcastText)}</small></div><span class="ok">✓ ${esc(s.sent)}</span></div>
  </div>`;
}

export function showcaseSection(lang, { id = "showcase" } = {}) {
  const H = home(lang);
  const sc = H.showcase;
  const mocks = [flowMock(H.mock), inboxMock(H.mock), statsMock(H.mock)];
  const links = ["/features#flow", "/features#inbox", "/features#analytics"];
  return `<section id="${id}"><div class="wrap">
    <div class="sec-head"><span class="eyebrow">${esc(sc.badge)}</span><h2>${esc(sc.title)}</h2><p>${esc(sc.sub)}</p></div>
    <div class="hx-rows">
      ${sc.rows
        .map((r, i) => `<div class="hx-row${i % 2 ? " rev" : ""}" id="${["flow", "inbox", "analytics"][i]}">
          <div class="hx-copy">
            <span class="kick">${esc(r.eyebrow)}</span>
            <h3>${esc(r.title)}</h3>
            <p>${esc(r.text)}</p>
            <ul>${r.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
            ${id === "showcase" ? `<a class="hx-link" href="${links[i]}">${esc(sc.more)} →</a>` : ""}
          </div>
          <div class="hx-frame"><div class="bar"><i></i><i></i><i></i></div>${mocks[i]}</div>
        </div>`)
        .join("")}
    </div>
  </div></section>${FLOW_EDGES_JS}`;
}

export function bentoSection(lang, { bg = true } = {}) {
  const B = home(lang).bento;
  const wide = new Set([0, 4, 10, 11]);
  const dark = new Set([0, 10]);
  return `<section id="features" ${bg ? `style="background:var(--bg-2);border-top:1px solid var(--line);border-bottom:1px solid var(--line)"` : ""}><div class="wrap">
    <div class="sec-head"><span class="eyebrow">${esc(B.badge)}</span><h2>${esc(B.title)}</h2><p>${esc(B.sub)}</p></div>
    <div class="hx-bento">
      ${B.items.map((it, i) => `<div class="hx-b${wide.has(i) ? " w2" : ""}${dark.has(i) ? " dark" : ""}"><div class="ico">${icon(it.icon, { size: 22 })}</div><h3>${esc(it.title)}</h3><p>${esc(it.text)}</p></div>`).join("")}
    </div>
  </div></section>`;
}

export function channelsSection(lang) {
  const C = home(lang).channels;
  return `<section id="channels"><div class="wrap">
    <div class="sec-head"><span class="eyebrow">${esc(C.badge)}</span><h2>${esc(C.title)}</h2><p>${esc(C.sub)}</p></div>
    <div class="hx-ch">
      ${C.items.map((c) => `<div class="hx-chc ${c.cls}">${brandIcon(c.key, { size: 40 })}<h3>${esc(c.title)}</h3><p>${esc(c.text)}</p><ul>${c.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>`).join("")}
    </div>
  </div></section>`;
}

export function casesSection(lang) {
  const C = home(lang).cases;
  return `<section id="cases" style="background:var(--bg-2);border-top:1px solid var(--line);border-bottom:1px solid var(--line)"><div class="wrap">
    <div class="sec-head"><span class="eyebrow">${esc(C.badge)}</span><h2>${esc(C.title)}</h2><p>${esc(C.sub)}</p></div>
    <div class="hx-cases">
      ${C.items.map((c) => `<div class="hx-case"><div class="em">${c.emoji}</div><h3>${esc(c.title)}</h3><p>${esc(c.text)}</p><div class="hx-steps">${c.steps.map((s) => `<span>${esc(s)}</span>`).join("<i>→</i>")}</div></div>`).join("")}
    </div>
  </div></section>`;
}

export function testimonialAvatar(name, i) {
  return `<div class="av" style="background:${AVATAR_BG[i % AVATAR_BG.length]}">${esc(initials(name))}</div>`;
}
