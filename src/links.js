/**
 * Havola bosilishini kuzatish (ChatPlace "отслеживание кликов по ссылкам").
 *
 * Flow, qoida va ommaviy xabardagi havola tugmalari /l/<tenantId>/<linkId>
 * qisqa havolasiga almashtiriladi. Mijoz bosganda:
 *   - bosishlar soni va vaqti yoziladi (flow statistikasida tugma bo'yicha)
 *   - kontakt kartasiga {last_click} yoziladi, integratsiyaga "link_click" hodisasi
 *   - tugmaga "bosilgandan keyin" blok ulangan bo'lsa — flow shu blokdan davom etadi
 *   - mijoz asl manzilga yo'naltiriladi
 * Havola-preview botlari (Meta, Telegram, WhatsApp) bosish deb hisoblanmaydi.
 *
 * tenant.trackedLinks = { [linkId]: { u, k, f, n, b, t, nx, at, clicks, firstAt, lastAt } }
 */
import crypto from "node:crypto";
import { config } from "./config.js";
import { persist, findUserById } from "./db.js";

const MAX_LINKS = 20000;
const BOT_UA = /bot|crawl|spider|preview|facebookexternalhit|facebookcatalog|meta-externalagent|whatsapp|telegram|slack|discord|skype|embedly|vkshare|twitter|linkedin|pinterest|curl|wget|python|axios|node-fetch|headless/i;

const linksOf = (tenant) => (tenant.trackedLinks && typeof tenant.trackedLinks === "object" ? tenant.trackedLinks : (tenant.trackedLinks = {}));

/**
 * Kuzatiladigan havola yaratadi. BASE_URL sozlanmagan bo'lsa asl havola qaytadi
 * (mijoz bosadigan ochiq manzil bo'lmasa kuzatib bo'lmaydi).
 */
export function trackedUrl(tenant, url, { key = "", flowId = "", nodeId = "", buttonId = "", title = "", next = "", source = "flow" } = {}) {
  const base = config.baseUrl;
  if (!base || !/^https?:\/\//i.test(String(url || "")) || !tenant?.id) return url;
  const links = linksOf(tenant);
  // Bitta mijoz + bitta tugma uchun bitta havola (qayta yuborilsa o'sha havola)
  const sig = `${key}|${flowId}|${nodeId}|${buttonId}|${url}`;
  const existing = Object.entries(links).find(([, l]) => l.sig === sig);
  if (existing) return `${base}/l/${tenant.id}/${existing[0]}`;
  const id = crypto.randomBytes(6).toString("base64url");
  links[id] = { sig, u: String(url), k: key, f: flowId, n: nodeId, b: buttonId, t: String(title).slice(0, 40), nx: next || "", s: source, at: Date.now(), clicks: 0 };
  const ids = Object.keys(links);
  if (ids.length > MAX_LINKS) {
    ids.sort((a, b) => links[a].at - links[b].at).slice(0, ids.length - MAX_LINKS).forEach((x) => delete links[x]);
  }
  return `${base}/l/${tenant.id}/${id}`;
}

export const isPreviewBot = (ua) => !ua || BOT_UA.test(String(ua));

/**
 * Bosishni qayd qiladi. Qaytaradi: yo'naltiriladigan URL yoki null (havola topilmadi).
 * run — flow davom ettiruvchi funksiya (testlarda almashtiriladi).
 */
export async function recordClick(tenant, linkId, { userAgent = "", now = Date.now() } = {}) {
  const link = linksOf(tenant)[linkId];
  if (!link) return null;
  if (isPreviewBot(userAgent)) return link.u;
  const first = !link.clicks;
  link.clicks = (link.clicks || 0) + 1;
  link.firstAt ||= now;
  link.lastAt = now;

  if (link.f) {
    const { findFlow } = await import("./flows.js");
    const flow = findFlow(tenant, link.f);
    if (flow) {
      flow.stats ||= {};
      flow.stats.clicks ||= {};
      const k = link.b || link.n || "link";
      flow.stats.clicks[k] = (flow.stats.clicks[k] || 0) + 1;
      if (first) flow.stats.uniqueClicks = (flow.stats.uniqueClicks || 0) + 1;
    }
  }
  if (link.k) {
    const { setFields } = await import("./contacts.js");
    setFields(tenant, link.k, { last_click: link.t || link.u, last_click_at: new Date(now).toISOString() });
    const { fireEvent } = await import("./integrations.js");
    fireEvent(tenant, "link_click", { contact: link.k, url: link.u, button: link.t, source: link.s });
  }
  persist(tenant);

  // "Bosilgandan keyin" bloki — faqat birinchi bosishda (qayta bosganda xabarlar takrorlanmasin)
  if (first && link.nx && link.f && link.k) {
    const { findFlow, runFrom } = await import("./flows.js");
    const flow = findFlow(tenant, link.f);
    if (flow?.enabled && flow.nodes?.[link.nx]) {
      runFrom(tenant, link.k, flow, link.nx, {}).catch((err) => console.error("[Havola] flow davomi:", err.message));
    }
  }
  return link.u;
}

/** Express handler: GET /l/:tenantId/:linkId */
export async function linkRedirectHandler(req, res) {
  const tenant = await findUserById(String(req.params.tenantId || "")).catch(() => null);
  const url = tenant ? await recordClick(tenant, String(req.params.linkId || ""), { userAgent: req.get("user-agent") || "" }) : null;
  if (!url) return res.status(404).type("text/plain").send("Havola topilmadi yoki muddati tugagan");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.redirect(302, url);
}

/** Flow/xabar bo'yicha bosishlar statistikasi (panel uchun). */
export function clickStats(tenant, { flowId = "" } = {}) {
  const out = { links: 0, clicks: 0, unique: 0 };
  for (const l of Object.values(linksOf(tenant))) {
    if (flowId && l.f !== flowId) continue;
    out.links++;
    out.clicks += l.clicks || 0;
    if (l.clicks) out.unique++;
  }
  return out;
}
