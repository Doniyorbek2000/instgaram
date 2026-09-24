/**
 * AI xarajatlari va kredit hisobi.
 *
 *  - Har bir AI chaqiruvida Gemini/Claude qaytargan HAQIQIY token soni yoziladi
 *    (tenant.aiUsage.cost["YYYY-MM"]) va admin belgilagan narxlar bo'yicha dollar/so'mga
 *    aylantiriladi — admin panel → "AI xarajati".
 *  - Biznesdan yechiladigan kredit ham token hajmiga qarab: oddiy matnli javob = 1 kredit,
 *    ovoz/video/juda katta so'rov — proporsional ravishda ko'proq. Kredit asosiy (arzon)
 *    model narxida hisoblanadi — zaxira modelga o'tish mijoz hisobiga tushmaydi.
 */
import { platformSettings } from "./credits.js";

export const DEFAULT_AI_PRICING = {
  usdRate: 12800, // 1 USD necha so'm
  vatPct: 12, // narx ichidagi QQS
  paymePct: 2, // Payme komissiyasi
  // $ / 1M token: [kiruvchi, chiquvchi]
  models: {
    "gemini-3.5-flash-lite": [0.3, 2.5],
    "gemini-3.6-flash": [0.75, 3.75],
    claude: [3, 15],
  },
  unknownModel: [0.75, 3.75], // ro'yxatda yo'q model — ehtiyotkor narx
  ttsPerMChars: /wavenet|neural|studio|chirp/i.test(process.env.TTS_VOICE || "") ? 16 : 4,
  // 1 kredit hajmi (asosiy model narxida): 4 000 kiruvchi + 300 chiquvchi token
  creditIn: 4000,
  creditOut: 300,
};

const MAX_MONTHS = 12;
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

export function aiPricing() {
  const s = platformSettings().aiPricing || {};
  // Admin model ro'yxatini kiritgan bo'lsa — aynan o'sha (birinchisi asosiy model)
  const models = s.models && Object.keys(s.models).length ? s.models : DEFAULT_AI_PRICING.models;
  return { ...DEFAULT_AI_PRICING, ...s, models };
}

function modelPrice(model, p = aiPricing()) {
  const m = String(model || "");
  if (p.models[m]) return p.models[m];
  if (/claude/i.test(m)) return p.models.claude || p.unknownModel;
  return p.unknownModel;
}

/** Chaqiruvning dollardagi narxi. */
export function usdCost(model, inTok = 0, outTok = 0, p = aiPricing()) {
  const [pi, po] = modelPrice(model, p);
  return ((Number(inTok) || 0) * pi + (Number(outTok) || 0) * po) / 1e6;
}

const baseModel = (p) => p.models[Object.keys(p.models)[0]] || [0.3, 2.5];

/** Token hajmiga mos kredit (kasr bo'lishi mumkin). */
export function creditsFor(inTok = 0, outTok = 0, p = aiPricing()) {
  const [pi, po] = baseModel(p);
  const unit = p.creditIn * pi + p.creditOut * po;
  return unit > 0 ? ((Number(inTok) || 0) * pi + (Number(outTok) || 0) * po) / unit : 0;
}

/** Ovozli javob (TTS) uchun kredit: narxi 1 kredit narxiga nisbatan. */
export function ttsCredits(chars, p = aiPricing()) {
  const [pi, po] = baseModel(p);
  const unitUsd = (p.creditIn * pi + p.creditOut * po) / 1e6;
  return unitUsd > 0 ? ((Number(chars) || 0) * p.ttsPerMChars) / 1e6 / unitUsd : 0;
}

/**
 * Xarajatni yozadi. ownKey — biznes o'z Gemini kalitidan foydalangan (platformaga xarajat yo'q).
 * kind: reply | classify | text | audit | tts
 */
export function recordAiCost(tenant, { kind = "reply", model = "", inTok = 0, outTok = 0, ttsChars = 0, ownKey = false } = {}) {
  if (!tenant) return 0;
  const p = aiPricing();
  const usd = ownKey ? 0 : ttsChars ? (ttsChars * p.ttsPerMChars) / 1e6 : usdCost(model, inTok, outTok, p);
  const usage = (tenant.aiUsage ||= {});
  const all = (usage.cost ||= {});
  const m = monthKey();
  const c = (all[m] ||= { usd: 0, calls: 0, in: 0, out: 0, tts: 0, own: 0, kinds: {}, models: {} });
  c.usd += usd;
  c.calls += 1;
  c.in += Number(inTok) || 0;
  c.out += Number(outTok) || 0;
  c.tts += Number(ttsChars) || 0;
  if (ownKey) c.own += 1;
  const k = (c.kinds[kind] ||= { calls: 0, usd: 0 });
  k.calls += 1;
  k.usd += usd;
  if (model) c.models[model] = (c.models[model] || 0) + 1;
  const keys = Object.keys(all).sort();
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_MONTHS))) delete all[old];
  return usd;
}

/** Biznesning oy bo'yicha xarajati (bo'lmasa bo'sh obyekt). */
export function monthCost(tenant, month = monthKey()) {
  return tenant?.aiUsage?.cost?.[month] || { usd: 0, calls: 0, in: 0, out: 0, tts: 0, own: 0, kinds: {}, models: {} };
}

/** To'lovdan qoladigan sof summa (QQS va Payme komissiyasi ayirilgan). */
export function netRevenue(amount, p = aiPricing()) {
  const a = Number(amount) || 0;
  return a / (1 + p.vatPct / 100) - (a * p.paymePct) / 100;
}

export const toSom = (usd, p = aiPricing()) => (Number(usd) || 0) * p.usdRate;
export { monthKey };
