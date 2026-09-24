/**
 * Publik marketing sayti (ko'p sahifali, 3 tilda).
 * Ilova sahifalaridan (dashboard/admin) alohida, premium dizaynli.
 */
import { Router } from "express";
import { esc } from "./layout.js";
import { logoMark } from "./brand.js";
import { icon, brandIcon } from "./icons.js";
import { getPlans } from "../subscription.js";
import { I18N, LANGS, LANG_SHORT, pickLang, t } from "./i18n.js";
import { googleAuthAvailable } from "../googleAuth.js";
import { HOME_CSS, heroStage, heroTrust, platformsStrip, showcaseSection, bentoSection, channelsSection, casesSection, testimonialAvatar } from "./site_home.js";
import { home } from "./i18n_home.js";
import { siteSettings, SITE_DEFAULTS, addContactMessage } from "../siteSettings.js";
import { listUsers } from "../db.js";
import { AI_QUOTA } from "../credits.js";
import { createRateLimiter } from "../rateLimit.js";
import { sendTelegram } from "../notify.js";

/** Hero ostidagi ishonch qatori: admin matni → haqiqiy bizneslar soni → neutral matn. */
async function trustLine(h) {
  const cfg = siteSettings();
  if (cfg.trustText) return cfg.trustText;
  if (cfg.showBusinessCount) {
    const n = (await listUsers()).length;
    if (n >= cfg.minBusinessCount) {
      const rounded = n >= 100 ? Math.floor(n / 50) * 50 : Math.floor(n / 10) * 10;
      return String(h.trustCount || h.trust).replace("{n}", rounded.toLocaleString("ru-RU"));
    }
  }
  return ""; // soxta raqam o'rniga — hech narsa (badge'da allaqachon "3 kun bepul" bor)
}

export const site = Router();

// Til cookie'sini o'rnatadi va req.lang ni aniqlaydi
site.use((req, res, next) => {
  const q = String(req.query.lang || "");
  if (I18N[q]) {
    res.setHeader(
      "Set-Cookie",
      `lang=${q}; Path=/; Max-Age=31536000; SameSite=Lax`
    );
  }
  req.lang = pickLang(req);
  next();
});

// ==================== LAYOUT ====================

function siteLayout(lang, path, title, body, { user, active = "" } = {}) {
  const tr = t(lang);
  const nav = tr.nav;
  const globe = `<svg viewBox="0 0 24 24" fill="none" width="18" height="18" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9S9.5 5.5 12 3z"/></svg>`;
  const langDropdown = `<details class="lang-dd">
    <summary>${globe}<span>${LANG_SHORT[lang]}</span><b class="chev">▾</b></summary>
    <div class="lang-menu">
      ${Object.keys(LANGS)
        .map(
          (code) =>
            `<a href="${path}?lang=${code}" class="${code === lang ? "active" : ""}"><b>${LANG_SHORT[code]}</b> ${LANGS[code]}${code === lang ? " ✓" : ""}</a>`
        )
        .join("")}
    </div>
  </details>`;

  const navLink = (href, key, label) =>
    `<a href="${href}" class="${active === key ? "active" : ""}">${label}</a>`;

  const canonicalUrl = `https://obunext.uz${path === "/" ? "" : path}`;
  const localeMap = { uz: "uz_UZ", ru: "ru_RU", en: "en_US" };
  const metaDescription = esc(tr.hero?.sub || "Obunext — Instagram Direct, Telegram va WhatsApp uchun ko'p kanalli sun'iy intellektli avtomatlashtirish, CRM va vizual savdo voronkasi platformasi.");
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | Obunext — Instagram, Telegram & WhatsApp AI Avtomatlashtirish</title>
<meta name="description" content="${metaDescription}">
<meta name="keywords" content="obunext, obunext.uz, instagram avtomatlashtirish, instagram dm bot, telegram bot biznes uchun, whatsapp business api uzbekistan, chatplace muqobili, manychat uzbekistan, sun'iy intellekt chatbot, visual flow builder, crm tizimi, avto javob instagram, savdo voronkasi, biznesni avtomatlashtirish">
<meta name="author" content="Obunext">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<meta name="theme-color" content="#7c3aed">
<meta name="google-site-verification" content="google954f397ce1b4faab">
<link rel="canonical" href="${canonicalUrl}">
<link rel="alternate" hreflang="uz" href="https://obunext.uz${path}?lang=uz">
<link rel="alternate" hreflang="ru" href="https://obunext.uz${path}?lang=ru">
<link rel="alternate" hreflang="en" href="https://obunext.uz${path}?lang=en">
<link rel="alternate" hreflang="x-default" href="https://obunext.uz${path}">

<!-- Open Graph / Facebook / Telegram -->
<meta property="og:site_name" content="Obunext">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalUrl}">
<meta property="og:title" content="${esc(title)} | Obunext">
<meta property="og:description" content="${metaDescription}">
<meta property="og:image" content="https://obunext.uz/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Obunext AI Platformasi">
<meta property="og:locale" content="${localeMap[lang] || 'uz_UZ'}">

<!-- Twitter Cards -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)} | Obunext">
<meta name="twitter:description" content="${metaDescription}">
<meta name="twitter:image" content="https://obunext.uz/og-image.png">

<!-- Favicon & App Icons -->
<link rel="icon" href="/favicon.png" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap">

<!-- Structured Data JSON-LD (SoftwareApplication & Organization) -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://obunext.uz/#organization",
      "name": "Obunext",
      "url": "https://obunext.uz",
      "logo": {
        "@type": "ImageObject",
        "url": "https://obunext.uz/logo.png"
      },
      "description": "Instagram, Telegram va WhatsApp uchun ko'p kanalli sun'iy intellektli avtomatlashtirish platformasi"
    },
    {
      "@type": "WebSite",
      "@id": "https://obunext.uz/#website",
      "url": "https://obunext.uz",
      "name": "Obunext",
      "publisher": { "@id": "https://obunext.uz/#organization" },
      "inLanguage": "${lang}"
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://obunext.uz/#software",
      "name": "Obunext",
      "url": "https://obunext.uz",
      "applicationCategory": "BusinessApplication",
      "operatingSystem": "All (Web-based SaaS)",
      "description": "${metaDescription}",
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "USD",
        "availability": "https://schema.org/InStock"
      },
      "provider": { "@id": "https://obunext.uz/#organization" }
    }
  ]
}
</script>
<style>
  :root {
    --brand: #7c3aed; --brand-2: #db2777; --brand-3: #f97316;
    --grad: linear-gradient(120deg, #7c3aed 0%, #db2777 55%, #f97316 115%);
    --grad-soft: linear-gradient(120deg, #f5f3ff, #fdf2f8 60%, #fff7ed);
    --ink: #0f1222; --ink-2: #3b4256; --muted: #6b7280;
    --line: #ececf3; --bg: #ffffff; --bg-2: #faf9fe;
    --dark: #0b0b16; --dark-2: #14131f;
    --shadow: 0 10px 30px -12px rgba(30,10,60,.18);
    --shadow-lg: 0 30px 60px -20px rgba(30,10,60,.30);
    --r: 16px;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0; color: var(--ink); background: var(--bg);
    font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    line-height: 1.6; -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; text-decoration: none; }
  .wrap { max-width: 1140px; margin: 0 auto; padding: 0 22px; }

  /* Klaviatura navigatsiyasi uchun aniq fokus halqasi (sichqoncha bilan bosilganda chiqmaydi) */
  a:focus-visible, button:focus-visible, .btn:focus-visible, input:focus-visible, summary:focus-visible {
    outline: 2px solid var(--brand); outline-offset: 2px; border-radius: 4px;
  }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(124,58,237,.18); border-radius: 20px; border: 2px solid transparent; background-clip: padding-box; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(124,58,237,.32); background-clip: padding-box; }
  * { scrollbar-width: thin; scrollbar-color: rgba(124,58,237,.25) transparent; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; scroll-behavior: auto !important; }
  }
  h1,h2,h3 { line-height: 1.12; letter-spacing: -.03em; margin: 0; font-family: "Plus Jakarta Sans", "Inter", system-ui, sans-serif; }
  .gt { background: var(--grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .eyebrow {
    display: inline-flex; align-items: center; gap: 7px; font-size: 13.5px; font-weight: 600;
    color: var(--brand); background: #f3effe; border: 1px solid #e9e1fb;
    padding: 7px 15px; border-radius: 999px;
  }
  .muted { color: var(--muted); }

  /* Buttons */
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    padding: 13px 24px; border-radius: 12px; font-weight: 650; font-size: 15.5px;
    cursor: pointer; border: 0; transition: transform .08s, box-shadow .2s, filter .2s;
  }
  .btn.primary { background: var(--grad); color: #fff; box-shadow: 0 8px 20px -8px rgba(124,58,237,.6); }
  .btn.primary:hover { filter: brightness(1.06); box-shadow: 0 12px 26px -8px rgba(124,58,237,.7); }
  .btn.ghost { background: #fff; color: var(--ink); border: 1px solid var(--line); }
  .btn.ghost:hover { background: var(--bg-2); }
  .btn.lg { padding: 15px 30px; font-size: 16.5px; }
  .btn:active { transform: translateY(1px); }

  /* ===== Nav ===== */
  header.nav {
    position: sticky; top: 0; z-index: 100;
    background: rgba(255,255,255,.72); backdrop-filter: saturate(180%) blur(14px);
    border-bottom: 1px solid transparent; transition: border-color .2s, box-shadow .2s;
  }
  header.nav.scrolled { border-color: var(--line); box-shadow: 0 4px 20px -14px rgba(0,0,0,.4); }
  .nav-inner { display: flex; align-items: center; gap: 20px; height: 66px; }
  .brand { display: inline-flex; align-items: center; gap: 10px; font-weight: 800; font-size: 17px; letter-spacing: -.02em; }
  .brand .mark { width: 32px; height: 32px; border-radius: 9px; background: var(--grad); display: grid; place-items: center; font-size: 17px; }
  .nav-menu { display: flex; gap: 4px; margin-left: 8px; }
  .nav-menu a { padding: 9px 13px; border-radius: 9px; font-size: 14.5px; font-weight: 500; color: var(--ink-2); }
  .nav-menu a:hover { background: var(--bg-2); color: var(--ink); }
  .nav-menu a.active { color: var(--brand); background: #f3effe; }
  .nav-right { margin-left: auto; display: flex; align-items: center; gap: 12px; }
  /* Globe language dropdown */
  .lang-dd { position: relative; }
  .lang-dd summary { list-style: none; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 11px; border: 1px solid var(--line); border-radius: 10px; background: #fff; color: var(--ink-2);
    font-size: 13px; font-weight: 700; transition: .15s; }
  .lang-dd summary::-webkit-details-marker { display: none; }
  .lang-dd summary:hover { border-color: #e0d5fb; color: var(--brand); }
  .lang-dd[open] summary { border-color: var(--brand); color: var(--brand); }
  .lang-dd .chev { font-size: 10px; transition: transform .2s; }
  .lang-dd[open] .chev { transform: rotate(180deg); }
  .lang-menu { position: absolute; right: 0; top: calc(100% + 8px); width: 190px; background: #fff;
    border: 1px solid var(--line); border-radius: 13px; box-shadow: var(--shadow-lg); padding: 6px; z-index: 120;
    animation: ddin .16s ease; }
  @keyframes ddin { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
  .lang-menu a { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 9px;
    font-size: 14px; color: var(--ink-2); }
  .lang-menu a b { color: var(--brand); min-width: 22px; }
  .lang-menu a:hover { background: var(--bg-2); }
  .lang-menu a.active { background: #f3effe; color: var(--brand); font-weight: 600; }
  .nav-cta { display: flex; align-items: center; gap: 10px; }
  .nav-cta .btn { padding: 9px 18px; font-size: 14px; border-radius: 10px; }
  .menu-toggle, .menu-check { display: none; }

  /* ===== Sections ===== */
  section { padding: 84px 0; }
  .sec-head { text-align: center; max-width: 680px; margin: 0 auto 48px; }
  .sec-head h2 { font-size: clamp(26px, 4vw, 38px); margin: 14px 0 12px; }
  .sec-head p { font-size: 17px; color: var(--muted); margin: 0; }

  /* ===== Hero ===== */
  .hero { position: relative; overflow: hidden; padding: 64px 0 72px; }
  .hero::before {
    content: ""; position: absolute; inset: 0; z-index: -1;
    background:
      radial-gradient(650px 380px at 82% 12%, rgba(219,39,119,.14), transparent 62%),
      radial-gradient(620px 420px at 8% 6%, rgba(124,58,237,.16), transparent 60%),
      var(--grad-soft);
  }
  .hero-grid { display: grid; grid-template-columns: 1.05fr .95fr; gap: 40px; align-items: center; }
  .hero h1 { font-size: clamp(34px, 5.4vw, 56px); font-weight: 850; }
  .hero .lede { font-size: 18.5px; color: var(--ink-2); margin: 22px 0 28px; max-width: 540px; }
  .hero-cta { display: flex; gap: 14px; flex-wrap: wrap; }
  .hero-trust { margin-top: 24px; display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 14px; }
  .stars { color: #f59e0b; letter-spacing: 2px; }

  /* Phone mockup */
  .phone-wrap { display: flex; flex-direction: column; align-items: center; gap: 16px; width: 100%; max-width: 380px; margin: 0 auto; }
  .phone {
    width: min(320px, 90vw); background: #fff; border-radius: 34px; padding: 12px;
    box-shadow: 0 20px 40px -15px rgba(124,58,237,.22), 0 0 0 1px rgba(0,0,0,.08); position: relative; margin: 0 auto;
  }
  .phone::after { content: ""; position: absolute; top: 16px; left: 50%; transform: translateX(-50%); width: 90px; height: 6px; background: #eef; border-radius: 999px; }
  .phone-screen { background: #fafafb; border-radius: 24px; overflow: hidden; height: 490px; display: flex; flex-direction: column; }
  .ig-top { display: flex; align-items: center; gap: 10px; padding: 26px 16px 12px; border-bottom: 1px solid #f0f0f3; background: #fff; }
  .ig-av { width: 36px; height: 36px; border-radius: 50%; background: var(--grad); flex: none; }
  .ig-name { font-weight: 700; font-size: 14px; }
  .ig-sub { font-size: 11px; color: var(--muted); }
  .ig-cam { margin-left: auto; font-size: 16px; }
  .chat { flex: 1; padding: 16px 14px; display: flex; flex-direction: column; gap: 9px; overflow: hidden; }
  .msg { max-width: 78%; padding: 9px 13px; border-radius: 16px; font-size: 13px; line-height: 1.4; opacity: 0; transform: translateY(8px); animation: pop .5s forwards; }
  .msg.in { align-self: flex-start; background: #fff; border: 1px solid #eee; border-bottom-left-radius: 5px; }
  .msg.out { align-self: flex-end; color: #fff; background: var(--grad); border-bottom-right-radius: 5px; }
  .msg.m1 { animation-delay: .3s; } .msg.m2 { animation-delay: 1.0s; }
  .msg.m3 { animation-delay: 1.8s; } .msg.m4 { animation-delay: 2.6s; }
  .typing { align-self: flex-end; background: var(--grad); padding: 11px 14px; border-radius: 16px; border-bottom-right-radius: 5px; display: inline-flex; gap: 4px; opacity: 0; animation: pop .4s 2.2s forwards, fadeOut .3s 2.7s forwards; }
  .typing i { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,.85); animation: blink 1s infinite; }
  .typing i:nth-child(2){ animation-delay:.2s } .typing i:nth-child(3){ animation-delay:.4s }
  .ig-bar { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid #f0f0f3; background: #fff; }
  .ig-input { flex: 1; height: 30px; border-radius: 999px; background: #f3f3f6; }

  /* Interactive channel selector tabs */
  .ch-tabs { display: flex; justify-content: center; align-items: center; gap: 6px; width: 100%; flex-wrap: wrap; margin: 0; }
  .ch-tab {
    padding: 7px 14px; border-radius: 999px; font-size: 13px; font-weight: 650;
    border: 1px solid var(--line); background: #fff; color: var(--ink-2); cursor: pointer;
    transition: all .15s ease; outline: none; height: 36px; display: inline-flex; align-items: center; justify-content: center;
  }
  .ch-tab:hover { background: var(--bg-2); border-color: var(--brand); }
  .ch-tab.active { background: var(--grad); color: #fff; border-color: transparent; box-shadow: 0 4px 14px rgba(124,58,237,.35); }

  /* Channel Grid Section */
  .channel-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-top: 30px; }
  .channel-card {
    background: #fff; border: 1px solid var(--line); border-radius: 16px; padding: 22px;
    transition: transform .2s, box-shadow .2s, border-color .2s; position: relative; overflow: hidden;
  }
  .channel-card:hover { transform: translateY(-4px); box-shadow: 0 16px 30px -10px rgba(0,0,0,.08); }
  .channel-card.ig { border-top: 4px solid #db2777; }
  .channel-card.tg { border-top: 4px solid #229ED9; }
  .channel-card.wa { border-top: 4px solid #25D366; }
  .channel-card.fb { border-top: 4px solid #0084FF; }
  .channel-card h3 { font-size: 17px; margin: 10px 0 6px; display: flex; align-items: center; gap: 8px; }
  .channel-card p { font-size: 13.5px; color: var(--muted); margin: 0 0 12px; line-height: 1.5; }
  .channel-card ul { list-style: none; padding: 0; margin: 0; font-size: 12.5px; color: var(--ink-2); }
  .channel-card ul li { padding: 4px 0; display: flex; align-items: center; gap: 6px; }
  .channel-card ul li::before { content: "✓"; font-weight: bold; color: var(--brand); }

  @media (max-width: 900px) {
    .channel-grid { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 580px) {
    .channel-grid { grid-template-columns: 1fr; }
  }
  @keyframes pop { to { opacity: 1; transform: translateY(0); } }
  @keyframes fadeOut { to { opacity: 0; display: none; } }
  @keyframes blink { 0%,100%{ opacity:.3 } 50%{ opacity:1 } }

  /* Logos strip */
  .logos { padding: 34px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); background: var(--bg-2); }
  .logos p { text-align: center; color: var(--muted); font-size: 13.5px; margin: 0 0 16px; font-weight: 500; }
  .logo-row { display: flex; justify-content: center; flex-wrap: wrap; gap: 12px 26px; }
  .logo-pill { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; color: var(--ink-2); font-size: 15px; opacity: .8; }

  /* Cards grid */
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .card2 { background: #fff; border: 1px solid var(--line); border-radius: var(--r); padding: 24px; transition: transform .18s, box-shadow .18s, border-color .18s; }
  .card2:hover { transform: translateY(-4px); box-shadow: var(--shadow); border-color: #e5ddfa; }
  .card2 .ico { width: 48px; height: 48px; border-radius: 13px; background: #f3effe; display: grid; place-items: center; color: #7c3aed; margin-bottom: 14px; }
  .card2 h3 { font-size: 17px; margin-bottom: 6px; }
  .card2 p { color: var(--muted); font-size: 14.5px; margin: 0; }

  /* Steps */
  .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; }
  .step { text-align: center; padding: 0 8px; position: relative; }
  .step .n { width: 52px; height: 52px; margin: 0 auto 16px; border-radius: 50%; background: var(--grad); color: #fff; font-weight: 800; font-size: 20px; display: grid; place-items: center; box-shadow: 0 10px 20px -8px rgba(124,58,237,.6); }
  .step h3 { font-size: 18px; margin-bottom: 6px; }
  .step p { color: var(--muted); font-size: 14.5px; }

  /* Stats band */
  .band { background: var(--dark); color: #fff; }
  .band .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; text-align: center; }
  .band .num { font-size: clamp(30px, 4vw, 44px); font-weight: 850; letter-spacing: -.03em; background: linear-gradient(120deg,#c4b5fd,#f9a8d4,#fdba74); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .band .lbl { color: #b9b8c6; font-size: 14px; margin-top: 4px; }

  /* Pricing */
  .plans { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 14px; margin: 0 auto; }
  .plans .plan { padding: 26px 20px; display: flex; flex-direction: column; }
  .plans .plan ul { flex: 1; }
  .plans .plan .tl { min-height: 2.9em; }
  .plans .plan .price { font-size: 30px; white-space: nowrap; }
  .plans .plan .price small { display: block; margin-top: 2px; font-size: 13.5px; }
  @media (max-width: 1180px) { .plans { grid-template-columns: repeat(3, minmax(0,1fr)); max-width: 900px; } }
  .plan { background: #fff; border: 1px solid var(--line); border-radius: 20px; padding: 30px; position: relative; }
  .plan.pop { border: 2px solid transparent; background:
      linear-gradient(#fff,#fff) padding-box,
      var(--grad) border-box; box-shadow: var(--shadow-lg); }
  .plan .tag { position: absolute; top: -13px; left: 50%; transform: translateX(-50%); background: var(--grad); color: #fff; font-size: 12px; font-weight: 700; padding: 5px 14px; border-radius: 999px; }
  .plan h3 { font-size: 20px; }
  .plan .tl { color: var(--muted); font-size: 14px; margin: 3px 0 16px; }
  .plan .price { font-size: 38px; font-weight: 850; letter-spacing: -.03em; }
  .plan .price small { font-size: 15px; font-weight: 500; color: var(--muted); }
  .plan ul { list-style: none; padding: 0; margin: 20px 0 24px; }
  .plan li { display: flex; gap: 10px; align-items: flex-start; padding: 7px 0; font-size: 14.5px; color: var(--ink-2); }
  .plan li::before { content: "✓"; color: var(--brand); font-weight: 800; }
  .plan .btn { width: 100%; }

  /* Testimonials */
  .quotes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .quote { background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--r); padding: 24px; }
  .quote p { font-size: 15px; color: var(--ink-2); margin: 0 0 16px; }
  .quote .who { display: flex; align-items: center; gap: 11px; }
  .quote .av { width: 40px; height: 40px; border-radius: 50%; background: var(--grad); flex: none; }
  .quote b { font-size: 14px; display: block; } .quote span { font-size: 12.5px; color: var(--muted); }

  /* FAQ */
  .faq { max-width: 760px; margin: 0 auto; }
  .faq details { border: 1px solid var(--line); border-radius: 12px; padding: 4px 18px; margin-bottom: 12px; background: #fff; transition: border-color .2s; }
  .faq details[open] { border-color: #e0d5fb; box-shadow: var(--shadow); }
  .faq summary { cursor: pointer; list-style: none; padding: 16px 0; font-weight: 650; font-size: 16px; display: flex; justify-content: space-between; gap: 16px; align-items: center; }
  .faq summary::-webkit-details-marker { display: none; }
  .faq summary::after { content: "+"; font-size: 24px; color: var(--brand); font-weight: 400; transition: transform .2s; }
  .faq details[open] summary::after { transform: rotate(45deg); }
  .faq .ans { padding: 0 0 18px; color: var(--muted); font-size: 15px; }

  /* CTA band */
  .cta-band { background: var(--grad); color: #fff; text-align: center; border-radius: 28px; padding: 60px 30px; margin: 0 22px; position: relative; overflow: hidden; }
  .cta-band::before { content:""; position:absolute; inset:0; background: radial-gradient(400px 200px at 20% 0%, rgba(255,255,255,.22), transparent 60%); }
  .cta-band h2 { font-size: clamp(26px, 4vw, 40px); position: relative; }
  .cta-band p { font-size: 17px; opacity: .92; margin: 12px 0 26px; position: relative; }
  .cta-band .btn { background: #fff; color: var(--brand); position: relative; }

  /* Contact */
  .contact-grid { display: grid; grid-template-columns: 1.2fr .8fr; gap: 28px; max-width: 940px; margin: 0 auto; }
  .contact-card { background: #fff; border: 1px solid var(--line); border-radius: var(--r); padding: 28px; box-shadow: var(--shadow); }
  .contact-card label { display: block; font-size: 13.5px; font-weight: 600; margin: 14px 0 6px; }
  .contact-card input, .contact-card textarea { width: 100%; padding: 12px 14px; border: 1px solid var(--line); border-radius: 11px; font-size: 15px; font-family: inherit; }
  .contact-card input:focus, .contact-card textarea:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 4px rgba(124,58,237,.14); }
  .contact-card textarea { min-height: 130px; resize: vertical; }
  .contact-info a { display: flex; align-items: center; gap: 13px; padding: 15px; border: 1px solid var(--line); border-radius: 12px; margin-bottom: 12px; background: #fff; transition: .18s; }
  .contact-info a:hover { border-color: #e0d5fb; box-shadow: var(--shadow); }
  .contact-info .ci { width: 42px; height: 42px; border-radius: 11px; background: #f3effe; display: grid; place-items: center; font-size: 20px; flex: none; }

  /* Footer */
  footer.site { background: var(--dark); color: #cfced9; padding: 60px 0 30px; }
  .foot-grid { display: grid; grid-template-columns: 1.6fr 1fr 1fr 1fr 1.1fr; gap: 30px; }
  footer.site .brand { color: #fff; }
  footer.site .tag { color: #9998a6; font-size: 14px; margin: 14px 0 18px; max-width: 300px; }
  footer.site h4 { color: #fff; font-size: 14px; margin: 0 0 14px; }
  footer.site .fcol a { display: block; color: #a9a8b6; font-size: 14px; padding: 5px 0; }
  footer.site .fcol a:hover { color: #fff; }
  .foot-bottom { border-top: 1px solid #24222f; margin-top: 40px; padding-top: 22px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 14px; align-items: center; color: #8b8a98; font-size: 13px; }
  .foot-lang { display: inline-flex; background: #1c1a28; border-radius: 10px; overflow: hidden; }
  .foot-lang a { padding: 6px 12px; font-size: 12.5px; font-weight: 700; color: #8b8a98; }
  .foot-lang a.active { background: var(--grad); color: #fff; }

  /* ===== Responsive ===== */
  @media (max-width: 1024px) {
    .cards { grid-template-columns: repeat(2, 1fr); }
    .quotes { grid-template-columns: repeat(3, 1fr); gap: 16px; }
  }
  @media (max-width: 900px) {
    .hero { padding: 48px 0 56px; }
    .hero-grid { grid-template-columns: 1fr; gap: 32px; text-align: center; }
    .hero .lede { margin-left: auto; margin-right: auto; }
    .hero-cta, .hero-trust { justify-content: center; }
    .phone-wrap { order: -1; }
    .steps { grid-template-columns: 1fr; max-width: 460px; margin: 0 auto; }
    .band .stats { grid-template-columns: 1fr 1fr; gap: 30px; }
    .quotes { grid-template-columns: 1fr; }
    .plans { grid-template-columns: repeat(2, minmax(0,1fr)); max-width: 760px; }
    .foot-grid { grid-template-columns: 1fr 1fr; gap: 24px; }
    .contact-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 680px) {
    .nav-inner { height: 60px; }
    .nav-menu { display: none; position: absolute; top: 60px; left: 0; right: 0; flex-direction: column; background: #fff; border-bottom: 1px solid var(--line); padding: 10px 20px; gap: 2px; box-shadow: var(--shadow); }
    .menu-check:checked ~ .nav-menu { display: flex; }
    .menu-toggle { display: inline-grid; place-items: center; width: 40px; height: 40px; border-radius: 10px; border: 1px solid var(--line); background: #fff; cursor: pointer; font-size: 18px; }
    .nav-cta .btn.ghost { display: none; }
    .cards { grid-template-columns: 1fr; }
    section { padding: 56px 0; }
    .sec-head { margin-bottom: 34px; }
    .plans { grid-template-columns: 1fr; max-width: 420px; }
    .foot-grid { grid-template-columns: 1fr 1fr; }
    .brand .txt { display: none; }
    .cta-band { padding: 44px 22px; margin: 0 16px; }
  }
  @media (max-width: 480px) {
    .wrap { padding: 0 16px; }
    .hero h1 { font-size: 30px; } .hero .lede { font-size: 16.5px; }
    .hero-cta { flex-direction: column; align-items: stretch; }
    .hero-cta .btn { width: 100%; }
    .band .stats { grid-template-columns: 1fr 1fr; gap: 22px 16px; }
    .foot-grid { grid-template-columns: 1fr 1fr; gap: 22px 16px; }
    .foot-grid > div:first-child { grid-column: 1 / -1; }
    .foot-bottom { flex-direction: column; align-items: flex-start; }
    .lang-menu { width: 170px; }
    .card2, .quote { padding: 20px; }
  }
  @media (max-width: 360px) {
    .nav-cta .btn.primary { padding: 10px 14px; font-size: 14px; }
    .lang-dd summary span { display: none; }
  }
${HOME_CSS}
</style>
</head>
<body>
<header class="nav" id="nav">
  <div class="wrap nav-inner">
    <a class="brand" href="/">${logoMark(32)}<span class="txt">Obunext</span></a>
    <input type="checkbox" id="mc" class="menu-check">
    <nav class="nav-menu">
      ${navLink("/features", "features", nav.features)}
      ${navLink("/#how", "how", nav.how)}
      ${navLink("/pricing", "pricing", nav.pricing)}
      ${navLink("/faq", "faq", nav.faq)}
      ${navLink("/contact", "contact", nav.contact)}
    </nav>
    <div class="nav-right">
      ${langDropdown}
      <div class="nav-cta">
        ${
          user
            ? `<a class="btn primary" href="/dashboard">${nav.dashboard}</a>`
            : `<a class="btn ghost" href="/login">${nav.login}</a>
               <a class="btn primary" href="/register">${nav.start}</a>`
        }
      </div>
      <label for="mc" class="menu-toggle">☰</label>
    </div>
  </div>
</header>
${body}
${footer(lang, path, tr)}
<script>
  var n=document.getElementById('nav');
  addEventListener('scroll',function(){ n.classList.toggle('scrolled', scrollY>8); },{passive:true});
  document.addEventListener('click',function(e){
    document.querySelectorAll('details.lang-dd[open]').forEach(function(d){ if(!d.contains(e.target)) d.removeAttribute('open'); });
  });
</script>
</body>
</html>`;
}

function footer(lang, path, tr) {
  const f = tr.footer;
  const L = f.links;
  const footLang = Object.keys(LANGS)
    .map(
      (c) => `<a href="${path}?lang=${c}" class="${c === lang ? "active" : ""}">${LANG_SHORT[c]}</a>`
    )
    .join("");
  return `<footer class="site">
    <div class="wrap">
      <div class="foot-grid">
        <div>
          <a class="brand" href="/">${logoMark(30)}<span>Obunext</span></a>
          <p class="tag">${esc(f.tagline)}</p>
        </div>
        <div class="fcol"><h4>${esc(f.colProduct)}</h4>
          <a href="/features">${esc(L.features)}</a>
          <a href="/pricing">${esc(L.pricing)}</a>
          <a href="/#how">${esc(L.how)}</a>
        </div>
        <div class="fcol"><h4>${esc(f.colHelp)}</h4>
          <a href="/faq">${esc(L.faq)}</a>
          <a href="/contact">${esc(L.contact)}</a>
        </div>
        <div class="fcol"><h4>${esc(f.colCompany)}</h4>
          <a href="/login">${esc(L.login)}</a>
          <a href="/register">${esc(L.start)}</a>
        </div>
        <div class="fcol"><h4>Hujjatlar</h4>
          <a href="/offer">Ommaviy oferta</a>
          <a href="/privacy-policy">Maxfiylik siyosati</a>
          <a href="/terms">Foydalanish shartlari</a>
          <a href="/data-deletion">Ma'lumotlarni o'chirish</a>
        </div>
      </div>
      <div class="foot-legal" style="border-top:1px solid rgba(255,255,255,.09);margin-top:26px;padding-top:20px;font-size:13px;color:#9998a6;line-height:1.7">
        ${esc(LEGAL.nameShort)} · STIR ${esc(LEGAL.stir)}<br>
        ${esc(LEGAL.address)}<br>
        Tel: ${esc(siteSettings().phone || LEGAL.phone)} · ${esc(legalEmail())}<br>
        Narxlar O'zbekiston Respublikasi milliy valyutasida (so'm, UZS) ko'rsatilgan.
      </div>
      <div class="foot-bottom">
        <span>© ${new Date().getFullYear()} Obunext · ${esc(f.rights)}</span>
        <span class="foot-lang">${footLang}</span>
      </div>
    </div>
  </footer>`;
}

// ==================== BO'LIMLAR (reusable) ====================

async function pricingCards(tr) {
  const p = tr.pricing;
  const live = await getPlans(); // admin o'zgartirgan jonli narxlar
  return `<div class="plans">
    ${p.plans
      .map((pl, i) => {
        const priceNum = live[pl.id]?.price;
        const priceStr = priceNum ? priceNum.toLocaleString("uz") : pl.price;
        const pop = pl.id === "pro";
        return `<div class="plan ${pop ? "pop" : ""}">
        ${pop ? `<span class="tag">${esc(p.popular)}</span>` : ""}
        <h3>${esc(pl.name)}</h3>
        <p class="tl">${esc(pl.tagline)}</p>
        <div class="price">${esc(priceStr)} <small>${esc(p.currency)}${esc(p.perMonth)}</small></div>
        <ul>${AI_QUOTA[pl.id] && p.aiPerMonth ? `<li><b>${esc(p.aiPerMonth.replace("{n}", AI_QUOTA[pl.id].toLocaleString("ru-RU")))}</b></li>` : ""}${pl.features.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        <a href="/register" class="btn ${pop ? "primary" : "ghost"}">${esc(p.cta)}</a>
      </div>`;
      })
      .join("")}
  </div>`;
}

function faqAccordion(items) {
  return `<div class="faq">
    ${items
      .map(
        (it) => `<details>
        <summary>${esc(it.q)}</summary>
        <div class="ans">${esc(it.a)}</div>
      </details>`
      )
      .join("")}
  </div>`;
}

// ==================== SAHIFALAR ====================

site.get("/", async (req, res) => {
  const lang = req.lang;
  const tr = t(lang);
  const h = tr.hero, how = tr.how, st = tr.stats, ts = tr.testimonials, fq = tr.faq, cta = tr.ctaBand;

  const H = home(lang);
  // Faqat admin panelda kiritilgan haqiqiy fikrlar ko'rsatiladi (namunaviy/o'ylab topilgan emas)
  const quotes = siteSettings().testimonials;
  const body = `
  <section class="hero hx-hero">
    <div class="wrap hero-grid">
      <div>
        <span class="eyebrow">${esc(h.badge)}</span>
        <h1 style="margin-top:18px">${esc(h.titleA)} <span class="gt">${esc(h.titleHi)}</span> ${esc(h.titleB)}</h1>
        <p class="lede">${esc(h.sub)}</p>
        <div class="hero-cta">
          <a href="/register" class="btn primary lg">${esc(h.ctaPrimary)} →</a>
          <a href="/#showcase" class="btn ghost lg">${esc(H.heroSecondary)}</a>
        </div>
        ${heroTrust(lang, await trustLine(h), siteSettings().rating)}
      </div>
      ${heroStage(lang)}
    </div>
  </section>

  ${platformsStrip(lang)}
  ${showcaseSection(lang)}
  ${bentoSection(lang)}
  ${channelsSection(lang)}
  ${casesSection(lang)}

  <section id="how"><div class="wrap">
    <div class="sec-head">
      <span class="eyebrow">⚡ ${esc(how.badge)}</span>
      <h2>${esc(how.title)}</h2><p>${esc(how.sub)}</p>
    </div>
    <div class="steps">
      ${how.steps.map((s) => `<div class="step"><div class="n">${s.n}</div><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></div>`).join("")}
    </div>
  </div></section>

  <div class="band"><section><div class="wrap"><div class="stats">
    ${st.items.map((s) => `<div><div class="num">${esc(s.num)}</div><div class="lbl">${esc(s.label)}</div></div>`).join("")}
  </div></div></section></div>

  <section id="pricing"><div class="wrap">
    <div class="sec-head"><span class="eyebrow">💳 ${esc(tr.nav.pricing)}</span><h2>${esc(tr.pricing.title)}</h2><p>${esc(tr.pricing.sub)}</p></div>
    ${await pricingCards(tr)}
  </div></section>

  ${quotes.length ? `<section style="background:var(--bg-2);border-top:1px solid var(--line);border-bottom:1px solid var(--line)"><div class="wrap">
    <div class="sec-head"><h2>${esc(ts.title)}</h2></div>
    <div class="quotes">
      ${quotes.map((q, i) => `<div class="quote"><p>“${esc(q.quote)}”</p><div class="who">${testimonialAvatar(q.name, i)}<div><b>${esc(q.name)}</b><span>${esc(q.role)}</span></div></div></div>`).join("")}
    </div>
  </div></section>` : ""}

  <section id="faq"><div class="wrap">
    <div class="sec-head"><span class="eyebrow">❓ ${esc(tr.nav.faq)}</span><h2>${esc(fq.title)}</h2><p>${esc(fq.sub)}</p></div>
    ${faqAccordion(fq.items.slice(0, 4))}
    <p style="text-align:center;margin-top:20px"><a href="/faq" class="btn ghost">${esc(tr.nav.faq)} →</a></p>
  </div></section>

  <section style="padding-top:0"><div class="wrap"><div class="cta-band">
    <h2>${esc(cta.title)}</h2><p>${esc(cta.sub)}</p>
    <a href="/register" class="btn lg">${esc(cta.button)} →</a>
  </div></div></section>`;

  res.send(siteLayout(lang, "/", tr.nav.start, body, { user: req.user, active: "" }));
});

site.get("/features", (req, res) => {
  const lang = req.lang;
  const tr = t(lang);
  const fp = tr.featuresPage;
  const body = `
  <section class="hero" style="padding:56px 0 40px"><div class="wrap" style="text-align:center;max-width:760px;margin:0 auto">
    <span class="eyebrow">✨ ${esc(tr.nav.features)}</span>
    <h1 style="font-size:clamp(30px,5vw,50px);margin:16px 0 14px">${esc(fp.title)}</h1>
    <p class="lede" style="margin:0 auto">${esc(fp.sub)}</p>
    <div class="hero-cta" style="justify-content:center;margin-top:26px"><a href="/register" class="btn primary lg">${esc(tr.nav.start)} →</a><a href="/pricing" class="btn ghost lg">${esc(tr.nav.pricing)}</a></div>
  </div></section>
  ${showcaseSection(lang, { id: "product" })}
  ${bentoSection(lang)}
  ${channelsSection(lang)}
  ${casesSection(lang)}
  <section><div class="wrap"><div class="cta-band">
    <h2>${esc(tr.ctaBand.title)}</h2><p>${esc(tr.ctaBand.sub)}</p>
    <a href="/register" class="btn lg">${esc(tr.ctaBand.button)} →</a>
  </div></div></section>`;
  res.send(siteLayout(lang, "/features", tr.nav.features, body, { user: req.user, active: "features" }));
});

site.get("/pricing", async (req, res) => {
  const lang = req.lang;
  const tr = t(lang);
  const body = `
  <section class="hero" style="padding:56px 0 40px"><div class="wrap" style="text-align:center;max-width:720px;margin:0 auto">
    <span class="eyebrow">💳 ${esc(tr.nav.pricing)}</span>
    <h1 style="font-size:clamp(30px,5vw,46px);margin:16px 0 14px">${esc(tr.pricing.title)}</h1>
    <p class="lede" style="margin:0 auto">${esc(tr.pricing.sub)}</p>
  </div></section>
  <section style="padding-top:20px"><div class="wrap">${await pricingCards(tr)}</div></section>
  <section id="faq" style="padding-top:0"><div class="wrap">
    <div class="sec-head"><h2>${esc(tr.faq.title)}</h2></div>
    ${faqAccordion(tr.faq.items)}
  </div></section>`;
  res.send(siteLayout(lang, "/pricing", tr.nav.pricing, body, { user: req.user, active: "pricing" }));
});

site.get("/faq", (req, res) => {
  const lang = req.lang;
  const tr = t(lang);
  const body = `
  <section class="hero" style="padding:56px 0 40px"><div class="wrap" style="text-align:center;max-width:720px;margin:0 auto">
    <span class="eyebrow">❓ ${esc(tr.nav.faq)}</span>
    <h1 style="font-size:clamp(30px,5vw,46px);margin:16px 0 14px">${esc(tr.faq.title)}</h1>
    <p class="lede" style="margin:0 auto">${esc(tr.faq.sub)}</p>
  </div></section>
  <section style="padding-top:20px"><div class="wrap">${faqAccordion(tr.faq.items)}</div></section>
  <section style="padding-top:0"><div class="wrap"><div class="cta-band">
    <h2>${esc(tr.ctaBand.title)}</h2><p>${esc(tr.ctaBand.sub)}</p>
    <a href="/register" class="btn lg">${esc(tr.ctaBand.button)}</a>
  </div></div></section>`;
  res.send(siteLayout(lang, "/faq", tr.nav.faq, body, { user: req.user, active: "faq" }));
});

// ==================== AUTH (premium, ko'p tilli) ====================
// routes.js login/register handlerlaridan chaqiriladi.

export function authPage(lang, kind, { error = "", values = {}, refCode = "" } = {}) {
  const tr = t(lang);
  const a = tr.auth;
  const isReg = kind === "register";
  const path = isReg ? "/register" : "/login";
  const title = isReg ? a.registerTitle : a.loginTitle;
  const sub = isReg ? a.registerSub : a.loginSub;
  const btn = isReg ? a.registerBtn : a.loginBtn;
  const globe = `<svg viewBox="0 0 24 24" fill="none" width="17" height="17" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9S9.5 5.5 12 3z"/></svg>`;
  const langDd = `<details class="lang-dd">
    <summary>${globe}<span>${LANG_SHORT[lang]}</span></summary>
    <div class="lang-menu">${Object.keys(LANGS).map((c) => `<a href="${path}?lang=${c}" class="${c === lang ? "active" : ""}"><b>${LANG_SHORT[c]}</b> ${LANGS[c]}${c === lang ? " ✓" : ""}</a>`).join("")}</div>
  </details>`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Obunext</title>
<link rel="icon" href="/favicon.png" type="image/png">
<style>
  :root { --brand:#7c3aed; --grad:linear-gradient(120deg,#7c3aed,#db2777 55%,#f97316 115%); --ink:#0f1222; --muted:#6b7280; --line:#ececf3; }
  * { box-sizing:border-box; } html,body { height:100%; }
  body { margin:0; font-family:"Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:var(--ink); background:#fff; }
  a { color:var(--brand); text-decoration:none; } a:hover { text-decoration:underline; }
  a:focus-visible, button:focus-visible, .btn:focus-visible, input:focus-visible, .google-btn:focus-visible {
    outline: 2px solid var(--brand); outline-offset: 2px; border-radius: 4px;
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
  }
  .auth { display:grid; grid-template-columns:1.05fr 1fr; min-height:100vh; }
  /* Left brand panel */
  .side { position:relative; overflow:hidden; color:#fff; padding:52px 54px; display:flex; flex-direction:column; background:var(--grad); }
  .side::before { content:""; position:absolute; inset:0; background:radial-gradient(500px 300px at 85% 10%,rgba(255,255,255,.18),transparent 60%); }
  .side .brand { display:inline-flex; align-items:center; gap:11px; font-weight:800; font-size:18px; position:relative; }
  .side .mid { margin-top:auto; margin-bottom:auto; position:relative; }
  .side h2 { font-size:34px; line-height:1.15; letter-spacing:-.03em; margin:0 0 26px; max-width:420px; }
  .side ul { list-style:none; padding:0; margin:0; }
  .side li { display:flex; align-items:center; gap:12px; padding:9px 0; font-size:16px; }
  .side li .ck { width:26px; height:26px; border-radius:50%; background:rgba(255,255,255,.2); display:grid; place-items:center; flex:none; font-size:14px; }
  .side .quote { position:relative; font-size:15px; opacity:.9; border-left:3px solid rgba(255,255,255,.5); padding-left:14px; }
  /* Right form */
  .main { display:flex; flex-direction:column; padding:26px 30px; }
  .main-top { display:flex; justify-content:space-between; align-items:center; }
  .home-link { color:var(--muted); font-size:14px; font-weight:500; }
  .form-box { margin:auto; width:100%; max-width:400px; padding:20px 0; }
  .form-box h1 { font-size:28px; letter-spacing:-.03em; margin:0 0 6px; }
  .form-box .lead { color:var(--muted); margin:0 0 26px; font-size:15px; }
  label { display:block; font-size:13.5px; font-weight:600; margin:16px 0 6px; }
  input { width:100%; padding:12px 14px; border:1px solid var(--line); border-radius:11px; font-size:15px; font-family:inherit; transition:.15s; }
  input:focus { outline:none; border-color:var(--brand); box-shadow:0 0 0 4px rgba(124,58,237,.14); }
  .hint { color:var(--muted); font-size:12.5px; margin-top:5px; }
  .btn { width:100%; margin-top:22px; padding:13px; border:0; border-radius:12px; background:var(--grad); color:#fff; font-size:16px; font-weight:700; cursor:pointer; box-shadow:0 10px 22px -10px rgba(124,58,237,.7); transition:.15s; }
  .btn:hover { filter:brightness(1.06); }
  .err { background:#fef2f2; color:#b42318; border:1px solid #fecaca; border-radius:11px; padding:11px 14px; font-size:14px; margin-bottom:8px; }
  .switch { text-align:center; margin-top:22px; color:var(--muted); font-size:14.5px; }
  .google-btn { width:100%; display:flex; align-items:center; justify-content:center; gap:10px; padding:12px; border:1px solid var(--line); border-radius:12px; background:#fff; color:var(--ink); font-size:15px; font-weight:600; cursor:pointer; text-decoration:none; transition:.15s; }
  .google-btn:hover { background:#faf9fe; text-decoration:none; border-color:#d8d5e6; }
  .or-divider { display:flex; align-items:center; gap:12px; margin:22px 0; color:var(--muted); font-size:13px; }
  .or-divider::before, .or-divider::after { content:""; flex:1; height:1px; background:var(--line); }
  /* Lang dropdown */
  .lang-dd { position:relative; }
  .lang-dd summary { list-style:none; cursor:pointer; display:inline-flex; align-items:center; gap:6px; padding:7px 11px; border:1px solid var(--line); border-radius:10px; font-size:13px; font-weight:700; color:var(--muted); }
  .lang-dd summary::-webkit-details-marker { display:none; }
  .lang-dd[open] summary { border-color:var(--brand); color:var(--brand); }
  .lang-menu { position:absolute; right:0; top:calc(100% + 8px); width:190px; background:#fff; border:1px solid var(--line); border-radius:13px; box-shadow:0 20px 40px -14px rgba(30,10,60,.28); padding:6px; z-index:20; }
  .lang-menu a { display:flex; gap:8px; padding:10px 12px; border-radius:9px; font-size:14px; color:var(--ink); text-decoration:none; }
  .lang-menu a b { color:var(--brand); min-width:22px; } .lang-menu a:hover { background:#faf9fe; }
  .lang-menu a.active { background:#f3effe; color:var(--brand); }
  @media (max-width:860px){ .auth { grid-template-columns:1fr; } .side { display:none; } }
  @media (max-width:440px){ .main { padding:18px 16px; } .form-box { padding:8px 0; } .form-box h1 { font-size:24px; } }
</style></head>
<body>
<div class="auth">
  <div class="side">
    <a class="brand" href="/">${logoMark(34)} <span>Obunext</span></a>
    <div class="mid">
      <h2>${esc(a.sideTitle)}</h2>
      <ul>${a.points.map((p) => `<li><span class="ck">✓</span> ${esc(p)}</li>`).join("")}</ul>
    </div>
    <p class="quote">${esc(a.quote)}</p>
  </div>
  <div class="main">
    <div class="main-top">
      <a class="home-link" href="/">${esc(a.back)}</a>
      ${langDd}
    </div>
    <div class="form-box">
      <h1>${esc(title)}</h1>
      <p class="lead">${esc(sub)}</p>
      ${error ? `<div class="err">${esc(error)}</div>` : ""}
      ${googleAuthAvailable ? `
      <a class="google-btn" href="/auth/google${refCode ? `?ref=${encodeURIComponent(refCode)}` : ""}">
        <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.5 0 10.4-1.9 14.3-5.1l-6.6-5.6C29.6 35.1 26.9 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.6 5.1C9.6 39.7 16.3 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4 5.6l6.6 5.6C41.5 36 44 30.5 44 24c0-1.3-.1-2.7-.4-3.5z"/></svg>
        ${esc(a.googleBtn)}
      </a>
      <div class="or-divider">${esc(a.orDivider)}</div>
      ` : ""}
      <form method="post" action="${path}">
        ${isReg && refCode ? `<input type="hidden" name="ref" value="${esc(refCode)}">` : ""}
        ${isReg ? `<label>${esc(a.business)}</label><input name="businessName" required value="${esc(values.businessName || "")}" placeholder="${esc(a.business)}">` : ""}
        <label>${esc(a.email)}</label>
        <input name="email" type="email" required value="${esc(values.email || "")}" placeholder="you@email.com">
        <label>${esc(a.password)}</label>
        <input name="password" type="password" required ${isReg ? 'minlength="6"' : ""} placeholder="••••••••">
        ${isReg ? `<div class="hint">${esc(a.passwordHint)}</div>` : ""}
        <button class="btn">${esc(btn)}</button>
      </form>
      <p class="switch">${isReg ? `${esc(a.haveAccount)} <a href="/login?lang=${lang}">${esc(a.toLogin)}</a>` : `${esc(a.noAccount)} <a href="/register?lang=${lang}">${esc(a.toRegister)}</a>`}</p>
    </div>
  </div>
</div>
<script>document.addEventListener('click',function(e){document.querySelectorAll('details.lang-dd[open]').forEach(function(d){if(!d.contains(e.target))d.removeAttribute('open');});});</script>
</body></html>`;
}

// ==== Huquqiy sahifalar (Meta App Review va Publish uchun majburiy) ====

const legalEmail = () => siteSettings().email || SITE_DEFAULTS.email;
const LEGAL_UPDATED = "2026-07-18";

// Yuridik rekvizitlar — to'lov tizimlari (Visa/MasterCard) talabi bo'yicha
// maxfiylik siyosati va ofertada ko'rsatilishi shart.
const LEGAL = {
  nameFull: `"TGROUP" MAS'ULIYATI CHEKLANGAN JAMIYAT`,
  nameShort: `"TGROUP" MChJ`,
  stir: "312963267",
  address:
    "Namangan viloyati, Chust tumani, Chust shahri, Bofanda MFY, " +
    "Xamid Olimjon ko'chasi, 115-uy",
  account: "20208000607487304001",
  bank: "Aloqabank",
  mfo: "00401",
  phone: "+998 94 939 22 50",
  vat: "12%",
};

/** Rekvizitlar jadvali — oferta va maxfiylik siyosatida ishlatiladi */
const requisites = () => `
  <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:6px">
    ${[
      ["Tashkilot nomi", LEGAL.nameFull],
      ["Qisqartirilgan nom", LEGAL.nameShort],
      ["STIR (INN)", LEGAL.stir],
      ["Yuridik manzil", LEGAL.address],
      ["Hisob raqami", LEGAL.account],
      ["Bank", LEGAL.bank],
      ["MFO", LEGAL.mfo],
      ["QQS stavkasi", LEGAL.vat],
      ["Telefon", LEGAL.phone],
      ["Email", legalEmail()],
    ]
      .map(
        ([k, v]) =>
          `<tr>
             <td style="padding:7px 12px 7px 0;vertical-align:top;white-space:nowrap;opacity:.75">${esc(k)}</td>
             <td style="padding:7px 0;vertical-align:top"><b>${esc(v)}</b></td>
           </tr>`
      )
      .join("")}
  </table>`;

/** Huquqiy sahifalar uchun sodda matn uslubi */
const legalBody = (title, sections) => `
  <section class="hero" style="padding:56px 0 28px"><div class="wrap" style="max-width:820px;margin:0 auto">
    <h1 style="font-size:clamp(26px,4vw,38px);margin:0 0 10px">${esc(title)}</h1>
    <p class="muted" style="margin:0">Oxirgi yangilanish: ${LEGAL_UPDATED}</p>
  </div></section>
  <section style="padding-top:8px;padding-bottom:56px"><div class="wrap" style="max-width:820px;margin:0 auto">
    ${sections
      .map(
        (s) => `<h2 style="font-size:20px;margin:28px 0 10px">${esc(s.h)}</h2>
                <div class="muted" style="line-height:1.75">${s.body}</div>`
      )
      .join("")}
  </div></section>`;

site.get("/privacy-policy", (req, res) => {
  const body = legalBody("Maxfiylik siyosati / Privacy Policy", [
    {
      h: "1. Biz kim va bu xizmat nima qiladi",
      body: `Obunext — tadbirkorlarga Instagram, Facebook Messenger va WhatsApp'dagi
        mijoz xabarlariga sun'iy intellekt yordamida avtomatik javob berish imkonini beruvchi xizmat.
        Xizmat rasmiy Meta Graph API asosida ishlaydi.`,
    },
    {
      h: "2. Qanday ma'lumotlarni yig'amiz",
      body: `<b>Tadbirkor (xizmatdan foydalanuvchi) haqida:</b> email manzil, parolning kriptografik
        hash'i (parolning o'zi saqlanmaydi), biznes haqida o'zingiz kiritgan ma'lumot
        (mahsulotlar, narxlar, manzil, ish vaqti), obuna holati.<br><br>
        <b>Meta ulanishi orqali:</b> Instagram/Facebook/WhatsApp kirish tokenlari va akkaunt
        identifikatorlari — bular faqat sizning nomingizdan xabarlarga javob berish uchun ishlatiladi.<br><br>
        <b>Mijozlar (sizga yozganlar) haqida:</b> xabar matni, yuborilgan ovoz/rasm/video,
        Meta bergan foydalanuvchi identifikatori (ismi yoki telefon raqami emas) va xabar vaqti.`,
    },
    {
      h: "3. Ma'lumotlardan qanday foydalanamiz",
      body: `Yig'ilgan ma'lumot faqat quyidagilar uchun ishlatiladi: mijoz xabariga mazmunan javob
        yozish, suhbat kontekstini saqlash, xizmat statistikasini ko'rsatish va obunani boshqarish.
        Biz ma'lumotlaringizni sotmaymiz, reklama uchun ishlatmaymiz va uchinchi shaxslarga
        bermaymiz.`,
    },
    {
      h: "4. Uchinchi tomon xizmatlari",
      body: `Javob matnini yaratish uchun xabar mazmuni <b>Obunext</b> tomonidan qayta ishlanadi.
        Xabarlarni qabul qilish va yuborish <b>Meta Platforms</b> API'lari orqali amalga oshiriladi.
        Boshqa uchinchi tomonlarga ma'lumot uzatilmaydi.`,
    },
    {
      h: "5. Saqlash muddati va xavfsizlik",
      body: `Ma'lumotlar Yevropada joylashgan serverda saqlanadi. Suhbatlar tarixi biznes o'z panelida
        ko'rishi uchun akkaunt faol bo'lgan davrda saqlanadi; biznes mijoz kartasini yoki akkauntini
        o'chirsa — tegishli yozishmalar butunlay o'chiriladi. Ulanish HTTPS orqali shifrlanadi,
        parollar scrypt algoritmi bilan hash qilinadi, Meta webhook so'rovlari kriptografik imzo
        bilan tekshiriladi.`,
    },
    {
      h: "6. Sizning huquqlaringiz",
      body: `Istalgan vaqtda ma'lumotlaringizni ko'rish, tuzatish yoki butunlay o'chirishni talab
        qilishingiz mumkin. Buning uchun <a href="/data-deletion">ma'lumotlarni o'chirish</a>
        sahifasiga qarang yoki <a href="mailto:${esc(legalEmail())}">${esc(legalEmail())}</a> ga yozing.
        Instagram ulanishini dashboarddan yoki Instagram sozlamalaridan istalgan payt uzishingiz mumkin.`,
    },
    {
      h: "7. Rekvizitlar va aloqa",
      body: `Ma'lumotlarni qayta ishlash uchun javobgar shaxs (data controller):
        ${requisites()}`,
    },
    {
      h: "English summary",
      body: `This service lets businesses auto-reply to their Instagram, Messenger and WhatsApp
        customers using AI. We collect the business owner's email and business description, Meta
        access tokens, and incoming customer messages (text, voice, images) with Meta-provided user
        IDs. Message content is processed by Obunext to generate a reply. We do not sell or share
        your data. Data is stored on servers in Europe, encrypted in transit. To request access or
        deletion of your data, see <a href="/data-deletion">/data-deletion</a> or email
        <a href="mailto:${esc(legalEmail())}">${esc(legalEmail())}</a>.`,
    },
  ]);
  res.send(
    siteLayout(req.lang, "/privacy-policy", "Maxfiylik siyosati", body, { user: req.user })
  );
});

site.get("/terms", (req, res) => {
  const body = legalBody("Foydalanish shartlari / Terms of Service", [
    {
      h: "1. Xizmat haqida",
      body: `Obunext tadbirkorlarga o'z Instagram, Messenger va WhatsApp kanallarida
        mijozlarga avtomatik javob berish imkonini beradi. Xizmatdan foydalanish uchun ro'yxatdan
        o'tish talab qilinadi.`,
    },
    {
      h: "2. Obuna va to'lov",
      body: `Yangi foydalanuvchilar uchun bepul sinov muddati beriladi. Sinov tugagach, xizmatdan
        foydalanish uchun oylik obuna to'lovi talab qilinadi. Obuna tugasa, avtomatik javob berish
        to'xtaydi — ma'lumotlaringiz o'chirilmaydi.`,
    },
    {
      h: "3. Foydalanuvchi majburiyatlari",
      body: `Siz o'zingiz ulagan akkauntlarga egalik qilishingiz yoki ularni boshqarishga
        vakolatingiz bo'lishi kerak. Xizmatdan spam yuborish, aldash, qonunga xilof yoki Meta
        platformasi qoidalariga zid maqsadlarda foydalanish taqiqlanadi. AI tomonidan yaratilgan
        javoblar mazmuni uchun javobgarlik biznes egasiga tegishli.`,
    },
    {
      h: "4. Kafolatlar cheklovi",
      body: `Xizmat "bor holicha" taqdim etiladi. Meta yoki Google API'laridagi uzilishlar, AI
        javoblarining noaniqligi yoki xabarlarning kechikishi uchun javobgarlikni cheklaymiz.
        Muhim savollarda operator aralashuvi tavsiya etiladi.`,
    },
    {
      h: "5. Xizmatni to'xtatish",
      body: `Siz istalgan vaqtda akkauntingizni o'chirishingiz mumkin. Shartlar buzilgan taqdirda
        biz xizmatni to'xtatish huquqini saqlab qolamiz.`,
    },
    {
      h: "6. Aloqa",
      body: `<a href="mailto:${esc(legalEmail())}">${esc(legalEmail())}</a>`,
    },
  ]);
  res.send(siteLayout(req.lang, "/terms", "Foydalanish shartlari", body, { user: req.user }));
});

site.get("/offer", async (req, res) => {
  const plans = await getPlans();
  const body = legalBody("Ommaviy oferta / Public Offer", [
    {
      h: "Umumiy qoidalar",
      body: `Ushbu hujjat ${LEGAL.nameShort} (keyingi o'rinlarda — <b>Ijrochi</b>) tomonidan
        taqdim etilayotgan "Obunext" xizmatidan foydalanish bo'yicha rasmiy
        ommaviy taklif (oferta) hisoblanadi.<br><br>
        Saytda ro'yxatdan o'tish yoki to'lovni amalga oshirish orqali siz (keyingi
        o'rinlarda — <b>Buyurtmachi</b>) ushbu oferta shartlarini to'liq qabul qilgan
        hisoblanasiz. Bu O'zbekiston Respublikasi Fuqarolik kodeksining 370-moddasiga
        muvofiq yozma shartnoma tuzish bilan tenglashtiriladi.`,
    },
    {
      h: "1. Shartnoma predmeti",
      body: `Ijrochi Buyurtmachiga Instagram, Facebook Messenger va WhatsApp kanallarida
        mijoz xabarlariga sun'iy intellekt yordamida avtomatik javob berish uchun
        dasturiy platformadan foydalanish huquqini (oddiy litsenziya) taqdim etadi.
        Xizmat "SaaS" (bulutli xizmat) shaklida, internet orqali ko'rsatiladi.`,
    },
    {
      h: "2. Xizmat narxi va to'lov tartibi",
      body: `Narxlar O'zbekiston Respublikasi milliy valyutasida — <b>so'mda (UZS)</b>
        belgilanadi va QQS (${LEGAL.vat}) hisobga olingan holda ko'rsatiladi.<br><br>
        ${Object.values(plans).map((pl) => `<b>${esc(pl.name)}</b> — ${esc(pl.price.toLocaleString("ru-RU"))} so'm/oy<br>`).join("")}<br>
        Yangi Buyurtmachilarga <b>3 kunlik bepul sinov muddati</b> beriladi, karta
        ma'lumotlari talab qilinmaydi. To'lov oldindan, tanlangan tarif uchun bir oylik
        davrga amalga oshiriladi. To'lov Payme, Click yoki bank kartasi (Visa/MasterCard,
        UzCard/Humo) orqali qabul qilinadi. Amaldagi narxlar
        <a href="/pricing">narxlar sahifasida</a> ko'rsatiladi; Ijrochi narxlarni
        o'zgartirish huquqini saqlaydi, o'zgarish to'langan davrga taalluqli emas.`,
    },
    {
      h: "3. Xizmat ko'rsatish tartibi",
      body: `Xizmat to'lov tasdiqlangan zahoti faollashtiriladi va tanlangan tarif
        muddati davomida uzluksiz ko'rsatiladi. Buyurtmachi o'z ijtimoiy tarmoq
        akkauntlarini shaxsiy kabinet orqali mustaqil ulaydi. Xizmat 24/7 rejimida
        ishlaydi; texnik profilaktika oldindan ma'lum qilinadi.`,
    },
    {
      h: "4. Pulni qaytarish shartlari",
      body: `Buyurtmachi Ijrochining aybi bilan xizmat ko'rsatilmagan taqdirda
        (platforma 24 soatdan ortiq uzluksiz ishlamagan bo'lsa) to'langan summani
        qaytarishni talab qilishi mumkin. So'rov <a href="mailto:${esc(legalEmail())}">${esc(legalEmail())}</a>
        ga yuboriladi va <b>10 ish kuni</b> ichida ko'rib chiqiladi.<br><br>
        Qaytariladigan summa foydalanilmagan kunlar uchun mutanosib hisoblanadi va
        to'lov amalga oshirilgan usul orqali qaytariladi. Bepul sinov muddati uchun
        to'lov olinmagani sababli qaytarish qo'llanilmaydi. Buyurtmachi shartlarni
        buzgani uchun xizmat to'xtatilgan holatda to'lov qaytarilmaydi.`,
    },
    {
      h: "5. Tomonlarning majburiyatlari",
      body: `<b>Ijrochi majburiyatlari:</b> xizmatning uzluksiz ishlashini ta'minlash,
        Buyurtmachi ma'lumotlarining maxfiyligini saqlash
        (<a href="/privacy-policy">maxfiylik siyosati</a>), texnik yordam ko'rsatish.<br><br>
        <b>Buyurtmachi majburiyatlari:</b> to'lovni o'z vaqtida amalga oshirish; faqat
        o'ziga tegishli yoki boshqarishga vakolati bor akkauntlarni ulash; xizmatdan
        spam yuborish, aldash, qonunga xilof yoki Meta platformasi qoidalariga zid
        maqsadlarda foydalanmaslik; kirish ma'lumotlarini uchinchi shaxslarga bermaslik.`,
    },
    {
      h: "6. Javobgarlik",
      body: `Xizmat "bor holicha" taqdim etiladi. Ijrochi uchinchi tomon xizmatlaridagi
        (Meta, Google) uzilishlar, sun'iy intellekt javoblarining noaniqligi yoki
        xabarlarning kechikishi uchun javobgar emas. Ijrochining javobgarligi hisobot
        davri uchun to'langan summa bilan cheklanadi. AI tomonidan yaratilgan javoblar
        mazmuni uchun javobgarlik Buyurtmachiga tegishli. Fors-major holatlarida
        tomonlar javobgarlikdan ozod qilinadi.`,
    },
    {
      h: "7. Shartnoma muddati va bekor qilish",
      body: `Oferta akseptdan boshlab kuchga kiradi va to'langan muddat tugagunicha amal
        qiladi. Buyurtmachi istalgan vaqtda akkauntini o'chirish orqali shartnomani
        bekor qilishi mumkin. Ijrochi oferta shartlarini buzgan Buyurtmachiga xizmat
        ko'rsatishni to'xtatish huquqini saqlaydi. Nizolar muzokara yo'li bilan, kelishuv
        bo'lmasa O'zbekiston Respublikasi qonunchiligiga muvofiq sud tartibida hal
        etiladi.`,
    },
    {
      h: "8. Ijrochining rekvizitlari",
      body: requisites(),
    },
  ]);
  res.send(siteLayout(req.lang, "/offer", "Ommaviy oferta", body, { user: req.user }));
});

site.get("/data-deletion", (req, res) => {
  const body = legalBody("Ma'lumotlarni o'chirish / Data Deletion", [
    {
      h: "Ma'lumotlaringizni qanday o'chirasiz",
      body: `<b>1-usul — o'zingiz:</b> dashboardga kiring va akkauntni o'chirish tugmasidan
        foydalaning, yoki Instagram ulanishini uzing. Ulanish uzilgach, biz sizning nomingizdan
        hech qanday xabar ola olmaymiz va yubora olmaymiz.<br><br>
        <b>2-usul — Instagram tomonidan:</b> Instagram akkauntingizda
        Sozlamalar → Ilovalar va saytlar bo'limiga kiring va "Obunext" ilovasini o'chiring.<br><br>
        <b>3-usul — so'rov yuborish:</b> <a href="mailto:${esc(legalEmail())}">${esc(legalEmail())}</a> ga
        ro'yxatdan o'tgan emailingizdan yozing. So'rovingizni 30 kun ichida bajaramiz va
        tasdiqnoma yuboramiz.`,
    },
    {
      h: "Nimalar o'chiriladi",
      body: `Akkauntingiz, biznes ma'lumotlaringiz, saqlangan Meta tokenlari, barcha suhbat
        tarixi va statistika butunlay o'chiriladi. Zaxira nusxalardan ham 30 kun ichida
        chiqarib tashlanadi.`,
    },
    {
      h: "English",
      body: `To delete your data: (1) remove the connection from your dashboard or delete your
        account; (2) remove the "Obunext" app from Instagram Settings → Apps and Websites; or
        (3) email <a href="mailto:${esc(legalEmail())}">${esc(legalEmail())}</a> from your registered address.
        We complete deletion requests within 30 days, including backups, and send you a
        confirmation. Deleted data includes your account, business information, stored Meta
        access tokens, all conversation history and statistics.`,
    },
  ]);
  res.send(
    siteLayout(req.lang, "/data-deletion", "Ma'lumotlarni o'chirish", body, { user: req.user })
  );
});

const contactLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 5 });

site.post("/contact", contactLimiter, async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.redirect("/contact?sent=1"); // bot (yashirin maydon to'ldirilgan)
  const r = await addContactMessage({ name: b.name, email: b.email, phone: b.phone, message: b.message, lang: b.lang, ip: req.ip });
  if (!r.ok) return res.redirect("/contact?err=1");
  const adminChat = process.env.ADMIN_TELEGRAM_CHAT_ID;
  if (adminChat) {
    const it = r.item;
    sendTelegram(adminChat, `📩 <b>Saytdan murojaat</b>\n👤 ${esc(it.name)} ${esc(it.email)} ${esc(it.phone)}\n\n${esc(it.message.slice(0, 1500))}`).catch(() => {});
  }
  res.redirect("/contact?sent=1");
});

site.get("/contact", (req, res) => {
  const lang = req.lang;
  const tr = t(lang);
  const c = tr.contactPage;
  const cfg = siteSettings();
  const body = `
  <section class="hero" style="padding:56px 0 40px"><div class="wrap" style="text-align:center;max-width:720px;margin:0 auto">
    <span class="eyebrow">💬 ${esc(tr.nav.contact)}</span>
    <h1 style="font-size:clamp(30px,5vw,46px);margin:16px 0 14px">${esc(c.title)}</h1>
    <p class="lede" style="margin:0 auto">${esc(c.sub)}</p>
  </div></section>
  <section style="padding-top:20px"><div class="wrap"><div class="contact-grid">
    <div class="contact-card">
      ${req.query.sent ? `<div class="flash-ok" style="background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;padding:12px 14px;border-radius:12px;margin-bottom:14px;font-weight:600">${esc(c.sent)}</div>` : ""}
      ${req.query.err ? `<div style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:12px 14px;border-radius:12px;margin-bottom:14px;font-weight:600">${esc(c.sendErr)}</div>` : ""}
      <form method="post" action="/contact">
        <input type="hidden" name="lang" value="${esc(lang)}">
        <div style="position:absolute;left:-9999px" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div>
        <label>${esc(c.formName)}</label><input name="name" placeholder="${esc(c.formName)}" maxlength="80" required>
        <label>${esc(c.formEmail)}</label><input name="email" type="email" placeholder="you@email.com" maxlength="120">
        <label>${esc(c.formPhone)}</label><input name="phone" type="tel" placeholder="+998 __ ___ __ __" maxlength="32">
        <label>${esc(c.formMsg)}</label><textarea name="message" placeholder="..." required minlength="5" maxlength="3000"></textarea>
        <button class="btn primary" style="width:100%;margin-top:18px">${esc(c.formSend)}</button>
      </form>
    </div>
    <div class="contact-info">
      <p class="muted" style="margin:0 0 12px">${esc(c.or)}</p>
      ${cfg.telegram ? `<a href="https://t.me/${esc(cfg.telegram)}" target="_blank" rel="noopener"><span class="ci" style="background:none">${brandIcon("telegram", { size: 42 })}</span><div><b>${esc(c.telegram)}</b><br><span class="muted">@${esc(cfg.telegram)}</span></div></a>` : ""}
      ${cfg.email ? `<a href="mailto:${esc(cfg.email)}"><span class="ci">✉️</span><div><b>${esc(c.email)}</b><br><span class="muted">${esc(cfg.email)}</span></div></a>` : ""}
      ${cfg.phone ? `<a href="tel:${esc(cfg.phone.replace(/[^\d+]/g, ""))}"><span class="ci">📞</span><div><b>${esc(c.phone)}</b><br><span class="muted">${esc(cfg.phone)}</span></div></a>` : ""}
    </div>
  </div></div></section>`;
  res.send(siteLayout(lang, "/contact", tr.nav.contact, body, { user: req.user, active: "contact" }));
});
