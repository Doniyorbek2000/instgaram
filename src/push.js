/**
 * Operatorlar uchun Web Push (PWA): panelni telefonga "ilova" qilib o'rnatib,
 * operator chaqirilganda, yangi lid yoki buyurtma tushganda bildirishnoma olish.
 *
 * VAPID kalitlari: .env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) yoki birinchi
 * ishga tushishda yaratilib platforma sozlamalarida saqlanadi.
 * tenant.pushSubs = [{ endpoint, keys, by, ua, at }]
 */
import webpush from "web-push";
import { config } from "./config.js";
import { getPlatformSettings, setPlatformSettings, persist } from "./db.js";

const MAX_SUBS = 30;
let vapid = null;

export async function vapidKeys() {
  if (vapid) return vapid;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    const s = (await getPlatformSettings()) || {};
    if (s.vapidPublicKey && s.vapidPrivateKey) vapid = { publicKey: s.vapidPublicKey, privateKey: s.vapidPrivateKey };
    else {
      vapid = webpush.generateVAPIDKeys();
      await setPlatformSettings({ vapidPublicKey: vapid.publicKey, vapidPrivateKey: vapid.privateKey });
    }
  }
  const contact = config.adminEmails?.[0] ? `mailto:${config.adminEmails[0]}` : "mailto:info@obunext.uz";
  webpush.setVapidDetails(contact, vapid.publicKey, vapid.privateKey);
  return vapid;
}

export function addSubscription(tenant, sub, { by = "", ua = "" } = {}) {
  if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return false;
  tenant.pushSubs = (Array.isArray(tenant.pushSubs) ? tenant.pushSubs : []).filter((s) => s.endpoint !== sub.endpoint);
  tenant.pushSubs.unshift({ endpoint: sub.endpoint.slice(0, 1000), keys: { p256dh: String(sub.keys.p256dh).slice(0, 200), auth: String(sub.keys.auth).slice(0, 100) }, by: String(by).slice(0, 120), ua: String(ua).slice(0, 160), at: new Date().toISOString() });
  tenant.pushSubs = tenant.pushSubs.slice(0, MAX_SUBS);
  persist(tenant);
  return true;
}

export function removeSubscription(tenant, endpoint) {
  const before = (tenant.pushSubs || []).length;
  tenant.pushSubs = (tenant.pushSubs || []).filter((s) => s.endpoint !== endpoint);
  if (tenant.pushSubs.length !== before) persist(tenant);
}

/** Biznesning barcha qurilmalariga bildirishnoma. Yaroqsiz obunalar o'chiriladi. */
export async function pushToTenant(tenant, { title, body = "", url = "/inbox", tag = "" }, { send } = {}) {
  const subs = Array.isArray(tenant.pushSubs) ? tenant.pushSubs : [];
  if (!subs.length) return 0;
  await vapidKeys();
  const payload = JSON.stringify({ title: String(title).slice(0, 80), body: String(body).slice(0, 200), url, tag });
  const sendFn = send || ((s, p) => webpush.sendNotification(s, p, { TTL: 3600 }));
  let ok = 0;
  const dead = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await sendFn({ endpoint: s.endpoint, keys: s.keys }, payload);
      ok++;
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(s.endpoint);
      else console.error("[Push]", err?.statusCode || "", err?.message || err);
    }
  }));
  if (dead.length) {
    tenant.pushSubs = subs.filter((s) => !dead.includes(s.endpoint));
    persist(tenant);
  }
  return ok;
}

/** Xato bo'lsa ham asosiy jarayonni to'xtatmaydigan qulay chaqiruv. */
export function notifyPush(tenant, message) {
  pushToTenant(tenant, message).catch((err) => console.error("[Push]", err.message));
}

export const MANIFEST = {
  name: "Obunext — Live Inbox",
  short_name: "Obunext",
  description: "Instagram, Telegram, WhatsApp va Messenger suhbatlari va buyurtmalari",
  start_url: "/inbox",
  scope: "/",
  display: "standalone",
  background_color: "#0b0f19",
  theme_color: "#7c3aed",
  icons: [
    { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    { src: "/logo.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
  ],
};

export const SERVICE_WORKER = `/* Obunext service worker — push bildirishnomalar */
self.addEventListener("install", function (e) { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: "Obunext", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Obunext", {
    body: d.body || "", icon: "/apple-touch-icon.png", badge: "/favicon.png", tag: d.tag || undefined, renotify: Boolean(d.tag), data: { url: d.url || "/inbox" }
  }));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || "/inbox";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if ("focus" in list[i]) { list[i].navigate(url); return list[i].focus(); } }
    return self.clients.openWindow(url);
  }));
});
`;
