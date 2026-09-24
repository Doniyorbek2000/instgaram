/**
 * Interaktiv avtomatlashtirish marshrutlagichi — AI'dan OLDIN ishlaydi.
 * Tartib: referal → ochiq forma sessiyasi → tugma (payload) → forma kalit so'zi
 * → geymifikatsiya buyruqlari. Hech biri mos kelmasa null qaytadi va xabar
 * odatdagidek kalit so'z qoidalari / AI'ga o'tadi.
 */
import { persist } from "./db.js";
import * as game from "./gamification.js";
import { ensureForms, findFormByTrigger, startForm, handleFormInput, activeSession } from "./forms.js";
import { ensureRules } from "./rules.js";
import { isTelegramChannelMember, telegramChannelUrl } from "./telegram.js";
import { checkFollowerStatus } from "./services/instagram.js";
import { splitKey } from "./outbound.js";
import { ruleReplyOptions, onRuleDelivered, onGateBlocked } from "./ruleActions.js";

// Oxirgi yuborilgan variantlar — WhatsApp kabi tugmasiz kanallarda mijoz "2" deb
// yozsa, uni 2-variant payload'iga aylantirish uchun. Xotirada (qayta ishga
// tushganda yo'qolishi muammo emas — mijoz shunchaki qayta so'raydi).
const lastOptions = new Map();
const OPTIONS_TTL_MS = 24 * 60 * 60 * 1000;

export function rememberOptions(tenant, key, options) {
  const opts = (options || []).filter((o) => o && o.payload);
  const k = `${tenant.id}|${key}`;
  if (!opts.length) { lastOptions.delete(k); return; }
  lastOptions.set(k, { opts, at: Date.now() });
  if (lastOptions.size > 20000) lastOptions.delete(lastOptions.keys().next().value);
}

export function resolvePayload(tenant, key, text) {
  const k = `${tenant.id}|${key}`;
  const saved = lastOptions.get(k);
  if (!saved || Date.now() - saved.at > OPTIONS_TTL_MS) return "";
  const t = String(text || "").trim();
  if (/^\d{1,2}$/.test(t)) return saved.opts[Number(t) - 1]?.payload || "";
  // Tugma nomini qo'lda yozsa ham (emoji, tinish belgilarisiz) taniymiz: "obuna boldim" → "Obuna bo'ldim ✅"
  const norm = (v) => String(v).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const nt = norm(t);
  if (!nt) return "";
  const byTitle = saved.opts.find((o) => norm(o.title) === nt);
  return byTitle?.payload || "";
}

function quizMessage(q) {
  return {
    reply: `❓ ${q.question}\n\n` + q.options.map((o, i) => `${i + 1}) ${o}`).join("\n"),
    options: q.options.map((o, i) => ({ title: `${i + 1}) ${o}`.slice(0, 20), payload: `QUIZ:${q.id}:${i}` })),
  };
}

/** Obuna darvozasi xabari (Telegram kanal yoki Instagram profil). */
export function gateMessage(tenant, channel, rule) {
  const text = rule.notFollowingMessage || "Sovg'ani olish uchun avval sahifamizga obuna bo'ling, so'ng tugmani bosing 👇";
  const btn = rule.notFollowingButton || "Obuna bo'ldim ✅";
  if (channel === "tg") {
    const url = telegramChannelUrl(tenant);
    return { reply: text, options: [...(url ? [{ title: "📢 Kanalga o'tish", url }] : []), { title: btn, payload: `CHECK_SUB:${rule.id}` }] };
  }
  return { reply: text, options: [{ title: btn, payload: `CHECK_FOLLOW:${rule.id}` }] };
}

/**
 * Qoida "faqat obunachilarga" bo'lsa — obunani tekshiradi.
 * Qaytaradi: true (o'tdi) / false (obuna emas) / null (tekshirib bo'lmadi → o'tkazamiz).
 */
export async function passesGate(tenant, channel, recipientId) {
  if (channel === "tg") {
    if (!tenant.settings?.telegramChannel) return null;
    return isTelegramChannelMember(tenant, recipientId);
  }
  if (channel === "ig") return checkFollowerStatus(tenant, recipientId);
  return null;
}

function bumpRule(tenant, rule, field) {
  rule.stats ||= {};
  rule.stats[field] = (rule.stats[field] || 0) + 1;
}

/**
 * ctx: { text, payload, ref, profile: {username,name}, isNewContact }
 * Qaytaradi: null yoki { reply, options, prefix }
 *  - prefix: javob emas, AI javobining boshiga qo'shiladigan matn (masalan referal salomi)
 */
export async function runAutomations(tenant, key, ctx) {
  const { chan, id: recipientId } = splitKey(key);
  const text = String(ctx.text || "").trim();
  const lower = text.toLowerCase();
  const g = game.ensureGame(tenant);
  ensureForms(tenant);
  const payload = ctx.payload || resolvePayload(tenant, key, text);
  const profile = ctx.profile || {};

  // 1. Referal (ig.me ?ref=, t.me ?start=, m.me ?ref= yoki birinchi xabardagi kod)
  let prefix = "";
  const code = game.extractRefCode(ctx.ref) || (ctx.isNewContact ? game.extractRefCode(text) : "");
  if (code && g.enabled) {
    const r = await game.handleReferral(tenant, key, code, { ...profile, knownContact: !ctx.isNewContact });
    prefix = r.reply || "";
    const onlyCode = !text || lower === `g_${code}`.toLowerCase() || lower === "/start";
    if (onlyCode) {
      return {
        reply: (prefix || `Xush kelibsiz! 🎉`) + `\n\nBall to'plash yo'llari:\n${game.earnRulesText(tenant)}`,
        options: game.menuOptions(tenant),
      };
    }
  }

  // 2. Ochiq forma sessiyasi — mijoz savollarga javob bermoqda
  if (activeSession(tenant, key)) {
    const r = handleFormInput(tenant, key, { text, payload });
    if (r) return r;
  }

  // 3. Tugma bosilgan (payload)
  if (payload) {
    if (payload.startsWith("FORM:")) {
      const form = tenant.forms.list.find((f) => f.id === payload.slice(5) && f.active !== false);
      if (form) return startForm(tenant, key, form, chan);
    }
    if (payload.startsWith("CHECK_SUB:")) {
      const rule = ensureRules(tenant).find((r) => r.id === payload.slice(10));
      if (rule) {
        const ok = await passesGate(tenant, chan, recipientId);
        if (ok === false) {
          const gm = gateMessage(tenant, chan, rule);
          onGateBlocked(tenant, rule, key, gm.options.filter((o) => o.payload));
          return { reply: "Siz hali kanalimizga obuna bo'lmabsiz 🥺 Obuna bo'ling va tugmani qayta bosing:", options: gm.options };
        }
        bumpRule(tenant, rule, "gatePassed");
        bumpRule(tenant, rule, "sent");
        onRuleDelivered(tenant, rule, key);
        return { reply: rule.privateReply || "Obunangiz tasdiqlandi! 🎉", options: ruleReplyOptions(rule) };
      }
    }
    if (g.enabled) {
      if (payload === "GAME_BALANCE") return { reply: game.balanceText(tenant, key), options: game.menuOptions(tenant).filter((o) => o.payload !== "GAME_BALANCE") };
      if (payload === "GAME_TOP") {
        return { reply: game.topText(tenant, 10), options: [{ title: "📊 To'liq reyting", url: game.publicBoardUrl(tenant) }] };
      }
      if (payload === "GAME_SHOP") { const s = game.shopText(tenant); return { reply: s.text, options: s.options }; }
      if (payload === "GAME_RULES") return { reply: `📜 Ball to'plash yo'llari:\n${game.earnRulesText(tenant)}`, options: game.menuOptions(tenant) };
      if (payload === "GAME_QUIZ") {
        const q = game.nextQuiz(tenant, key);
        return q ? quizMessage(q) : { reply: "Siz barcha savollarga javob berdingiz 🎉 Yangi viktorinalarni kuting!", options: game.menuOptions(tenant) };
      }
      if (payload.startsWith("REDEEM:")) {
        const r = game.redeem(tenant, key, payload.slice(7));
        if (r.ok && tenant.settings?.telegramChatId) {
          const { sendTelegram } = await import("./notify.js");
          sendTelegram(tenant.settings.telegramChatId, `🎁 <b>Sovg'a olindi!</b>\n\n<b>Kim:</b> ${game.participantName(tenant, key)}\n<b>Sovg'a:</b> ${r.redemption.rewardTitle}\n<b>Ball:</b> ${r.redemption.cost}${r.redemption.code ? `\n<b>Kod:</b> ${r.redemption.code}` : ""}`).catch(() => {});
        }
        return { reply: r.reply, options: game.menuOptions(tenant) };
      }
      if (payload.startsWith("QUIZ:")) {
        const [, quizId, idx] = payload.split(":");
        const r = await game.answerQuiz(tenant, key, quizId, idx);
        const next = game.nextQuiz(tenant, key);
        return { reply: r.reply, options: next ? [{ title: "➡️ Keyingi savol", payload: "GAME_QUIZ" }, ...game.menuOptions(tenant).filter((o) => o.payload !== "GAME_QUIZ")] : game.menuOptions(tenant) };
      }
    }
  }

  // 4. Forma kalit so'zi
  const form = findFormByTrigger(tenant, text);
  if (form) return startForm(tenant, key, form, chan);

  // 5. Geymifikatsiya buyruqlari (kalit so'zlar)
  if (g.enabled && text) {
    const kw = g.keywords;
    const is = (w) => w && lower === String(w).toLowerCase().trim();
    if (is(kw.balance) || is("ballarim") || is("mening balim")) {
      await game.confirmPendingReferral(tenant, key);
      return { reply: game.balanceText(tenant, key), options: game.menuOptions(tenant).filter((o) => o.payload !== "GAME_BALANCE") };
    }
    if (is(kw.top) || is("top")) return { reply: game.topText(tenant, 10), options: [{ title: "📊 To'liq reyting", url: game.publicBoardUrl(tenant) }] };
    if (is(kw.shop) || is("sovgalar") || is("sovg'alar")) { const s = game.shopText(tenant); return { reply: s.text, options: s.options }; }
    if (is(kw.quiz)) {
      const q = game.nextQuiz(tenant, key);
      return q ? quizMessage(q) : { reply: "Hozircha yangi savollar yo'q 🙂", options: game.menuOptions(tenant) };
    }
    if (is(kw.ref)) return { reply: game.balanceText(tenant, key), options: game.menuOptions(tenant) };

    // Passiv: Direct'ga yozgani uchun kunlik ball (javobni kutmaydi)
    game.award(tenant, key, "message", profile).catch(() => {});
  }

  return prefix ? { prefix } : null;
}
