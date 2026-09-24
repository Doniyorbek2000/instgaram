/**
 * Ketma-ketliklar (ManyChat "Sequences" / drip) — obuna bo'lgan mijozga kunlar
 * bo'yicha rejalashtirilgan xabarlar seriyasi: "1-kun: xush kelibsiz", "3-kun:
 * foydali maslahat", "7-kun: chegirma"...
 *
 * Qoidalar (halol ishlash):
 *  - Telegram'da har bir qadam o'z vaqtida yuboriladi.
 *  - Instagram / Messenger / WhatsApp faqat mijoz oxirgi 24 soatda yozgan bo'lsa
 *    erkin xabar qabul qiladi — oyna yopiq bo'lsa qadam "o'tkazib yuborildi" deb
 *    belgilanadi (Meta qoidasini buzmaymiz), keyingi qadam rejalashtiriladi.
 *  - STOP yozgan (optOut) mijozga yuborilmaydi va obunadan chiqariladi.
 *
 * tenant.sequences = {
 *   list: [{ id, name, enabled, steps: [{ id, delayMin, text, buttons: [{title,url}], flowId }], stats }],
 *   subs: { [chatKey]: { [seqId]: { step, nextAt, startedAt } } }
 * }
 */
import crypto from "node:crypto";
import { listUsers, persist } from "./db.js";
import { sendReply, splitKey } from "./outbound.js";
import { renderTemplate } from "./templating.js";
import { windowStatus } from "./contacts.js";
import { trackedUrl } from "./links.js";
import { botEnabled } from "./credits.js";

export const MAX_STEPS = 20;
const MAX_DELAY_MIN = 90 * 24 * 60; // 90 kun
const STALE_MS = 12 * 60 * 60 * 1000; // server uzoq to'xtagan bo'lsa juda eski qadamni yubormaymiz

export function ensureSequences(tenant) {
  const s = (tenant.sequences && typeof tenant.sequences === "object" ? tenant.sequences : (tenant.sequences = {}));
  if (!Array.isArray(s.list)) s.list = [];
  if (!s.subs || typeof s.subs !== "object") s.subs = {};
  return s;
}

export const findSequence = (tenant, id) => ensureSequences(tenant).list.find((q) => q.id === id) || null;

const newId = (p) => `${p}_${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`;

/** Formadan/MCP'dan kelgan ketma-ketlikni tozalaydi. */
export function sanitizeSequence(input = {}, existing = {}) {
  const steps = (Array.isArray(input.steps) ? input.steps : [])
    .slice(0, MAX_STEPS)
    .map((st) => ({
      id: /^[\w-]{1,40}$/.test(st?.id || "") ? st.id : newId("st"),
      delayMin: Math.min(MAX_DELAY_MIN, Math.max(1, Math.round(Number(st?.delayMin) || 0) || 1440)),
      text: String(st?.text || "").slice(0, 2000),
      buttons: (Array.isArray(st?.buttons) ? st.buttons : [])
        .filter((b) => b && b.title && /^https?:\/\/\S+$/i.test(String(b.url || "")))
        .slice(0, 3)
        .map((b) => ({ title: String(b.title).slice(0, 20), url: String(b.url).slice(0, 1000) })),
      flowId: String(st?.flowId || "").slice(0, 60),
    }))
    .filter((st) => st.text.trim() || st.flowId);
  return {
    id: existing.id || newId("seq"),
    name: String(input.name || existing.name || "Yangi ketma-ketlik").trim().slice(0, 120) || "Yangi ketma-ketlik",
    enabled: input.enabled === undefined ? existing.enabled ?? true : Boolean(input.enabled),
    steps,
    stats: existing.stats || { subscribed: 0, sent: 0, skipped: 0, finished: 0, steps: {} },
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Mijozni ketma-ketlikka obuna qiladi (qayta obuna — boshidan). */
export function subscribe(tenant, key, seqId, now = Date.now()) {
  const seq = findSequence(tenant, seqId);
  if (!seq || !seq.steps.length || !key) return false;
  if (tenant.contactMeta?.[key]?.optOut) return false;
  const s = ensureSequences(tenant);
  const mine = (s.subs[key] ||= {});
  mine[seqId] = { step: 0, nextAt: now + seq.steps[0].delayMin * 60000, startedAt: now };
  seq.stats.subscribed = (seq.stats.subscribed || 0) + 1;
  persist(tenant);
  return true;
}

export function unsubscribe(tenant, key, seqId) {
  const s = ensureSequences(tenant);
  if (!s.subs[key]?.[seqId]) return false;
  delete s.subs[key][seqId];
  if (!Object.keys(s.subs[key]).length) delete s.subs[key];
  persist(tenant);
  return true;
}

export function unsubscribeAll(tenant, key) {
  const s = ensureSequences(tenant);
  if (!s.subs[key]) return 0;
  const n = Object.keys(s.subs[key]).length;
  delete s.subs[key];
  persist(tenant);
  return n;
}

/** Mijozning faol ketma-ketliklari (CRM kartochkasi uchun). */
export function subscriptionsOf(tenant, key) {
  const mine = ensureSequences(tenant).subs[key] || {};
  return Object.entries(mine).map(([seqId, st]) => ({ seq: findSequence(tenant, seqId), ...st })).filter((x) => x.seq);
}

export function activeCount(tenant, seqId) {
  return Object.values(ensureSequences(tenant).subs).filter((m) => m[seqId]).length;
}

/**
 * Bitta biznesning muddati kelgan qadamlarini bajaradi.
 * send(tenant, chan, id, text, options) — testlarda almashtiriladi.
 */
export async function runTenantSequences(tenant, now = Date.now(), { send = sendReply } = {}) {
  const s = ensureSequences(tenant);
  let sent = 0;
  let changed = false;
  for (const [key, mine] of Object.entries(s.subs)) {
    for (const [seqId, st] of Object.entries(mine)) {
      if (st.nextAt > now) continue;
      changed = true;
      const seq = findSequence(tenant, seqId);
      if (!seq || tenant.contactMeta?.[key]?.optOut) {
        delete mine[seqId];
        continue;
      }
      if (!seq.enabled) {
        st.nextAt = now + 60 * 60000; // o'chiq — soatda bir tekshiramiz, navbat yo'qolmaydi
        continue;
      }
      const step = seq.steps[st.step];
      if (!step) {
        delete mine[seqId];
        continue;
      }
      const stepStats = ((seq.stats.steps ||= {})[step.id] ||= { sent: 0, skipped: 0 });
      const stale = now - st.nextAt > STALE_MS;
      const win = windowStatus(tenant, key, now);
      if (stale || !win.open || !botEnabled(tenant)) {
        stepStats.skipped++;
        seq.stats.skipped = (seq.stats.skipped || 0) + 1;
      } else {
        const { chan, id } = splitKey(key);
        let ok = false;
        try {
          if (step.flowId) {
            const { findFlow, startFlow } = await import("./flows.js");
            const flow = findFlow(tenant, step.flowId);
            if (flow?.start) {
              const ctx = send === sendReply ? {} : { send: async (m) => send(tenant, chan, id, m.text, m.options) };
              ok = (await startFlow(tenant, key, flow, ctx)).status !== "empty";
            }
          } else {
            const buttons = step.buttons.map((b) => ({ title: b.title, url: trackedUrl(tenant, b.url, { key, title: b.title, source: `sequence:${seq.id}` }) }));
            ok = Boolean(await send(tenant, chan, id, renderTemplate(step.text, tenant, key), buttons));
          }
        } catch (err) {
          console.error(`[Ketma-ketlik] ${key}:`, err.message);
        }
        if (ok) {
          sent++;
          stepStats.sent++;
          seq.stats.sent = (seq.stats.sent || 0) + 1;
        } else {
          stepStats.skipped++;
          seq.stats.skipped = (seq.stats.skipped || 0) + 1;
        }
      }
      const next = seq.steps[st.step + 1];
      if (next) {
        st.step += 1;
        st.nextAt = now + next.delayMin * 60000;
      } else {
        seq.stats.finished = (seq.stats.finished || 0) + 1;
        delete mine[seqId];
      }
    }
    if (!Object.keys(mine).length) delete s.subs[key];
  }
  if (changed) await persist(tenant);
  return sent;
}

let running = false;

/** index.js da har daqiqada. */
export async function runDueSequences(now = Date.now()) {
  if (running) return 0;
  running = true;
  let total = 0;
  try {
    for (const tenant of await listUsers()) {
      const subs = tenant.sequences?.subs;
      if (!subs || !Object.values(subs).some((m) => Object.values(m).some((x) => x.nextAt <= now))) continue;
      total += await runTenantSequences(tenant, now);
    }
  } finally {
    running = false;
  }
  if (total) console.log(`[Ketma-ketlik] ${total} ta xabar yuborildi`);
  return total;
}
