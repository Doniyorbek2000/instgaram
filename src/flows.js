/**
 * Flow dvigateli — ChatPlace "Automation Builder" ning to'liq ekvivalenti.
 *
 * Flow = triggerlar + bloklar grafi. Bloklar:
 *   message   — matn (+ havola va "keyingi qadam" tugmalari)
 *   input     — savol berib, javobni o'zgaruvchiga (kontakt kartasiga) saqlash
 *   condition — shartlar (teg, hafta kuni, vaqt, sana, ball, o'zgaruvchi, obuna, kanal) → Ha / Yo'q
 *   action    — amallar (teg qo'shish/olib tashlash, o'zgaruvchi, ball, konversiya,
 *               operatorga o'tkazish, Telegram bildirishnoma, webhook/CRM)
 *   delay     — N daqiqa kutish (navbat orqali, server qayta ishga tushsa ham saqlanadi)
 *   ai        — AI javobi (biznes bilim bazasi asosida)
 *   redirect  — boshqa flow'ga o'tish
 *   split     — A/B test: mijozlar variantlarga ulush bo'yicha tasodifiy taqsimlanadi
 *   http      — tashqi API'ga so'rov, javobdan o'zgaruvchilarga yozish (Muvaffaqiyat / Xato)
 *
 * Triggerlar: DM kalit so'z, komment, jonli efir kommenti, story javobi,
 * story mention, yangi kontakt, referal havola (ig.me/m/<user>?ref=...).
 * Moslik: contains / exact / regex / any / ai (ma'no bo'yicha).
 *
 * tenant.flows = { list: [Flow], sessions: { [chatKey]: Session } }
 */
import crypto from "node:crypto";
import { persist } from "./db.js";
import { sendReply, sendMedia, splitKey, optionsAsText } from "./outbound.js";
import { sanitizeMedia, absoluteMediaUrl } from "./mediaStore.js";
import { renderTemplate, zonedParts } from "./templating.js";
import { addTags, removeTag, setFields, getContactMeta } from "./contacts.js";
import { matchesRule, normalizeText } from "./rules.js";
import { validateAnswer } from "./forms.js";
import { scheduleFollowUp } from "./followups.js";
import { fireEvent } from "./integrations.js";
import { startHandoff } from "./engagement.js";
import { sendTelegram } from "./notify.js";
import * as game from "./gamification.js";
import { isFlowAllowed } from "./credits.js";
import { trackedUrl } from "./links.js";
import { isSafeUrl } from "./integrations.js";

export const TRIGGER_TYPES = {
  keyword: "✉️ Direct'da kalit so'z",
  comment: "💬 Post/Reels kommenti",
  live_comment: "🔴 Jonli efir kommenti",
  story_reply: "🗨️ Story'ga javob",
  story_mention: "🌟 Story'da belgilash",
  new_contact: "👋 Yangi kontakt (birinchi xabar)",
  ref: "🔗 Referal havola (?ref=)",
  referral: "🤝 Do'sti qo'shildi (taklif qilgan odam uchun)",
};

export const MATCH_TYPES = {
  contains: "O'z ichiga oladi",
  exact: "Aniq moslik",
  any: "Har qanday matn",
  ai: "🧠 AI — ma'no bo'yicha",
  regex: "Regex",
};

export const NODE_TYPES = {
  message: "💬 Xabar",
  input: "📝 Ma'lumot yig'ish",
  condition: "🔀 Shart",
  action: "⚡ Amal",
  delay: "⏱️ Kutish",
  ai: "🧠 AI javob",
  redirect: "↪️ Boshqa flow",
  split: "🎲 A/B test",
  http: "🌐 HTTP so'rov",
  catalog: "🛍️ Katalog",
  note: "🗒️ Izoh",
};

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export const CONDITION_KINDS = {
  tag: "Teg",
  weekday: "Hafta kuni",
  time: "Vaqt oralig'i",
  date: "Sana oralig'i",
  points: "Ballar",
  var: "O'zgaruvchi",
  follows: "Obuna bo'lgan",
  tg_boost: "Telegram kanalga boost bergan",
  channel: "Kanal",
};

export const ACTION_KINDS = {
  add_tag: "Teg qo'shish",
  remove_tag: "Tegni olib tashlash",
  set_var: "O'zgaruvchi qiymati",
  add_points: "Ball qo'shish/ayirish",
  conversion: "Konversiyani qayd etish",
  handoff: "Operatorga o'tkazish",
  notify: "Telegram bildirishnoma",
  webhook: "Webhook / CRM ga yuborish",
  run_flow: "Boshqa flow'ni ishga tushirish",
  react: "❤️ Xabarga reaksiya",
  math: "🧮 Hisoblash (o'zgaruvchi)",
  crm_lead: "📇 CRM'da lid ochish (amoCRM / Bitrix24)",
  payment_link: "💳 Buyurtma va to'lov havolasi",
  send_sms: "📱 SMS yuborish (Eskiz)",
  send_email: "✉️ Email yuborish",
  seq_subscribe: "📅 Ketma-ketlikka qo'shish",
  seq_unsubscribe: "📅 Ketma-ketlikdan chiqarish",
  opt_out: "🚫 Ommaviy xabarlardan chiqarish",
};

export const INPUT_VALIDATIONS = { text: "Matn", name: "Ism", phone: "Telefon", email: "Email", number: "Raqam" };

const MAX_STEPS = 30;
const MAX_REDIRECT_DEPTH = 3;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const DAILY_KEEP_DAYS = 90;
const CANCEL_WORDS = new Set(["bekor", "stop", "cancel", "отмена", "/cancel", "/stop"]);
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export function newId(prefix = "n") {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
}

export function ensureFlows(tenant) {
  const f = (tenant.flows ||= {});
  if (!Array.isArray(f.list)) f.list = [];
  if (!f.sessions || typeof f.sessions !== "object") f.sessions = {};
  return f;
}

export function findFlow(tenant, flowId) {
  return ensureFlows(tenant).list.find((fl) => fl.id === flowId) || null;
}

// ============================================================
// Validatsiya (UI/AI'dan kelgan graf)
// ============================================================

const str = (v, max) => String(v ?? "").slice(0, max);
const num = (v, min, max, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

function sanitizeTrigger(t = {}) {
  const type = TRIGGER_TYPES[t.type] ? t.type : "keyword";
  const matchType = MATCH_TYPES[t.matchType] ? t.matchType : "contains";
  return {
    type,
    keyword: str(t.keyword, 500).trim(),
    matchType,
    aiIntent: str(t.aiIntent, 300).trim(),
    mediaId: mediaIdList(t.mediaId).join(","),
    publicReplies: (Array.isArray(t.publicReplies) ? t.publicReplies : String(t.publicReplies || "").split("\n"))
      .map((x) => str(x, 300).trim())
      .filter(Boolean)
      .slice(0, 15),
  };
}

function sanitizeNode(n, ids) {
  const ref = (v) => (typeof v === "string" && ids.has(v) ? v : null);
  const base = { id: n.id, type: n.type, x: num(n.x, -5000, 5000, 0), y: num(n.y, -5000, 5000, 0) };
  switch (n.type) {
    case "message":
      return {
        ...base,
        text: str(n.text, 2000),
        buttons: (Array.isArray(n.buttons) ? n.buttons : [])
          .slice(0, 10)
          .map((b) => ({
            id: ID_RE.test(b?.id || "") ? b.id : newId("b"),
            title: str(b?.title, 20).trim(),
            url: /^https?:\/\/\S+$/i.test(String(b?.url || "").trim()) ? String(b.url).trim().slice(0, 1000) : "",
            next: ref(b?.next),
          }))
          .filter((b) => b.title),
        media: sanitizeMedia(n.media),
        next: ref(n.next),
      };
    case "input":
      return {
        ...base,
        text: str(n.text, 1000),
        varName: str(n.varName, 40).trim().toLowerCase().replace(/[^a-z0-9_]/g, "_") || "javob",
        validate: INPUT_VALIDATIONS[n.validate] ? n.validate : "text",
        retryText: str(n.retryText, 500),
        next: ref(n.next),
      };
    case "condition":
      return {
        ...base,
        match: n.match === "any" ? "any" : "all",
        conditions: (Array.isArray(n.conditions) ? n.conditions : [])
          .slice(0, 10)
          .filter((c) => CONDITION_KINDS[c?.kind])
          .map((c) => ({ kind: c.kind, op: str(c.op, 20), key: str(c.key, 40).trim(), value: str(c.value, 200).trim(), value2: str(c.value2, 200).trim() })),
        yes: ref(n.yes),
        no: ref(n.no),
      };
    case "action":
      return {
        ...base,
        actions: (Array.isArray(n.actions) ? n.actions : [])
          .slice(0, 10)
          .filter((a) => ACTION_KINDS[a?.kind])
          .map((a) => ({ kind: a.kind, key: str(a.key, 40).trim(), value: str(a.value, 500).trim() })),
        next: ref(n.next),
      };
    case "delay":
      return { ...base, minutes: num(n.minutes, 1, 1380, 5), next: ref(n.next) };
    case "ai":
      return { ...base, prompt: str(n.prompt, 1000), next: ref(n.next) };
    case "redirect":
      return { ...base, flowId: str(n.flowId, 60) };
    case "split": {
      const variants = (Array.isArray(n.variants) ? n.variants : [])
        .slice(0, 5)
        .map((v, i) => ({
          id: ID_RE.test(v?.id || "") ? v.id : newId("v"),
          label: str(v?.label, 30).trim() || `Variant ${String.fromCharCode(65 + i)}`,
          weight: num(v?.weight, 0, 100, 50),
          next: ref(v?.next),
        }));
      return { ...base, variants };
    }
    case "catalog":
      return {
        ...base,
        text: str(n.text, 1000),
        productIds: (Array.isArray(n.productIds) ? n.productIds : []).map((x) => str(x, 40)).filter((x) => ID_RE.test(x)).slice(0, 10),
        next: ref(n.next),
      };
    case "http":
      return {
        ...base,
        method: HTTP_METHODS.includes(String(n.method).toUpperCase()) ? String(n.method).toUpperCase() : "GET",
        url: str(n.url, 1000).trim(),
        headers: str(n.headers, 1000),
        body: str(n.body, 4000),
        map: str(n.map, 1000),
        next: ref(n.next),
        fail: ref(n.fail),
      };
    case "note":
      return { ...base, text: str(n.text, 2000), color: ["yellow", "blue", "pink", "green"].includes(n.color) ? n.color : "yellow" };
    default:
      return null;
  }
}

/** UI yoki AI'dan kelgan flow'ni xavfsiz, izchil ko'rinishga keltiradi. */
export function sanitizeFlow(input = {}, existing = {}) {
  const rawNodes = Array.isArray(input.nodes) ? input.nodes : Object.values(input.nodes || {});
  const valid = rawNodes.filter((n) => n && NODE_TYPES[n.type] && ID_RE.test(String(n.id || ""))).slice(0, 150);
  const ids = new Set(valid.map((n) => n.id));
  const nodes = {};
  for (const n of valid) {
    const clean = sanitizeNode(n, ids);
    if (clean) nodes[clean.id] = clean;
  }
  const start = typeof input.start === "string" && nodes[input.start] ? input.start : Object.keys(nodes)[0] || null;
  return {
    id: existing.id || (ID_RE.test(String(input.id || "")) ? input.id : newId("flow")),
    name: str(input.name || existing.name || "Yangi flow", 120).trim() || "Yangi flow",
    enabled: input.enabled === undefined ? existing.enabled ?? false : Boolean(input.enabled),
    triggers: (Array.isArray(input.triggers) ? input.triggers : []).slice(0, 10).map(sanitizeTrigger),
    start,
    nodes,
    stats: existing.stats || { started: 0, completed: 0, conversions: 0, daily: {}, nodes: {} },
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================
// Statistika
// ============================================================

function bumpDaily(tenant, flow, field) {
  const s = (flow.stats ||= { started: 0, completed: 0, conversions: 0, daily: {}, nodes: {} });
  s.daily ||= {};
  const d = zonedParts(tenant).date;
  const day = (s.daily[d] ||= { started: 0, completed: 0, conversions: 0 });
  day[field] = (day[field] || 0) + 1;
  s[field] = (s[field] || 0) + 1;
  const days = Object.keys(s.daily).sort();
  if (days.length > DAILY_KEEP_DAYS) for (const old of days.slice(0, days.length - DAILY_KEEP_DAYS)) delete s.daily[old];
}

function bumpNode(flow, nodeId) {
  const s = (flow.stats ||= {});
  s.nodes ||= {};
  s.nodes[nodeId] = (s.nodes[nodeId] || 0) + 1;
}

// ============================================================
// Triggerlar
// ============================================================

/** Trigger'dagi post ID'lari ("" yoki "*" — barcha postlar). */
export function mediaIdList(v) {
  return [...new Set(String(v || "").split(/[\s,]+/).map((x) => x.trim()).filter((x) => /^[\w-]{1,40}$/.test(x)))].slice(0, 30);
}

const mediaAllowed = (trigger, mediaId) => {
  const ids = mediaIdList(trigger.mediaId);
  return !ids.length || !mediaId || ids.includes(String(mediaId));
};

function triggerMatches(trigger, { text = "", mediaId = "", ref = "" }) {
  if (!mediaAllowed(trigger, mediaId)) return false;
  if (trigger.type === "ref") {
    const want = normalizeText(trigger.keyword);
    return Boolean(ref) && (!want || want === "*" || normalizeText(ref) === want);
  }
  if (trigger.type === "new_contact" || trigger.type === "story_mention" || trigger.type === "referral") return true;
  if (trigger.matchType === "ai") return false;
  return matchesRule({ keyword: trigger.keyword || "*", matchType: trigger.matchType }, text);
}

/**
 * Hodisaga mos flow'ni topadi (AI triggerlarsiz). Aniq kalit so'zli trigger
 * "hamma matn" (any/*) triggeridan ustun; DM'da "hamma matn" triggeri yo'q —
 * aks holda u AI suhbatni butunlay to'sib qo'yardi.
 */
export function findFlowTrigger(tenant, type, ctx = {}) {
  const all = ensureFlows(tenant).list;
  const enabled = all.filter((f) => f.enabled && f.start && isFlowAllowed(tenant, f, all));
  const hits = [];
  for (const flow of enabled) {
    for (const trigger of flow.triggers || []) {
      if (trigger.type !== type || !triggerMatches(trigger, ctx)) continue;
      const kw = normalizeText(trigger.keyword);
      const catchAll = trigger.matchType === "any" || !kw || kw === "*";
      if (type === "keyword" && catchAll) continue;
      hits.push({ flow, trigger, catchAll, specificPost: mediaIdList(trigger.mediaId).length > 0 });
    }
  }
  // Aniq kalit so'z > "hamma matn"; teng bo'lsa aniq post uchun trigger barcha postlarnikidan ustun
  const rank = (h) => (h.catchAll ? 0 : 2) + (h.specificPost ? 1 : 0);
  return hits.sort((a, b) => rank(b) - rank(a))[0] || null;
}

/** AI triggerli flow'lar — ai.classifyIntent'ga beriladigan nomzodlar. */
export function aiFlowCandidates(tenant, type, mediaId = "") {
  const out = [];
  const all = ensureFlows(tenant).list;
  for (const flow of all) {
    if (!flow.enabled || !flow.start || !isFlowAllowed(tenant, flow, all)) continue;
    for (const trigger of flow.triggers || []) {
      if (trigger.type !== type || trigger.matchType !== "ai") continue;
      if (!mediaAllowed(trigger, mediaId)) continue;
      out.push({ id: `${flow.id}`, name: flow.name, aiIntent: trigger.aiIntent || flow.name, flow, trigger });
    }
  }
  return out;
}

export function pickPublicReply(trigger) {
  const list = (trigger?.publicReplies || []).filter(Boolean);
  return list.length ? list[Math.floor(Math.random() * list.length)] : "";
}

// ============================================================
// Shartlar
// ============================================================

const parseHm = (s) => {
  const m = String(s || "").trim().match(/^(\d{1,2})[:.](\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Bitta shartni tekshiradi. ctx.checkFollow — obunani tekshiruvchi funksiya (testda almashtiriladi). */
export async function evaluateCondition(tenant, key, c, ctx = {}) {
  const now = ctx.now ? zonedParts(tenant, ctx.now) : zonedParts(tenant);
  const { chan, id } = splitKey(key);
  switch (c.kind) {
    case "tag": {
      const has = getContactMeta(tenant, key).tags.includes(String(c.value || "").trim().toLowerCase().replace(/\s+/g, "-"));
      return c.op === "not" ? !has : has;
    }
    case "weekday": {
      const days = String(c.value || "").split(/[,\s]+/).map(Number).filter((d) => d >= 1 && d <= 7);
      return days.includes(now.weekday);
    }
    case "time": {
      const [from, to] = String(c.value || "").split("-").map(parseHm);
      if (from === null || to === null || from === undefined || to === undefined) return false;
      return from <= to ? now.minutes >= from && now.minutes < to : now.minutes >= from || now.minutes < to;
    }
    case "date": {
      const from = c.value || "0000-00-00";
      const to = c.value2 || "9999-12-31";
      return now.date >= from && now.date <= to;
    }
    case "points": {
      const pts = tenant.gamification?.participants?.[key]?.points || 0;
      const v = Number(c.value) || 0;
      return c.op === "lte" ? pts <= v : c.op === "eq" ? pts === v : pts >= v;
    }
    case "var": {
      const val = String(getContactMeta(tenant, key).fields[String(c.key || "").toLowerCase()] ?? "");
      if (c.op === "not_exists") return !val;
      if (c.op === "eq") return normalizeText(val) === normalizeText(c.value);
      if (c.op === "contains") return normalizeText(val).includes(normalizeText(c.value));
      if (["gt", "gte", "lt", "lte"].includes(c.op)) {
        const a = toNumber(val);
        const b = toNumber(renderTemplate(c.value, tenant, key));
        if (a === null || b === null) return false;
        return c.op === "gt" ? a > b : c.op === "gte" ? a >= b : c.op === "lt" ? a < b : a <= b;
      }
      return Boolean(val);
    }
    case "follows": {
      // Telegram'da bir nechta kanal ko'rsatilsa — HAMMASIGA obuna bo'lishi shart
      const channels = String(c.value || "").split(/[,\s]+/).filter(Boolean);
      if (chan === "tg" && channels.length) {
        const check = ctx.checkTgMember || defaultTgMember;
        for (const chName of channels) if ((await check(tenant, chName, id)) === false) return false;
        return true;
      }
      const check = ctx.checkFollow || defaultCheckFollow;
      const ok = await check(tenant, chan, id);
      return ok !== false; // null — tekshirib bo'lmadi → o'tkazamiz
    }
    case "tg_boost": {
      if (chan !== "tg") return false;
      const check = ctx.checkTgBoost || defaultTgBoost;
      return (await check(tenant, String(c.value || "").trim(), id)) === true;
    }
    case "channel":
      return String(c.value || "").split(/[,\s]+/).includes(chan);
    default:
      return false;
  }
}

/** "12 500", "12,5", "12.5 so'm" → 12500 / 12.5; son bo'lmasa null. */
export function toNumber(v) {
  const m = String(v ?? "").replace(/\s+/g, "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

async function defaultTgMember(tenant, channel, id) {
  const { isTelegramMemberOf } = await import("./telegram.js");
  return isTelegramMemberOf(tenant, channel, id);
}

async function defaultTgBoost(tenant, channel, id) {
  const { hasTelegramBoost } = await import("./telegram.js");
  return hasTelegramBoost(tenant, channel, id);
}

async function defaultCheckFollow(tenant, chan, id) {
  const { passesGate } = await import("./automation.js");
  return passesGate(tenant, chan, id);
}

async function evaluateNode(tenant, key, node, ctx) {
  const list = node.conditions || [];
  if (!list.length) return true;
  for (const c of list) {
    const ok = await evaluateCondition(tenant, key, c, ctx);
    if (node.match === "any" && ok) return true;
    if (node.match !== "any" && !ok) return false;
  }
  return node.match !== "any";
}

// ============================================================
// Amallar
// ============================================================

async function runActions(tenant, key, flow, node, ctx) {
  const { chan } = splitKey(key);
  for (const a of node.actions || []) {
    const value = renderTemplate(a.value, tenant, key);
    switch (a.kind) {
      case "add_tag":
        if (value) addTags(tenant, key, value.split(","));
        break;
      case "remove_tag":
        for (const t of value.split(",")) if (t.trim()) removeTag(tenant, key, t);
        break;
      case "set_var":
        if (a.key) setFields(tenant, key, { [a.key.toLowerCase()]: value });
        break;
      case "add_points": {
        const delta = Math.trunc(Number(value) || 0);
        if (delta) game.adjustPoints(tenant, key, delta, `Flow: ${flow.name}`);
        break;
      }
      case "conversion":
        bumpDaily(tenant, flow, "conversions");
        fireEvent(tenant, "conversion", { contact: key, flow: flow.name, label: value || flow.name });
        break;
      case "handoff":
        startHandoff(tenant, chan, key);
        ctx.handedOff = true;
        break;
      case "notify":
        if (tenant.settings?.telegramChatId && value) {
          sendTelegram(tenant.settings.telegramChatId, `🔔 <b>${escapeHtml(flow.name)}</b>\n\n${escapeHtml(value)}\n\n👤 ${escapeHtml(key)}`).catch(() => {});
        }
        break;
      case "run_flow": {
        const target = findFlow(tenant, a.key);
        if (!target?.start || target.id === flow.id || (ctx.depth || 0) >= MAX_REDIRECT_DEPTH) break;
        if (a.value === "referrer") {
          // "Taklif qilgan odam uchun": xabarlar mijozga emas, uni taklif qilgan odamga ketadi
          const refKey = tenant.gamification?.participants?.[key]?.referredBy;
          if (!refKey) break;
          setFields(tenant, refKey, { last_referral: displayNameOf(tenant, key) });
          await startFlow(tenant, refKey, target, { depth: (ctx.depth || 0) + 1 });
        } else {
          // Parallel ravishda (joriy flow davom etadi) — sessiyasiz qismlarini bajaradi
          await startFlow(tenant, key, target, { depth: (ctx.depth || 0) + 1, send: ctx.send });
        }
        break;
      }
      case "react":
        await reactToMessage(tenant, key, ctx);
        break;
      case "math": {
        // value: "+10", "-5", "*2", "/4", "=100" (o'zgaruvchi bilan: "+{narx}")
        if (!a.key) break;
        const field = a.key.toLowerCase();
        const m = String(value).trim().match(/^([+\-*/=])?\s*(.+)$/);
        const n = m ? toNumber(m[2]) : null;
        if (n === null) break;
        const cur = toNumber(getContactMeta(tenant, key).fields[field]) ?? 0;
        const op = m[1] || "=";
        let res = op === "+" ? cur + n : op === "-" ? cur - n : op === "*" ? cur * n : op === "/" ? (n ? cur / n : cur) : n;
        res = Math.round(res * 100) / 100;
        setFields(tenant, key, { [field]: String(res) });
        break;
      }
      case "send_sms": {
        const { sendSms } = await import("./messaging.js");
        const phone = getContactMeta(tenant, key).fields.phone;
        if (phone && value) {
          const r = await sendSms(tenant, phone, value);
          if (!r.ok) console.error(`[Flow SMS] ${tenant.businessName}: ${r.error}`);
        }
        break;
      }
      case "send_email": {
        const { sendEmail } = await import("./messaging.js");
        const email = getContactMeta(tenant, key).fields.email;
        if (email && value) {
          const r = await sendEmail(tenant, email, renderTemplate(a.key, tenant, key) || flow.name, value);
          if (!r.ok) console.error(`[Flow Email] ${tenant.businessName}: ${r.error}`);
        }
        break;
      }
      case "payment_link": {
        // key: summa ({o'zgaruvchi} mumkin), value: nima uchun to'lov
        const { createOrder, orderMessage } = await import("./shop.js");
        const amount = toNumber(renderTemplate(a.key, tenant, key));
        if (!amount || amount <= 0) break;
        const order = createOrder(tenant, key, [{ name: value || flow.name, price: amount, qty: 1 }], { source: `flow:${flow.name}` });
        if (order) {
          const msg = orderMessage(tenant, order);
          await deliver(tenant, key, ctx, msg.text, msg.options);
        }
        break;
      }
      case "crm_lead": {
        const { pushCrmLead } = await import("./crm.js");
        const f = getContactMeta(tenant, key).fields;
        pushCrmLead(tenant, {
          key, title: value || `${flow.name}: ${f.name || f.phone || key}`, name: f.name, phone: f.phone, email: f.email,
          price: f.summa || f.price || "", note: `Flow: ${flow.name}`, tags: getContactMeta(tenant, key).tags,
        }).then((r) => { if (!r.ok) console.error(`[CRM] ${r.error}`); }).catch(() => {});
        break;
      }
      case "seq_subscribe": {
        const { subscribe } = await import("./sequences.js");
        if (a.key) subscribe(tenant, key, a.key);
        break;
      }
      case "seq_unsubscribe": {
        const { unsubscribe, unsubscribeAll } = await import("./sequences.js");
        if (!a.key || a.key === "all") unsubscribeAll(tenant, key);
        else unsubscribe(tenant, key, a.key);
        break;
      }
      case "opt_out": {
        const { setOptOut } = await import("./optout.js");
        setOptOut(tenant, key, value !== "in");
        break;
      }
      case "webhook":
        fireEvent(
          tenant,
          "flow_event",
          { contact: key, flow: flow.name, label: value, fields: getContactMeta(tenant, key).fields, tags: getContactMeta(tenant, key).tags },
          { force: true }
        );
        break;
      default:
        break;
    }
  }
}

function displayNameOf(tenant, key) {
  const f = tenant.contactMeta?.[key]?.fields || {};
  const p = tenant.contactProfiles?.[splitKey(key).id] || {};
  return f.name || p.name || (p.username ? `@${p.username}` : "do'stingiz");
}

/** ❤️ reaksiya: DM xabariga (Instagram / Telegram) yoki kommentga layk. */
async function reactToMessage(tenant, key, ctx) {
  if (ctx.send) {
    await ctx.send({ key, reaction: "love", messageId: ctx.messageId || "", commentId: ctx.commentId || "" });
    return;
  }
  const { chan, id } = splitKey(key);
  try {
    if (ctx.commentId && chan === "ig") {
      const { likeComment } = await import("./services/instagram.js");
      await likeComment(tenant, ctx.commentId);
    } else if (ctx.messageId && chan === "ig") {
      const { igGraphPost } = await import("./graph.js");
      await igGraphPost("me/messages", { recipient: { id }, sender_action: "react", payload: { message_id: ctx.messageId, reaction: "love" } }, tenant.meta?.igAccessToken || tenant.meta?.pageAccessToken || "");
    } else if (ctx.messageId && chan === "tg") {
      const { callTelegramApi } = await import("./telegram.js");
      const token = tenant.settings?.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;
      await callTelegramApi(token, "setMessageReaction", { chat_id: id, message_id: Number(ctx.messageId), reaction: [{ type: "emoji", emoji: "❤" }] });
    }
  } catch (err) {
    console.error("[Flow] reaksiya xatosi:", err.message);
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);
}

// ============================================================
// Yuborish
// ============================================================

/**
 * Live Inbox tarixiga yozadi. ctx.userText — mijozning shu flow'ni boshlagan
 * xabari: u birinchi bot xabaridan OLDIN bir marta yoziladi (tartib to'g'ri bo'lsin).
 */
export function logToInbox(tenant, key, ctx, botText = "") {
  tenant.chats ||= {};
  const list = (tenant.chats[key] ||= []);
  const at = new Date().toISOString();
  if (ctx?.userText) {
    list.push({ role: "user", text: ctx.userText, at });
    ctx.userText = "";
  }
  if (botText) list.push({ role: "assistant", text: botText, at });
  tenant.chats[key] = list.slice(-16);
}

async function deliver(tenant, key, ctx, text, options = []) {
  const body = String(text || "").trim();
  if (!body && !options.length) return false;
  if (ctx.send) {
    const r = await ctx.send({ key, text: body, options, viaComment: Boolean(ctx.commentId && !ctx.commentUsed) });
    if (ctx.commentId) ctx.commentUsed = true;
    logToInbox(tenant, key, ctx, body);
    return r !== false;
  }
  const { chan, id } = splitKey(key);
  let ok;
  if (ctx.commentId && !ctx.commentUsed) {
    // Komment egasiga birinchi xabar faqat "private reply" orqali yuborilishi mumkin
    ctx.commentUsed = true;
    const { privateReplyToComment } = await import("./services/instagram.js");
    const links = options.filter((o) => o.url);
    const buttons = options.filter((o) => o.payload);
    const r = await privateReplyToComment(tenant, ctx.commentId, optionsAsText(body, links), buttons);
    ok = Boolean(r && !r.error);
  } else {
    ok = await sendReply(tenant, chan, id, body, options);
  }
  if (options.some((o) => o.payload)) {
    const { rememberOptions } = await import("./automation.js");
    rememberOptions(tenant, key, options);
  }
  logToInbox(tenant, key, ctx, body);
  return ok;
}

async function deliverMedia(tenant, key, ctx, media) {
  const label = { image: "🖼️ Rasm", video: "🎬 Video", audio: "🎧 Audio", file: "📎 Fayl", post: "📸 Post" }[media.type] || "📎";
  if (ctx.send) {
    await ctx.send({ key, media });
  } else {
    const { chan, id } = splitKey(key);
    await sendMedia(tenant, chan, id, media);
  }
  logToInbox(tenant, key, ctx, `${label}${media.name ? `: ${media.name}` : ""}`);
}

// ============================================================
// Bajarish
// ============================================================

function setSession(tenant, key, data) {
  const s = ensureFlows(tenant).sessions;
  if (data) s[key] = { ...data, at: Date.now() };
  else delete s[key];
}

export function activeFlowSession(tenant, key) {
  const s = ensureFlows(tenant).sessions[key];
  if (!s) return null;
  if (Date.now() - s.at > SESSION_TTL_MS) {
    delete ensureFlows(tenant).sessions[key];
    return null;
  }
  return s;
}

/**
 * Flow'ni nodeId'dan boshlab bajaradi: xabarlarni yuboradi, shartlarni tekshiradi,
 * amallarni bajaradi. Tugma/savol/kutish blokida to'xtaydi (mijoz javobini kutadi).
 */
export async function runFrom(tenant, key, flow, nodeId, ctx = {}, depth = 0) {
  ctx.depth = Math.max(depth, ctx.depth || 0);
  let current = nodeId;
  let steps = 0;
  while (current && steps++ < MAX_STEPS) {
    const node = flow.nodes?.[current];
    if (!node) break;
    bumpNode(flow, node.id);

    if (node.type === "message") {
      const buttons = node.buttons || [];
      const options = buttons.map((b) =>
        b.url
          ? { title: b.title, url: trackedUrl(tenant, renderTemplate(b.url, tenant, key), { key, flowId: flow.id, nodeId: node.id, buttonId: b.id, title: b.title, next: b.next || "" }) }
          : { title: b.title, payload: `FLOW:${flow.id}:${b.next || "_end"}` }
      );
      let text = renderTemplate(node.text, tenant, key);
      if (node.media) {
        if (ctx.commentId && !ctx.commentUsed) {
          // Komment egasiga birinchi xabar faqat matnli private reply bo'la oladi — media havolasini qo'shamiz
          const link = node.media.type === "post" ? node.media.permalink : absoluteMediaUrl(node.media.url || "");
          if (link) text = `${text}\n\n${link}`.trim();
        } else {
          await deliverMedia(tenant, key, ctx, node.media);
        }
      }
      await deliver(tenant, key, ctx, text, options);
      // "Keyingi qadam" tugmalari bo'lsa — mijoz bosishini kutamiz
      if (buttons.some((b) => !b.url)) {
        setSession(tenant, key, { flowId: flow.id, nodeId: node.id, wait: "buttons" });
        persist(tenant);
        return { status: "waiting" };
      }
      current = node.next;
      continue;
    }

    if (node.type === "input") {
      await deliver(tenant, key, ctx, renderTemplate(node.text, tenant, key));
      setSession(tenant, key, { flowId: flow.id, nodeId: node.id, wait: "input" });
      persist(tenant);
      return { status: "waiting" };
    }

    if (node.type === "condition") {
      current = (await evaluateNode(tenant, key, node, ctx)) ? node.yes : node.no;
      continue;
    }

    if (node.type === "action") {
      await runActions(tenant, key, flow, node, ctx);
      if (ctx.handedOff) {
        setSession(tenant, key, null);
        persist(tenant);
        return { status: "handoff" };
      }
      current = node.next;
      continue;
    }

    if (node.type === "delay") {
      setSession(tenant, key, null);
      if (node.next) {
        scheduleFollowUp(tenant, {
          key,
          kind: "flow",
          ruleId: `${flow.id}:${node.id}`,
          text: `flow:${flow.id}`,
          delayMin: node.minutes,
          data: { flowId: flow.id, nodeId: node.next },
        });
      }
      persist(tenant);
      return { status: "delayed" };
    }

    if (node.type === "ai") {
      // AI javob o'chirilgan bo'lsa (umumiy/kanal/jadval/chat) — blok o'tkazib yuboriladi
      const { aiAllowed } = await import("./aiControl.js");
      if (!aiAllowed(tenant, splitKey(key).chan, key).allowed) {
        current = node.next;
        continue;
      }
      const { generateReply } = await import("./ai.js");
      const question = [node.prompt ? renderTemplate(node.prompt, tenant, key) : "", ctx.text || ""].filter(Boolean).join("\n\n");
      const reply = question ? await generateReply(tenant, key, { text: question }) : "";
      if (reply) await deliver(tenant, key, ctx, reply);
      current = node.next;
      continue;
    }

    if (node.type === "split") {
      const v = pickVariant(node.variants || []);
      if (v) {
        const st = ((flow.stats ||= {}).split ||= {});
        const row = (st[node.id] ||= {});
        row[v.id] = (row[v.id] || 0) + 1;
      }
      current = v?.next || null;
      continue;
    }

    if (node.type === "catalog") {
      const { sendCatalog } = await import("./shop.js");
      if (node.text) await deliver(tenant, key, ctx, renderTemplate(node.text, tenant, key));
      await sendCatalog(tenant, key, node.productIds || [], ctx.send ? { send: ctx.send } : {});
      logToInbox(tenant, key, ctx, "🛍️ Katalog");
      current = node.next;
      continue;
    }

    if (node.type === "http") {
      const ok = await runHttpNode(tenant, key, node, ctx);
      current = ok ? node.next : node.fail;
      continue;
    }

    if (node.type === "redirect") {
      const target = findFlow(tenant, node.flowId);
      setSession(tenant, key, null);
      if (target && target.id !== flow.id && target.start && depth < MAX_REDIRECT_DEPTH) {
        bumpDaily(tenant, flow, "completed");
        return startFlow(tenant, key, target, ctx, depth + 1);
      }
      break;
    }

    break;
  }

  setSession(tenant, key, null);
  bumpDaily(tenant, flow, "completed");
  persist(tenant);
  return { status: "completed" };
}

/** A/B test: ulush (weight) bo'yicha tasodifiy variant. */
export function pickVariant(variants, rnd = Math.random) {
  const list = (variants || []).filter((v) => v.weight > 0);
  const total = list.reduce((s, v) => s + v.weight, 0);
  if (!total) return null;
  let r = rnd() * total;
  for (const v of list) {
    if ((r -= v.weight) < 0) return v;
  }
  return list[list.length - 1];
}

/** JSON yo'li: "data.items.0.name" */
export function jsonPath(obj, path) {
  let cur = obj;
  for (const part of String(path || "").split(".").map((x) => x.trim()).filter(Boolean)) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[/^\d+$/.test(part) && Array.isArray(cur) ? Number(part) : part];
  }
  return cur;
}

const HTTP_TIMEOUT_MS = 8000;
const HTTP_MAX_BYTES = 256 * 1024;

/**
 * Tashqi API'ga so'rov. URL, sarlavha va tanada {o'zgaruvchi}lar ishlatiladi.
 * Javob JSON bo'lsa "o'zgaruvchi = yo'l" qatorlari bo'yicha kontakt kartasiga yoziladi.
 * {http_status} har doim saqlanadi. Qaytaradi: true — 2xx javob.
 */
export async function runHttpNode(tenant, key, node, ctx = {}) {
  const url = renderTemplate(node.url, tenant, key, {}, { encode: true });
  if (!isSafeUrl(url)) {
    setFields(tenant, key, { http_status: "blocked" });
    return false;
  }
  const headers = { "User-Agent": "Obunext-Flow/1.0" };
  for (const line of String(node.headers || "").split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) {
      const name = line.slice(0, i).trim();
      if (/^[\w-]{1,60}$/.test(name) && !/^(host|content-length|connection)$/i.test(name)) headers[name] = renderTemplate(line.slice(i + 1).trim(), tenant, key);
    }
  }
  const method = node.method || "GET";
  let body;
  if (method !== "GET" && node.body) {
    body = renderTemplate(node.body, tenant, key);
    if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
      headers["Content-Type"] = /^\s*[[{]/.test(body) ? "application/json" : "text/plain";
    }
  }
  const fetchFn = ctx.fetch || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { method, headers, body, signal: controller.signal, redirect: "manual" });
    const raw = (await res.text()).slice(0, HTTP_MAX_BYTES);
    let data = null;
    try { data = JSON.parse(raw); } catch { data = null; }
    const fields = { http_status: String(res.status) };
    for (const line of String(node.map || "").split("\n")) {
      const i = line.indexOf("=");
      if (i <= 0) continue;
      const name = line.slice(0, i).trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
      const path = line.slice(i + 1).trim();
      if (!name) continue;
      const v = data !== null ? jsonPath(data, path) : path === "" || path === "." ? raw : undefined;
      if (v !== undefined && v !== null) fields[name] = typeof v === "object" ? JSON.stringify(v).slice(0, 1000) : String(v).slice(0, 1000);
    }
    setFields(tenant, key, fields);
    return res.status >= 200 && res.status < 300;
  } catch (err) {
    console.error(`[Flow HTTP] ${tenant.businessName}: ${method} ${url.slice(0, 80)} — ${err.message}`);
    setFields(tenant, key, { http_status: err.name === "AbortError" ? "timeout" : "error" });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Flow'ni boshidan ishga tushiradi (trigger ishlaganda). */
export async function startFlow(tenant, key, flow, ctx = {}, depth = 0) {
  if (!flow?.start) return { status: "empty" };
  depth = Math.max(depth, ctx.depth || 0);
  bumpDaily(tenant, flow, "started");
  console.log(`[Flow] ${tenant.businessName}: "${flow.name}" → ${key}`);
  return runFrom(tenant, key, flow, flow.start, ctx, depth);
}

/**
 * Kiruvchi DM'ni flow nuqtai nazaridan qayta ishlaydi:
 *  - FLOW:<flowId>:<nodeId> tugmasi bosildi → shu blokdan davom etadi
 *  - "input" blokida javob kutilmoqda → javobni tekshirib o'zgaruvchiga yozadi
 * Qaytaradi: true — xabar flow tomonidan qayta ishlandi (boshqa javob kerak emas).
 */
export async function handleFlowInbound(tenant, key, { text = "", payload = "" } = {}, ctx = {}) {
  if (payload?.startsWith("FLOW:")) {
    const [, flowId, nodeId] = payload.split(":");
    const flow = findFlow(tenant, flowId);
    setSession(tenant, key, null);
    if (!flow || !flow.enabled || !isFlowAllowed(tenant, flow, ensureFlows(tenant).list)) return false;
    if (nodeId === "_end" || !flow.nodes[nodeId]) {
      bumpDaily(tenant, flow, "completed");
      persist(tenant);
      return true;
    }
    // Ice breaker yoki broadcast tugmasi flow'ni boshidan ochsa — "boshlandi" deb hisoblaymiz
    if (nodeId === flow.start) bumpDaily(tenant, flow, "started");
    await runFrom(tenant, key, flow, nodeId, { ...ctx, text });
    return true;
  }

  const session = activeFlowSession(tenant, key);
  if (!session) return false;
  const flow = findFlow(tenant, session.flowId);
  const node = flow?.nodes?.[session.nodeId];
  if (!flow || !node) {
    setSession(tenant, key, null);
    return false;
  }

  if (session.wait === "buttons") {
    // Mijoz tugma o'rniga matn yozdi — flow'dan chiqamiz, xabar odatdagidek ishlanadi
    setSession(tenant, key, null);
    return false;
  }

  if (CANCEL_WORDS.has(normalizeText(text))) {
    setSession(tenant, key, null);
    persist(tenant);
    await deliver(tenant, key, ctx, "Bekor qilindi ✅");
    return true;
  }

  const res = validateAnswer({ type: node.validate || "text" }, text, payload);
  if (!res.ok) {
    await deliver(tenant, key, ctx, node.retryText ? renderTemplate(node.retryText, tenant, key) : res.error);
    return true;
  }
  const fields = { [node.varName || "javob"]: res.value };
  if (node.validate === "phone") fields.phone = res.value;
  if (node.validate === "email") fields.email = res.value;
  if (node.validate === "name") fields.name = res.value;
  setFields(tenant, key, fields);
  setSession(tenant, key, null);
  await runFrom(tenant, key, flow, node.next, { ...ctx, text });
  return true;
}

/**
 * Do'st taklif qilinganda (geymifikatsiya referali tasdiqlanganda) — taklif qilgan
 * odam uchun "referral" triggerli flow'lar ishga tushadi. {last_referral} — yangi do'st.
 */
export async function fireReferralFlows(tenant, referrerKey, newKey) {
  const hit = findFlowTrigger(tenant, "referral", {});
  if (!hit) return false;
  setFields(tenant, referrerKey, { last_referral: displayNameOf(tenant, newKey) });
  await startFlow(tenant, referrerKey, hit.flow, {});
  return true;
}

/** Kechiktirilgan "delay" blokidan keyin flow'ni davom ettiradi (followups.js chaqiradi). */
export async function continueFlowJob(tenant, job, send) {
  const flow = findFlow(tenant, job.data?.flowId);
  if (!flow || !flow.enabled || !flow.nodes?.[job.data?.nodeId]) return false;
  await runFrom(tenant, job.key, flow, job.data.nodeId, send ? { send } : {});
  return true;
}

/** Flow'ning oxirgi N kunlik statistikasi (grafik uchun). */
export function dailySeries(tenant, flows, days = 30) {
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = zonedParts(tenant, new Date(today.getTime() - i * 86400000)).date;
    const row = { date: d, started: 0, completed: 0, conversions: 0 };
    for (const f of flows) {
      const day = f.stats?.daily?.[d];
      if (!day) continue;
      row.started += day.started || 0;
      row.completed += day.completed || 0;
      row.conversions += day.conversions || 0;
    }
    out.push(row);
  }
  return out;
}

// ============================================================
// Tekshiruv (validatsiya) — saqlash va yoqishdan oldin
// ============================================================

/**
 * Flow'dagi xato va ogohlantirishlarni topadi.
 * errors — flow noto'g'ri ishlaydi (yoqib bo'lmaydi); warnings — ishlaydi, lekin e'tibor bering.
 * Har bir yozuv: { nodeId?, msg }
 */
export function validateFlow(flow, allFlows = []) {
  const errors = [];
  const warnings = [];
  const nodes = flow.nodes || {};
  const ids = Object.keys(nodes);
  const flowIds = new Set(allFlows.map((f) => f.id));
  const label = (n) => `${NODE_TYPES[n.type] || n.type} #${n.id}`;

  if (!ids.length) errors.push({ msg: "Flow bo'sh — kamida bitta blok qo'shing" });
  if (ids.length && (!flow.start || !nodes[flow.start])) errors.push({ msg: "Boshlanish (START) bloki tanlanmagan" });
  if (flow.start && nodes[flow.start]?.type === "note") errors.push({ nodeId: flow.start, msg: "Izoh bloki START bo'la olmaydi" });

  const triggers = flow.triggers || [];
  if (!triggers.length) warnings.push({ msg: "Trigger yo'q — flow faqat boshqa flow, ice breaker yoki ommaviy xabar orqali ishga tushadi" });
  triggers.forEach((t, i) => {
    const n = i + 1;
    const needsKw = ["keyword", "comment", "live_comment", "story_reply"].includes(t.type);
    if (needsKw && t.matchType === "ai" && !t.aiIntent) errors.push({ msg: `${n}-trigger: AI trigger uchun ma'no tavsifini yozing` });
    else if (needsKw && !["any", "ai"].includes(t.matchType) && !normalizeText(t.keyword)) {
      errors.push({ msg: `${n}-trigger: kalit so'z yozilmagan` });
    }
    if (t.type === "keyword" && (t.matchType === "any" || normalizeText(t.keyword) === "*")) {
      warnings.push({ msg: `${n}-trigger: Direct'da "har qanday matn" triggeri ishlamaydi (AI suhbatni to'smasligi uchun)` });
    }
  });

  // START'dan yetib boriladigan bloklar
  const reach = new Set();
  const stack = flow.start && nodes[flow.start] ? [flow.start] : [];
  while (stack.length) {
    const id = stack.pop();
    if (reach.has(id) || !nodes[id]) continue;
    reach.add(id);
    const n = nodes[id];
    targetsOf(n).forEach((x) => stack.push(x));
  }

  // START noto'g'ri blokka qo'yilgan bo'lsa (unga boshqa bloklardan kirish bor, flow'ning
  // haqiqiy boshi esa boshqa blok) — aniq maslahat va bir tugmali tuzatish
  const incoming = new Set();
  for (const n of Object.values(nodes)) {
    targetsOf(n).filter((x) => x !== n.id).forEach((x) => incoming.add(x));
  }
  if (flow.start && nodes[flow.start] && incoming.has(flow.start)) {
    const roots = ids.filter((id) => id !== flow.start && nodes[id].type !== "note" && !incoming.has(id));
    if (roots.length === 1 && !reach.has(roots[0])) {
      warnings.unshift({
        nodeId: roots[0],
        msg: `START ${label(nodes[flow.start])} blokida turibdi, lekin flow ${label(nodes[roots[0]])} dan boshlanishi kerak — START'ni o'sha blokka o'tkazing`,
        fix: { start: roots[0] },
      });
    }
  }

  for (const n of Object.values(nodes)) {
    if (n.type === "note") continue;
    if (!reach.has(n.id)) warnings.push({ nodeId: n.id, msg: `${label(n)}: START'dan bu blokka yo'l yo'q — hech qachon ishlamaydi` });
    if (n.type === "message") {
      if (!String(n.text || "").trim() && !n.media && !(n.buttons || []).length) errors.push({ nodeId: n.id, msg: `${label(n)}: xabar bo'sh` });
      (n.buttons || []).forEach((b) => {
        if (!b.url && !b.next) warnings.push({ nodeId: n.id, msg: `${label(n)}: "${b.title}" tugmasi hech qayerga ulanmagan (bosilsa flow tugaydi)` });
      });
      if ((n.buttons || []).filter((b) => b.url).length > 3) warnings.push({ nodeId: n.id, msg: `${label(n)}: Instagram 3 tadan ortiq havola tugmasini ko'rsatmaydi` });
    }
    if (n.type === "input" && !String(n.text || "").trim()) errors.push({ nodeId: n.id, msg: `${label(n)}: savol matni yo'q` });
    if (n.type === "input" && !n.next) warnings.push({ nodeId: n.id, msg: `${label(n)}: javobdan keyin hech narsa yo'q (flow tugaydi)` });
    if (n.type === "condition") {
      if (!(n.conditions || []).length) warnings.push({ nodeId: n.id, msg: `${label(n)}: shart yo'q — doim "Ha"` });
      if (!n.yes && !n.no) warnings.push({ nodeId: n.id, msg: `${label(n)}: Ha/Yo'q chiqishlari ulanmagan` });
      (n.conditions || []).forEach((c) => {
        if (c.kind === "tag" && !c.value) errors.push({ nodeId: n.id, msg: `${label(n)}: teg shartida teg yozilmagan` });
        if (c.kind === "var" && !c.key) errors.push({ nodeId: n.id, msg: `${label(n)}: o'zgaruvchi nomi yozilmagan` });
        if (c.kind === "weekday" && !c.value) errors.push({ nodeId: n.id, msg: `${label(n)}: hafta kunlari tanlanmagan` });
      });
    }
    if (n.type === "action") {
      if (!(n.actions || []).length) warnings.push({ nodeId: n.id, msg: `${label(n)}: amal yo'q` });
      (n.actions || []).forEach((a) => {
        if (a.kind === "run_flow" && (!a.key || !flowIds.has(a.key))) errors.push({ nodeId: n.id, msg: `${label(n)}: ishga tushiriladigan flow topilmadi` });
        if ((a.kind === "add_tag" || a.kind === "remove_tag") && !a.value) errors.push({ nodeId: n.id, msg: `${label(n)}: teg yozilmagan` });
        if (a.kind === "set_var" && !a.key) errors.push({ nodeId: n.id, msg: `${label(n)}: o'zgaruvchi nomi yozilmagan` });
        if (a.kind === "math" && !a.key) errors.push({ nodeId: n.id, msg: `${label(n)}: hisoblash uchun o'zgaruvchi nomi yozilmagan` });
        if (a.kind === "payment_link" && !toNumber(a.key) && !String(a.key || "").includes("{")) errors.push({ nodeId: n.id, msg: `${label(n)}: to'lov summasi yozilmagan` });
        if (a.kind === "seq_subscribe" && !a.key) errors.push({ nodeId: n.id, msg: `${label(n)}: ketma-ketlik tanlanmagan` });
      });
    }
    if (n.type === "split") {
      const vs = n.variants || [];
      if (vs.length < 2) warnings.push({ nodeId: n.id, msg: `${label(n)}: A/B test uchun kamida 2 ta variant kerak` });
      if (vs.length && !vs.some((v) => v.weight > 0)) errors.push({ nodeId: n.id, msg: `${label(n)}: barcha variantlar ulushi 0%` });
      vs.forEach((v) => { if (!v.next) warnings.push({ nodeId: n.id, msg: `${label(n)}: "${v.label}" varianti ulanmagan (flow tugaydi)` }); });
    }
    if (n.type === "http") {
      if (!n.url) errors.push({ nodeId: n.id, msg: `${label(n)}: so'rov manzili (URL) yozilmagan` });
      else if (!/^https?:\/\//i.test(n.url)) errors.push({ nodeId: n.id, msg: `${label(n)}: URL http:// yoki https:// bilan boshlanishi kerak` });
      if (!n.next && !n.fail) warnings.push({ nodeId: n.id, msg: `${label(n)}: Muvaffaqiyat/Xato chiqishlari ulanmagan` });
    }
    if (n.type === "delay" && !n.next) warnings.push({ nodeId: n.id, msg: `${label(n)}: kutishdan keyin hech narsa yo'q` });
    if (n.type === "redirect" && (!n.flowId || !flowIds.has(n.flowId) || n.flowId === flow.id)) {
      errors.push({ nodeId: n.id, msg: `${label(n)}: o'tiladigan flow tanlanmagan yoki topilmadi` });
    }
  }
  return { errors, warnings };
}

/** Blokdan chiqadigan barcha ulanishlar. */
export function targetsOf(n) {
  return [n.next, n.yes, n.no, n.fail, ...(n.buttons || []).map((b) => b.next), ...(n.variants || []).map((v) => v.next)].filter(Boolean);
}

/** Versiyalar tarixi uchun flow'ning tahrirlanadigan qismi. */
export function flowSnapshot(flow) {
  return {
    at: flow.updatedAt || new Date().toISOString(),
    name: flow.name,
    triggers: flow.triggers,
    start: flow.start,
    nodes: flow.nodes,
  };
}
