/**
 * QR, vidjet va havolalar (/growth-tools) + ochiq sahifalar:
 *   GET /g/:tenantId/:linkId   — referal havola (bosishni sanab, chatga yo'naltiradi)
 *   GET /w/:tenantId.js        — sayt vidjeti skripti
 *   GET /p/:slug               — havolalar sahifasi (link in bio)
 */
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { persist, findUserById, listUsers } from "../db.js";
import { config } from "../config.js";
import { ensureTools, saveContacts, channelUrl, createLink, qrSvg, qrPng, widgetScript, slugify, CHANNEL_LABELS } from "../growthTools.js";
import { brandIcon } from "./icons.js";
import { logoMark } from "./brand.js";

export const growthToolsRouter = Router();

const base = (req) => config.baseUrl || `${req.protocol}://${req.get("host")}`;
const trackUrl = (req, tenant, link) => `${base(req)}/g/${tenant.id}/${link.id}`;
const BRAND = { ig: "instagram", tg: "telegram", wa: "whatsapp", fb: "facebook" };

growthToolsRouter.get("/growth-tools", requireAuth, async (req, res) => {
  const u = req.user;
  const t = ensureTools(u);
  const c = t.contacts;
  const w = t.widget;
  const pg = t.page;
  const qrs = await Promise.all(t.links.map((l) => qrSvg(trackUrl(req, u, l)).catch(() => "")));
  const embed = `<script src="${base(req)}/w/${u.id}.js" async></script>`;
  const flash = req.query.saved ? `<div class="ok">Saqlandi ✅</div>` : req.query.error ? `<div class="error">${esc(req.query.error)}</div>` : "";

  res.send(page("QR, vidjet va havolalar", `${flash}
    <style>
      .gt-qr svg { width:132px; height:132px; display:block; border-radius:10px }
      .gt-link { display:flex; gap:14px; align-items:center; flex-wrap:wrap }
      .gt-copy { display:flex; gap:6px } .gt-copy input { margin:0; font-family:monospace; font-size:12px }
    </style>
    <div class="card">
      <h3 style="margin-top:0">📇 Kanallaringiz</h3>
      <form method="post" action="/growth-tools/contacts" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:10px; margin:0">
        <div><label>${brandIcon("instagram", { size: 14 })} Instagram username</label><input name="ig" value="${esc(c.ig)}" placeholder="guli_shop"></div>
        <div><label>${brandIcon("telegram", { size: 14 })} Telegram bot</label><input name="tg" value="${esc(c.tg)}" placeholder="guli_bot"></div>
        <div><label>${brandIcon("whatsapp", { size: 14 })} WhatsApp raqami</label><input name="wa" value="${esc(c.wa)}" placeholder="998901234567"></div>
        <div><label>${brandIcon("facebook", { size: 14 })} Facebook sahifa</label><input name="fb" value="${esc(c.fb)}" placeholder="gulishop"></div>
        <div style="align-self:end"><button class="btn" style="width:100%; margin:0">💾 Saqlash</button></div>
      </form>
    </div>

    <div class="card">
      <h3 style="margin-top:0">🔗 Referal havolalar va QR kodlar</h3>
      <p class="hint" style="margin-top:0">Havola yoki QR kodni reklama, flayer, qadoq, stories'ga qo'ying. Mijoz bosganda chat ochiladi va flow'dagi <b>"🔗 Referal havola"</b> triggeri shu kod bilan ishga tushadi. Bosishlar sanaladi.</p>
      <form method="post" action="/growth-tools/links" style="display:flex; gap:8px; flex-wrap:wrap; align-items:end; margin:0 0 14px">
        <div style="flex:2; min-width:160px"><label>Nomi</label><input name="name" placeholder="Flayer — do'kon kassasi" required style="margin:0"></div>
        <div style="flex:1; min-width:120px"><label>Kanal</label><select name="channel" style="margin:0">${Object.entries(CHANNEL_LABELS).map(([k, l]) => `<option value="${k}">${l}${channelUrl(u, k) ? "" : " (kontakt yo'q)"}</option>`).join("")}</select></div>
        <div style="flex:1; min-width:120px"><label>Kod</label><input name="code" placeholder="flayer1" style="margin:0" maxlength="40"></div>
        <button class="btn" style="margin:0">+ Yaratish</button>
      </form>
      ${t.links.length ? t.links.map((l, i) => {
        const direct = channelUrl(u, l.channel, l.code);
        return `<div class="card gt-link" style="background:rgba(255,255,255,0.02)">
          <div class="gt-qr">${qrs[i]}</div>
          <div style="flex:1; min-width:220px">
            <b>${esc(l.name)}</b> <span class="status-tag" style="font-size:11px">${brandIcon(BRAND[l.channel], { size: 12 })} ${esc(CHANNEL_LABELS[l.channel])}</span>
            <div class="hint" style="font-size:12.5px; margin:4px 0">Kod: <code>${esc(l.code)}</code> · Bosishlar: <b>${l.clicks || 0}</b>${direct ? "" : ` · <span style="color:#f87171">${esc(CHANNEL_LABELS[l.channel])} kontakti kiritilmagan</span>`}</div>
            <div class="gt-copy"><input readonly value="${esc(trackUrl(req, u, l))}" onclick="this.select()"><button type="button" class="secondary" style="margin:0" onclick="navigator.clipboard.writeText(this.previousElementSibling.value); this.textContent='✓'">📋</button></div>
            <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap">
              <a class="btn secondary" href="/growth-tools/links/${esc(l.id)}/qr.png" download="qr-${esc(l.code)}.png" style="margin:0; padding:5px 10px; font-size:12px">⬇️ QR (PNG)</a>
              <a class="btn secondary" href="/growth-tools/links/${esc(l.id)}/qr.svg" download="qr-${esc(l.code)}.svg" style="margin:0; padding:5px 10px; font-size:12px">⬇️ QR (SVG, chop etish)</a>
              <form method="post" action="/growth-tools/links/${esc(l.id)}/delete" style="margin:0"><button class="secondary" style="margin:0; padding:5px 10px; font-size:12px; color:#f87171">🗑️</button></form>
            </div>
          </div>
        </div>`;
      }).join("") : `<p class="hint">Hali havola yo'q</p>`}
    </div>

    <form method="post" action="/growth-tools/widget" class="card">
      <h3 style="margin-top:0">💬 Sayt uchun chat vidjeti</h3>
      <p class="hint" style="margin-top:0">Saytingiz burchagida suzuvchi tugma: bosganda Instagram, Telegram, WhatsApp yoki Messenger'da chat ochiladi.</p>
      <label style="display:flex; gap:8px; align-items:center; text-transform:none; letter-spacing:0; font-size:14px"><input type="checkbox" name="enabled" ${w.enabled ? "checked" : ""} style="width:auto; margin:0"> Vidjet yoqilgan</label>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px">
        <div><label>Rang</label><input type="color" name="color" value="${esc(w.color)}" style="height:40px; padding:2px"></div>
        <div><label>Joylashuv</label><select name="position"><option value="right" ${w.position !== "left" ? "selected" : ""}>O'ng pastda</option><option value="left" ${w.position === "left" ? "selected" : ""}>Chap pastda</option></select></div>
        <div><label>Referal kodi (ixtiyoriy)</label><input name="ref" value="${esc(w.ref)}" placeholder="sayt"></div>
      </div>
      <label>Salomlashuv matni</label><input name="greeting" value="${esc(w.greeting)}" maxlength="120">
      <div style="display:flex; gap:14px; flex-wrap:wrap; margin-top:8px">${Object.entries(CHANNEL_LABELS).map(([k, l]) => `<label style="display:flex; gap:6px; align-items:center; margin:0; text-transform:none; letter-spacing:0; font-size:13.5px"><input type="checkbox" name="ch_${k}" ${w.channels[k] ? "checked" : ""} style="width:auto; margin:0"> ${l}</label>`).join("")}</div>
      <label style="margin-top:12px">Saytga joylash kodi (&lt;/body&gt; oldidan)</label>
      <div class="gt-copy"><input readonly value="${esc(embed)}" onclick="this.select()"><button type="button" class="secondary" style="margin:0" onclick="navigator.clipboard.writeText(this.previousElementSibling.value); this.textContent='✓'">📋</button></div>
      <button class="btn" style="margin-top:12px">💾 Saqlash</button>
    </form>

    <form method="post" action="/growth-tools/page" class="card">
      <h3 style="margin-top:0">📱 Havolalar sahifasi (link in bio)</h3>
      <p class="hint" style="margin-top:0">Instagram bio uchun bitta havola: barcha chat kanallaringiz va sayt/katalog tugmalari.</p>
      <label style="display:flex; gap:8px; align-items:center; text-transform:none; letter-spacing:0; font-size:14px"><input type="checkbox" name="enabled" ${pg.enabled ? "checked" : ""} style="width:auto; margin:0"> Sahifa yoqilgan</label>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:10px">
        <div><label>Manzil</label><input name="slug" value="${esc(pg.slug)}" placeholder="guli-shop" maxlength="40"></div>
        <div><label>Sarlavha</label><input name="title" value="${esc(pg.title)}" maxlength="80"></div>
      </div>
      <label>Qisqa tavsif</label><textarea name="bio" rows="2" maxlength="300">${esc(pg.bio)}</textarea>
      <label>Qo'shimcha tugmalar (har qatorda: Nomi | https://...)</label>
      <textarea name="buttons" rows="3" placeholder="Katalog | https://guli.uz/katalog&#10;Manzil | https://yandex.uz/maps/...">${esc((pg.buttons || []).map((b) => `${b.title} | ${b.url}`).join("\n"))}</textarea>
      ${pg.enabled && pg.slug ? `<p style="margin:8px 0 0">🔗 <a href="${esc(base(req))}/p/${esc(pg.slug)}" target="_blank" rel="noopener">${esc(base(req))}/p/${esc(pg.slug)}</a></p>` : ""}
      <button class="btn" style="margin-top:12px">💾 Saqlash</button>
    </form>`, { user: u, active: "growth-tools" }));
});

growthToolsRouter.post("/growth-tools/contacts", requireAuth, (req, res) => {
  saveContacts(req.user, req.body || {});
  res.redirect("/growth-tools?saved=1");
});

growthToolsRouter.post("/growth-tools/links", requireAuth, (req, res) => {
  createLink(req.user, req.body || {});
  res.redirect("/growth-tools?saved=1");
});

growthToolsRouter.post("/growth-tools/links/:id/delete", requireAuth, (req, res) => {
  const t = ensureTools(req.user);
  t.links = t.links.filter((l) => l.id !== req.params.id);
  persist(req.user);
  res.redirect("/growth-tools");
});

growthToolsRouter.get("/growth-tools/links/:id/qr.:fmt", requireAuth, async (req, res) => {
  const l = ensureTools(req.user).links.find((x) => x.id === req.params.id);
  if (!l) return res.status(404).end();
  const url = trackUrl(req, req.user, l);
  if (req.params.fmt === "png") return res.type("image/png").send(await qrPng(url));
  res.type("image/svg+xml").send(await qrSvg(url));
});

growthToolsRouter.post("/growth-tools/widget", requireAuth, (req, res) => {
  const w = ensureTools(req.user).widget;
  const b = req.body || {};
  w.enabled = b.enabled === "on";
  w.color = /^#[0-9a-f]{6}$/i.test(String(b.color || "")) ? b.color : "#7c3aed";
  w.position = b.position === "left" ? "left" : "right";
  w.greeting = String(b.greeting || "").trim().slice(0, 120);
  w.ref = String(b.ref || "").trim().replace(/[^\w-]/g, "").slice(0, 40);
  w.channels = Object.fromEntries(Object.keys(CHANNEL_LABELS).map((k) => [k, b[`ch_${k}`] === "on"]));
  persist(req.user);
  res.redirect("/growth-tools?saved=1");
});

growthToolsRouter.post("/growth-tools/page", requireAuth, async (req, res) => {
  const pg = ensureTools(req.user).page;
  const b = req.body || {};
  const slug = slugify(b.slug);
  if (b.enabled === "on" && !slug) return res.redirect(`/growth-tools?error=${encodeURIComponent("Sahifa manzilini kiriting (lotin harflari)")}`);
  if (slug) {
    const taken = (await listUsers()).some((x) => x.id !== req.user.id && x.growth?.tools?.page?.slug === slug);
    if (taken) return res.redirect(`/growth-tools?error=${encodeURIComponent("Bu manzil band — boshqasini tanlang")}`);
  }
  pg.enabled = b.enabled === "on";
  pg.slug = slug;
  pg.title = String(b.title || "").trim().slice(0, 80);
  pg.bio = String(b.bio || "").trim().slice(0, 300);
  pg.buttons = String(b.buttons || "").split("\n").map((line) => {
    const i = line.lastIndexOf("|");
    const title = i > 0 ? line.slice(0, i).trim().slice(0, 40) : "";
    const url = i > 0 ? line.slice(i + 1).trim() : "";
    return title && /^https?:\/\/\S+$/i.test(url) ? { title, url } : null;
  }).filter(Boolean).slice(0, 10);
  persist(req.user);
  res.redirect("/growth-tools?saved=1");
});

// ---------- ochiq sahifalar ----------

growthToolsRouter.get("/g/:tenantId/:linkId", async (req, res) => {
  const tenant = await findUserById(String(req.params.tenantId)).catch(() => null);
  const l = tenant ? ensureTools(tenant).links.find((x) => x.id === req.params.linkId) : null;
  const url = l ? channelUrl(tenant, l.channel, l.code) : "";
  if (!url) return res.status(404).type("text/plain").send("Havola topilmadi");
  if (!/bot|crawl|preview|facebookexternalhit|telegram|whatsapp/i.test(req.get("user-agent") || "")) {
    l.clicks = (l.clicks || 0) + 1;
    persist(tenant);
  }
  res.setHeader("Cache-Control", "no-store");
  res.redirect(302, url);
});

growthToolsRouter.get("/w/:file", async (req, res) => {
  const m = String(req.params.file).match(/^([\w-]{1,64})\.js$/);
  const tenant = m ? await findUserById(m[1]).catch(() => null) : null;
  res.type("application/javascript");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (!tenant || !ensureTools(tenant).widget.enabled) return res.send("/* Obunext vidjeti o'chiq */");
  res.send(widgetScript(tenant));
});

growthToolsRouter.get("/p/:slug", async (req, res) => {
  const slug = slugify(req.params.slug);
  const tenant = slug ? (await listUsers()).find((x) => x.growth?.tools?.page?.enabled && x.growth.tools.page.slug === slug) : null;
  if (!tenant) return res.status(404).type("text/plain").send("Sahifa topilmadi");
  const t = ensureTools(tenant);
  const pg = t.page;
  const chans = Object.keys(CHANNEL_LABELS).map((c) => [c, channelUrl(tenant, c, "bio")]).filter(([, u]) => u);
  const color = { ig: "linear-gradient(120deg,#f58529,#dd2a7b,#8134af)", tg: "#229ED9", wa: "#25D366", fb: "#0084FF" };
  res.send(`<!DOCTYPE html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pg.title || tenant.businessName || "Havolalar")}</title><meta name="description" content="${esc(pg.bio)}">
<meta property="og:title" content="${esc(pg.title || tenant.businessName || "")}"><meta property="og:description" content="${esc(pg.bio)}">
<link rel="icon" href="/favicon.png" type="image/png">
<style>
  :root{--bg:#faf9fe;--ink:#0f1222;--muted:#6b7280;--card:#fff;--line:#ececf3}
  @media (prefers-color-scheme: dark){:root{--bg:#0b0b16;--ink:#f1f5f9;--muted:#94a3b8;--card:#14131f;--line:#24222f}}
  *{box-sizing:border-box} body{margin:0;min-height:100vh;background:radial-gradient(600px 300px at 50% -80px,rgba(124,58,237,.25),transparent 70%),var(--bg);color:var(--ink);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;justify-content:center;padding:48px 16px}
  main{width:100%;max-width:440px;text-align:center}
  .av{width:84px;height:84px;margin:0 auto 14px;border-radius:24px;background:linear-gradient(120deg,#7c3aed,#db2777,#f97316);display:grid;place-items:center;color:#fff;font-size:34px;font-weight:800;box-shadow:0 14px 30px -12px rgba(124,58,237,.6)}
  h1{font-size:22px;margin:0 0 6px} p{color:var(--muted);margin:0 0 22px;font-size:15px;line-height:1.5}
  a.b{display:flex;align-items:center;justify-content:center;gap:10px;padding:15px 18px;margin:0 0 12px;border-radius:14px;color:#fff;text-decoration:none;font-weight:700;font-size:15.5px;box-shadow:0 8px 20px -10px rgba(0,0,0,.4);transition:transform .15s}
  a.b:hover{transform:translateY(-2px)} a.b.alt{background:var(--card);color:var(--ink);border:1px solid var(--line)}
  footer{margin-top:28px;font-size:12px;color:var(--muted);display:flex;justify-content:center;gap:6px;align-items:center} footer a{color:inherit}
</style></head><body><main>
  <div class="av">${esc((pg.title || tenant.businessName || "O").trim().charAt(0).toUpperCase())}</div>
  <h1>${esc(pg.title || tenant.businessName || "")}</h1>
  ${pg.bio ? `<p>${esc(pg.bio)}</p>` : ""}
  ${chans.map(([c, u]) => `<a class="b" href="${esc(u)}" target="_blank" rel="noopener" style="background:${color[c]}">${brandIcon(BRAND[c], { size: 20 })} ${esc(CHANNEL_LABELS[c])}'da yozish</a>`).join("")}
  ${(pg.buttons || []).map((b) => `<a class="b alt" href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.title)}</a>`).join("")}
  <footer>${logoMark(16)} <a href="https://obunext.uz" target="_blank" rel="noopener">Obunext</a> bilan yaratilgan</footer>
</main></body></html>`);
});
