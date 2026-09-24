/**
 * Geymifikatsiya — ChatPlace uslubidagi ballar tizimi.
 *
 *  - Harakatlar uchun avtomatik ball: komment, story mention, story reply, referal,
 *    viktorina, Direct'ga yozish. Erta komment uchun bonus.
 *  - Cheklovlar: kunlik limit, faqat obunachilar (IG follow / Telegram kanal a'zoligi),
 *    minimal obunachi soni (IG).
 *  - Real vaqtdagi publik reyting sahifasi: /top/:slug
 *  - Sovg'alar do'koni: ballarni promokod/sovg'aga almashtirish (DM ichida).
 *  - Viktorinalar: to'g'ri javob uchun ball.
 *  - Auditoriya referal tizimi: har ishtirokchining shaxsiy taklif havolasi/kodi.
 */
import crypto from "node:crypto";
import { persist } from "./db.js";
import { fireEvent } from "./integrations.js";
import { getUserProfile, getUserFollowerCount } from "./services/instagram.js";
import { isTelegramChannelMember } from "./telegram.js";
import { splitKey } from "./outbound.js";
import { config } from "./config.js";

export const ACTIONS = {
  comment: { label: "Post / Reels ostiga komment", def: 5 },
  story_mention: { label: "Story'da belgilash (mention)", def: 20 },
  story_reply: { label: "Story'ga javob / reaksiya", def: 3 },
  referral: { label: "Do'stini taklif qilish (referal)", def: 30 },
  quiz: { label: "Viktorinaga to'g'ri javob", def: 10 },
  message: { label: "Direct'ga yozish (kuniga 1 marta)", def: 1 },
};

const FOLLOW_CACHE_MS = 6 * 60 * 60 * 1000;
const MAX_LOG = 300;
const MAX_REDEMPTIONS = 1000;

const today = () => new Date().toISOString().slice(0, 10);
const rid = (p) => `${p}_${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`;

export function ensureGame(tenant) {
  const g = (tenant.gamification ||= {});
  g.enabled ??= false;
  g.slug ||= crypto.randomBytes(5).toString("hex");
  g.title ||= "Faollik reytingi";
  g.description ??= "Kommentlar, story va do'stlaringizni taklif qilib ball to'plang — ballarni sovg'alarga almashtiring!";
  g.points ||= {};
  for (const [k, a] of Object.entries(ACTIONS)) g.points[k] ??= a.def;
  g.earlyBonus ||= { firstN: 10, points: 5 };
  g.dailyLimit ??= 100;
  g.followersOnly ??= false;
  g.minFollowers ??= 0;
  g.notifyOnAward ??= false;
  g.keywords ||= {};
  g.keywords.balance ||= "ball";
  g.keywords.top ||= "reyting";
  g.keywords.shop ||= "sovg'a";
  g.keywords.quiz ||= "viktorina";
  g.keywords.ref ||= "taklif";
  g.participants ||= {};
  g.rewards ||= [];
  g.redemptions ||= [];
  g.quizzes ||= [];
  g.mediaCounters ||= {};
  g.log ||= [];
  return g;
}

function newRefCode(g) {
  const used = new Set(Object.values(g.participants).map((p) => p.refCode));
  let code;
  do code = crypto.randomBytes(3).toString("hex").toUpperCase();
  while (used.has(code));
  return code;
}

export function getParticipant(tenant, key, { username = "", name = "" } = {}) {
  const g = ensureGame(tenant);
  let p = g.participants[key];
  if (!p) {
    p = g.participants[key] = {
      points: 0, earned: 0, spent: 0, counts: {},
      refCode: newRefCode(g), referredBy: "", referrals: 0,
      joinedAt: new Date().toISOString(),
    };
  }
  if (username) p.username = username;
  if (name) p.name = name;
  if (!p.username) {
    const prof = tenant.contactProfiles?.[splitKey(key).id];
    if (prof?.username) p.username = prof.username;
  }
  return p;
}

export function participantName(tenant, key) {
  const p = tenant.gamification?.participants?.[key];
  if (p?.username) return "@" + p.username;
  if (p?.name) return p.name;
  const m = tenant.contactMeta?.[key]?.fields?.name;
  if (m) return m;
  const id = splitKey(key).id;
  return "Ishtirokchi " + id.slice(-4);
}

export function leaderboard(tenant, limit = 50) {
  const g = ensureGame(tenant);
  return Object.entries(g.participants)
    .filter(([, p]) => p.points > 0)
    .sort((a, b) => b[1].points - a[1].points || String(a[1].joinedAt).localeCompare(String(b[1].joinedAt)))
    .slice(0, limit)
    .map(([key, p], i) => ({ rank: i + 1, key, name: participantName(tenant, key), points: p.points, channel: splitKey(key).chan }));
}

export function rankOf(tenant, key) {
  const g = ensureGame(tenant);
  const list = Object.entries(g.participants).filter(([, p]) => p.points > 0).sort((a, b) => b[1].points - a[1].points);
  const i = list.findIndex(([k]) => k === key);
  return { rank: i >= 0 ? i + 1 : null, total: list.length };
}

/** Obunachilik shartini tekshiradi (keshlangan). true/false. */
async function passesAudienceFilter(tenant, key, p) {
  const g = ensureGame(tenant);
  if (!g.followersOnly && !(g.minFollowers > 0)) return true;
  const { chan, id } = splitKey(key);
  const fresh = p.checkedAt && Date.now() - new Date(p.checkedAt).getTime() < FOLLOW_CACHE_MS;

  if (chan === "ig") {
    if (!fresh) {
      const prof = await getUserProfile(tenant, id).catch(() => null);
      if (prof) {
        p.follows = prof.is_user_follow_business === true;
        if (prof.username) p.username = prof.username;
        p.checkedAt = new Date().toISOString();
      }
      if (g.minFollowers > 0) {
        const fc = await getUserFollowerCount(tenant, id).catch(() => null);
        if (fc !== null) p.followers = fc;
      }
    }
    if (g.followersOnly && p.follows === false) return false;
    if (g.minFollowers > 0 && typeof p.followers === "number" && p.followers < g.minFollowers) return false;
    return true;
  }
  if (chan === "tg" && g.followersOnly && tenant.settings?.telegramChannel) {
    if (!fresh) {
      const member = await isTelegramChannelMember(tenant, id);
      if (member !== null) { p.follows = member; p.checkedAt = new Date().toISOString(); }
    }
    return p.follows !== false;
  }
  return true;
}

/**
 * Ishtirokchiga harakat uchun ball beradi. Qaytaradi: berilgan ball (0 — berilmadi).
 * ctx: { username, name, mediaId, points (qo'lda belgilangan miqdor), note }
 */
export async function award(tenant, key, action, ctx = {}) {
  const g = ensureGame(tenant);
  if (!g.enabled) return 0;
  let pts = Number(ctx.points ?? g.points[action] ?? 0);
  if (!(pts > 0)) return 0;

  const p = getParticipant(tenant, key, ctx);
  const d = today();

  if (action === "message") {
    if (p.lastMsgDay === d) return 0;
    p.lastMsgDay = d;
  }

  if (!(await passesAudienceFilter(tenant, key, p))) {
    persist(tenant);
    return 0;
  }

  if (action === "comment" && ctx.mediaId && g.earlyBonus?.firstN > 0) {
    const c = (g.mediaCounters[ctx.mediaId] = (g.mediaCounters[ctx.mediaId] || 0) + 1);
    if (c <= g.earlyBonus.firstN) pts += Number(g.earlyBonus.points || 0);
    const ids = Object.keys(g.mediaCounters);
    if (ids.length > 200) for (const k of ids.slice(0, ids.length - 200)) delete g.mediaCounters[k];
  }

  if (p.day !== d) { p.day = d; p.dayPoints = 0; }
  if (g.dailyLimit > 0) {
    const left = g.dailyLimit - (p.dayPoints || 0);
    if (left <= 0) { persist(tenant); return 0; }
    pts = Math.min(pts, left);
  }

  p.points += pts;
  p.earned = (p.earned || 0) + pts;
  p.dayPoints = (p.dayPoints || 0) + pts;
  p.counts[action] = (p.counts[action] || 0) + 1;
  p.lastAt = new Date().toISOString();

  g.log.unshift({ key, action, points: pts, at: p.lastAt, note: ctx.note || "" });
  g.log = g.log.slice(0, MAX_LOG);
  persist(tenant);
  fireEvent(tenant, "points_awarded", { contact: key, name: participantName(tenant, key), action, points: pts, total: p.points });
  return pts;
}

/** Admin qo'lda ball qo'shadi/ayiradi. */
export function adjustPoints(tenant, key, delta, note = "Qo'lda o'zgartirildi") {
  const g = ensureGame(tenant);
  const p = getParticipant(tenant, key);
  const d = Math.trunc(Number(delta) || 0);
  if (!d) return p;
  p.points = Math.max(0, p.points + d);
  if (d > 0) p.earned = (p.earned || 0) + d;
  g.log.unshift({ key, action: "manual", points: d, at: new Date().toISOString(), note });
  g.log = g.log.slice(0, MAX_LOG);
  persist(tenant);
  return p;
}

/** Yangi mavsum: barcha ballar nolga tushadi (ishtirokchilar va referal kodlari qoladi). */
export function resetSeason(tenant) {
  const g = ensureGame(tenant);
  for (const p of Object.values(g.participants)) { p.points = 0; p.dayPoints = 0; }
  g.mediaCounters = {};
  g.log.unshift({ key: "-", action: "season_reset", points: 0, at: new Date().toISOString() });
  g.seasonStartedAt = new Date().toISOString();
  persist(tenant);
}

// ============ Referal ============

export function referralLink(tenant, key) {
  const g = ensureGame(tenant);
  const p = getParticipant(tenant, key);
  const code = `g_${p.refCode}`;
  const { chan } = splitKey(key);
  if (chan === "ig" && tenant.meta?.igUsername) return `https://ig.me/m/${tenant.meta.igUsername}?ref=${code}`;
  if (chan === "tg" && tenant.settings?.telegramBotUsername) return `https://t.me/${tenant.settings.telegramBotUsername}?start=${code}`;
  if (chan === "fb" && tenant.meta?.pageId) return `https://m.me/${tenant.meta.pageId}?ref=${code}`;
  void g;
  return "";
}

/** Matndan yoki ref parametridan "g_ABC123" kodini ajratadi. */
export function extractRefCode(textOrRef) {
  const m = String(textOrRef || "").match(/\bg_([A-F0-9]{6})\b/i);
  return m ? m[1].toUpperCase() : "";
}

/**
 * Yangi kontakt referal kod bilan kelganda chaqiriladi.
 * Qaytaradi: { ok, reply } — reply yangi ishtirokchiga ko'rsatiladigan xabar.
 */
export async function handleReferral(tenant, newKey, code, ctx = {}) {
  const g = ensureGame(tenant);
  if (!g.enabled || !code) return { ok: false };
  const entry = Object.entries(g.participants).find(([, p]) => p.refCode === code);
  if (!entry) return { ok: false };
  const [refKey, refP] = entry;
  if (refKey === newKey) return { ok: false, reply: "Bu sizning shaxsiy taklif kodingiz 🙂 Uni do'stlaringizga yuboring!" };

  const existing = g.participants[newKey];
  if (existing?.referredBy || (existing && existing.earned > 0) || ctx.knownContact) {
    return { ok: false };
  }

  const np = getParticipant(tenant, newKey, ctx);
  np.referredBy = refKey;

  // Bot/soxta akkauntlardan himoya: IG'da profil real bo'lishi (username bor) shart,
  // "faqat obunachilar" yoqilgan bo'lsa — yangi odam ham obuna bo'lishi kerak.
  const { chan, id } = splitKey(newKey);
  if (chan === "ig") {
    const prof = await getUserProfile(tenant, id).catch(() => null);
    if (!prof?.username) { persist(tenant); return { ok: false }; }
    np.username = prof.username;
    if (g.followersOnly && prof.is_user_follow_business !== true) {
      np.pendingReferral = true;
      persist(tenant);
      return { ok: false, reply: "Xush kelibsiz! 🎉 Do'stingiz ball olishi uchun sahifamizga obuna bo'ling, so'ng \"" + g.keywords.balance + "\" deb yozing." };
    }
  }

  const pts = await award(tenant, refKey, "referral", { note: `Taklif: ${participantName(tenant, newKey)}` });
  if (pts > 0) {
    refP.referrals = (refP.referrals || 0) + 1;
    notifyReferrer(tenant, refKey, newKey);
  }
  persist(tenant);
  return {
    ok: pts > 0,
    referrerKey: refKey,
    points: pts,
    reply: `Xush kelibsiz! 🎉 Siz ${participantName(tenant, refKey)} taklifi bilan qo'shildingiz. O'zingiz ham ball to'plang — "${g.keywords.balance}" deb yozing.`,
  };
}

/** Taklif qilgan odam uchun "referral" triggerli flow'larni fon rejimida ishga tushiradi. */
function notifyReferrer(tenant, refKey, newKey) {
  import("./flows.js")
    .then(({ fireReferralFlows }) => fireReferralFlows(tenant, refKey, newKey))
    .catch((err) => console.error("[Referal flow]", err.message));
}

/** "Faqat obunachilar" rejimida kutib turgan referalni obuna bo'lgach tasdiqlaydi. */
export async function confirmPendingReferral(tenant, key) {
  const g = ensureGame(tenant);
  const p = g.participants[key];
  if (!p?.pendingReferral || !p.referredBy) return 0;
  const prof = await getUserProfile(tenant, splitKey(key).id).catch(() => null);
  if (prof?.is_user_follow_business !== true) return 0;
  p.pendingReferral = false;
  const pts = await award(tenant, p.referredBy, "referral", { note: `Taklif: ${participantName(tenant, key)}` });
  if (pts > 0) {
    g.participants[p.referredBy].referrals = (g.participants[p.referredBy].referrals || 0) + 1;
    notifyReferrer(tenant, p.referredBy, key);
  }
  persist(tenant);
  return pts;
}

// ============ Sovg'alar do'koni ============

export function rewardAvailable(r) {
  if (r.active === false) return false;
  if (Array.isArray(r.codes) && r.codesMode) return r.codes.length > 0;
  if (r.limit > 0) return (r.redeemedCount || 0) < r.limit;
  return true;
}

export function redeem(tenant, key, rewardId) {
  const g = ensureGame(tenant);
  const r = g.rewards.find((x) => x.id === rewardId);
  if (!r || !rewardAvailable(r)) return { ok: false, reply: "Afsuski, bu sovg'a hozircha tugagan 😔 Boshqasini tanlab ko'ring." };
  const p = getParticipant(tenant, key);
  if (p.points < r.cost) {
    return { ok: false, reply: `Bu sovg'a uchun ${r.cost} ball kerak. Sizda hozir ${p.points} ball bor — yana ${r.cost - p.points} ball to'plang! 💪` };
  }
  let code = "";
  if (r.codesMode) code = r.codes.shift() || "";
  p.points -= r.cost;
  p.spent = (p.spent || 0) + r.cost;
  r.redeemedCount = (r.redeemedCount || 0) + 1;
  const red = { id: rid("rd"), key, name: participantName(tenant, key), rewardId: r.id, rewardTitle: r.title, cost: r.cost, code, at: new Date().toISOString(), status: "new" };
  g.redemptions.unshift(red);
  g.redemptions = g.redemptions.slice(0, MAX_REDEMPTIONS);
  g.log.unshift({ key, action: "redeem", points: -r.cost, at: red.at, note: r.title });
  g.log = g.log.slice(0, MAX_LOG);
  persist(tenant);
  fireEvent(tenant, "reward_redeemed", { contact: key, name: red.name, reward: r.title, cost: r.cost, code, pointsLeft: p.points });

  const lines = [`🎁 Tabriklaymiz! Siz "${r.title}" sovg'asini oldingiz.`];
  if (code) lines.push(`\n🔑 Promokodingiz: ${code}`);
  if (r.message) lines.push(`\n${r.message}`);
  if (!code && !r.message) lines.push("\nTez orada menejerimiz siz bilan bog'lanadi.");
  lines.push(`\n\nQolgan balingiz: ${p.points}`);
  return { ok: true, redemption: red, reply: lines.join("") };
}

// ============ Viktorina ============

export function nextQuiz(tenant, key) {
  const g = ensureGame(tenant);
  const p = getParticipant(tenant, key);
  p.quizDone ||= {};
  return g.quizzes.find((q) => q.active !== false && !p.quizDone[q.id]) || null;
}

export async function answerQuiz(tenant, key, quizId, idx) {
  const g = ensureGame(tenant);
  const q = g.quizzes.find((x) => x.id === quizId);
  if (!q) return { reply: "Bu savol endi faol emas." };
  const p = getParticipant(tenant, key);
  p.quizDone ||= {};
  if (p.quizDone[q.id]) return { reply: "Siz bu savolga allaqachon javob bergansiz 🙂" };
  const correct = Number(idx) === Number(q.correct);
  p.quizDone[q.id] = correct ? "ok" : "fail";
  q.answers = (q.answers || 0) + 1;
  if (correct) q.correctAnswers = (q.correctAnswers || 0) + 1;
  let reply;
  if (correct) {
    const pts = await award(tenant, key, "quiz", { points: q.points || g.points.quiz, note: q.question.slice(0, 40) });
    reply = `✅ To'g'ri javob!${pts > 0 ? ` +${pts} ball. Jami: ${p.points}` : ""}`;
  } else {
    reply = `❌ Afsuski noto'g'ri. To'g'ri javob: ${q.options[q.correct] || "—"}`;
  }
  if (q.explanation) reply += `\n\n💡 ${q.explanation}`;
  persist(tenant);
  return { reply };
}

// ============ DM matnlari ============

export function publicBoardUrl(tenant) {
  const g = ensureGame(tenant);
  return `${config.baseUrl || "https://chat.voxo.uz"}/top/${g.slug}`;
}

export function balanceText(tenant, key) {
  const g = ensureGame(tenant);
  const p = getParticipant(tenant, key);
  const { rank, total } = rankOf(tenant, key);
  const link = referralLink(tenant, key);
  const lines = [
    `🏆 ${g.title}`,
    ``,
    `⭐ Sizning balingiz: ${p.points}`,
    rank ? `📊 Reytingdagi o'rningiz: #${rank} / ${total}` : `📊 Hali reytingda emassiz — birinchi ballingizni to'plang!`,
    ``,
    `👥 Do'stlaringizni taklif qiling va har biri uchun +${g.points.referral} ball oling:`,
    link || `Do'stingiz bizga "g_${p.refCode}" deb yozsin`,
  ];
  return lines.join("\n");
}

export function earnRulesText(tenant) {
  const g = ensureGame(tenant);
  const rows = Object.entries(ACTIONS)
    .filter(([k]) => g.points[k] > 0)
    .map(([k, a]) => `• ${a.label}: +${g.points[k]}`);
  if (g.earlyBonus?.firstN > 0 && g.earlyBonus.points > 0) rows.push(`• Birinchi ${g.earlyBonus.firstN} ta kommentga bonus: +${g.earlyBonus.points}`);
  return rows.join("\n");
}

export function topText(tenant, n = 10) {
  const g = ensureGame(tenant);
  const top = leaderboard(tenant, n);
  if (!top.length) return `🏆 ${g.title}\n\nHali hech kim ball to'plamagan — birinchi bo'ling! 🚀`;
  const medal = (i) => (i === 1 ? "🥇" : i === 2 ? "🥈" : i === 3 ? "🥉" : `${i}.`);
  return `🏆 ${g.title} — TOP ${n}\n\n` + top.map((r) => `${medal(r.rank)} ${r.name} — ${r.points}`).join("\n");
}

export function shopText(tenant) {
  const g = ensureGame(tenant);
  const list = g.rewards.filter(rewardAvailable);
  if (!list.length) return { text: "🎁 Sovg'alar do'koni hozircha bo'sh. Tez orada yangi sovg'alar qo'shiladi!", options: [] };
  return {
    text: "🎁 Sovg'alar do'koni\n\n" + list.map((r) => `• ${r.title} — ${r.cost} ball${r.description ? `\n   ${r.description}` : ""}`).join("\n") + "\n\nSovg'ani tanlang 👇",
    options: list.slice(0, 10).map((r) => ({ title: `${r.title}`.slice(0, 20), payload: `REDEEM:${r.id}` })),
  };
}

export function menuOptions(tenant) {
  const g = ensureGame(tenant);
  const opts = [
    { title: "⭐ Balim", payload: "GAME_BALANCE" },
    { title: "🏆 Reyting", payload: "GAME_TOP" },
  ];
  if (g.rewards.some(rewardAvailable)) opts.push({ title: "🎁 Sovg'alar", payload: "GAME_SHOP" });
  if (g.quizzes.some((q) => q.active !== false)) opts.push({ title: "❓ Viktorina", payload: "GAME_QUIZ" });
  return opts;
}

export { rid };
