import { generateReply } from "./ai.js";
import { botEnabled } from "./credits.js";
import { notifyHandoff, notifyHotLead } from "./notify.js";
import { findKeywordRule, aiRules } from "./rules.js";
import { classifyIntent } from "./ai.js";
import { ruleReplyOptions, onRuleDelivered, onGateBlocked } from "./ruleActions.js";
import { persist } from "./db.js";
import { runAutomations, rememberOptions, gateMessage, passesGate, resolvePayload } from "./automation.js";
import { handleFlowInbound, findFlowTrigger, aiFlowCandidates, startFlow, logToInbox } from "./flows.js";
import { renderTemplate } from "./templating.js";
import { fireEvent } from "./integrations.js";
import { chanShort } from "./outbound.js";
import {
  recordMessage,
  isHandoffRequest,
  isManual,
  startHandoff,
} from "./engagement.js";

const HANDOFF_REPLY =
  "Iltimos, biroz kuting 🙏 Sizni jonli operatorimizga uladik — tez orada javob berishadi.";

/**
 * Inbox uchun chat key formatini yaratadi: "kanal:userId"
 * Bu format inbox.js da kanal va ID ni avtomatik ajratib oladi.
 */
function inboxKey(channel, chatKey) {
  const short = chanShort(channel);
  // Agar allaqachon "kanal:" prefiksi bo'lsa — qayta qo'shmaylik
  if (chatKey.startsWith(short + ":")) return chatKey;
  return `${short}:${chatKey}`;
}

/** Avtomatik (AI bo'lmagan) javobni Live Inbox'da ko'rinishi uchun suhbat tarixiga yozadi. */
function logExchange(tenant, fullKey, userText, reply) {
  tenant.chats ||= {};
  const list = (tenant.chats[fullKey] ||= []);
  const at = new Date().toISOString();
  if (userText) list.push({ role: "user", text: userText, at });
  if (reply) list.push({ role: "assistant", text: reply, at });
  tenant.chats[fullKey] = list.slice(-16);
  persist(tenant);
}

/** Variantlarni yagona {title, payload|url} ko'rinishiga keltiradi (icebreaker stringlari ham). */
function normOptions(options) {
  return (options || [])
    .map((o) => (typeof o === "string" ? { title: o, payload: o } : o))
    .filter((o) => o && o.title);
}

/**
 * Kiruvchi xabarni to'liq qayta ishlaydi:
 * obuna tekshiruvi → operator rejimi → handoff → interaktiv avtomatlashtirish
 * (referal, formalar, geymifikatsiya) → kalit so'z qoidalari → AI javob.
 *
 * Qaytaradi: { reply, quickReplies } yoki reply=null (javob yubormaslik kerak).
 * channel: "instagram" | "facebook" | "whatsapp" | "telegram"
 * payload — bosilgan tugma qiymati; ref — referal parametri; profile — {username, name}
 */
export async function processMessage(tenant, channel, chatKey, { text = "", media = [], payload = "", ref = "", profile = {}, messageId = "" }) {
  // 1. Obuna faol emasmi — bot javob bermaydi
  if (!botEnabled(tenant)) {
    console.log(
      `[${channel}] ${tenant.businessName}: obuna faol emas — javob berilmadi`
    );
    return { reply: null };
  }

  // Instagram salomlashuv tugmasi (ice breaker) bosildi — savol matni mijoz
  // xabari sifatida ishlanadi (AI yoki kalit so'z qoidasi javob beradi)
  if (payload?.startsWith("IB:")) {
    const ib = tenant.settings?.icebreakers?.[Number(payload.slice(3))];
    const question = typeof ib === "string" ? ib : ib?.question;
    if (question) {
      text = question;
      payload = "";
    }
  }

  // Inbox da ko'rsatish uchun kanal prefiksi bilan key
  const fullKey = inboxKey(channel, chatKey);
  const isNewContact = !tenant.stats?.customers?.[fullKey];
  const shownText = text || (payload ? `🔘 ${payload}` : "");

  // 2. Statistika va mijozlar tarixiga yozish
  recordMessage(tenant, channel, fullKey, shownText);
  if (isNewContact) fireEvent(tenant, "new_contact", { contact: fullKey, channel, username: profile.username || "", name: profile.name || "" });

  // 3. Chat qo'lda rejimda bo'lsa (operator boshqarmoqda) — bot jim
  if (isManual(tenant, fullKey)) {
    console.log(`[${channel}] ${tenant.businessName}: ${fullKey} operator rejimida`);
    return { reply: null };
  }

  // 4. Mijoz operatorni chaqirdimi
  if (isHandoffRequest(text)) {
    startHandoff(tenant, channel, fullKey);
    notifyHandoff(tenant, channel, fullKey).catch(() => {});
    console.log(`[${channel}] ${tenant.businessName}: ${fullKey} operator chaqirdi`);
    return { reply: HANDOFF_REPLY };
  }

  // 5a. Flow builder: tugma bosilishi, "ma'lumot yig'ish" blokiga javob,
  // referal havola yoki yangi kontakt triggerlari. Flow xabarlarni o'zi yuboradi.
  const flowCtx = { text, userText: shownText, profile, messageId };
  try {
    const flowPayload = payload || resolvePayload(tenant, fullKey, text);
    let handled = await handleFlowInbound(tenant, fullKey, { text, payload: flowPayload }, flowCtx);
    if (!handled) {
      const trig =
        (ref && findFlowTrigger(tenant, "ref", { ref })) ||
        (isNewContact && findFlowTrigger(tenant, "new_contact", {})) ||
        null;
      if (trig) {
        await startFlow(tenant, fullKey, trig.flow, flowCtx);
        handled = true;
      }
    }
    if (handled) {
      if (flowCtx.userText) logToInbox(tenant, fullKey, flowCtx);
      persist(tenant);
      return { reply: null };
    }
  } catch (err) {
    console.error(`[Flow] ${tenant.businessName}: xato:`, err.message);
  }

  // 5. Interaktiv avtomatlashtirish: referal, lid formalari, geymifikatsiya, tugmalar
  let prefix = "";
  try {
    const auto = await runAutomations(tenant, fullKey, { text, payload, ref, profile, isNewContact });
    if (auto?.reply) {
      const options = normOptions(auto.options);
      rememberOptions(tenant, fullKey, options);
      logExchange(tenant, fullKey, shownText, auto.reply);
      return { reply: auto.reply, quickReplies: options };
    }
    prefix = auto?.prefix || "";
  } catch (err) {
    console.error(`[Automation] ${tenant.businessName}: xato:`, err.message);
  }

  // Tugma bosildi-yu, hech qaysi avtomatlashtirish uni tanimadi (eski tugma va h.k.) —
  // AI'ga bo'sh matn yubormaymiz.
  if (!text && !media.length) return { reply: prefix || null };

  // 6. Kalit so'z bo'yicha flow yoki qoida. Aniq kalit so'z topilmasa — AI
  // triggerli flow va qoidalar birgalikda BITTA AI so'rovi bilan tekshiriladi.
  let rule = null;
  let flowHit = findFlowTrigger(tenant, "keyword", { text });
  if (!flowHit) rule = findKeywordRule(tenant, text);
  if (!flowHit && !rule) {
    const smart = await classifyIntent(tenant, text, [...aiFlowCandidates(tenant, "keyword"), ...aiRules(tenant, "keyword_dm")]);
    if (smart?.flow) flowHit = smart;
    else rule = smart;
  }
  if (flowHit) {
    try {
      await startFlow(tenant, fullKey, flowHit.flow, flowCtx);
      if (flowCtx.userText) logToInbox(tenant, fullKey, flowCtx);
      persist(tenant);
      return { reply: null };
    } catch (err) {
      console.error(`[Flow] ${tenant.businessName}: xato:`, err.message);
    }
  }
  if (rule) {
    console.log(`[${channel}] ${tenant.businessName}: Qoida ishga tushdi ("${rule.name}")`);
    rule.stats ||= {};
    rule.stats.triggered = (rule.stats.triggered || 0) + 1;
    if (rule.privateReply) {
      const short = chanShort(channel);
      if (rule.requireFollow && (short === "ig" || short === "tg")) {
        const ok = await passesGate(tenant, short, fullKey.slice(fullKey.indexOf(":") + 1));
        if (ok === false) {
          const gm = gateMessage(tenant, short, rule);
          const options = normOptions(gm.options);
          onGateBlocked(tenant, rule, fullKey, options);
          rememberOptions(tenant, fullKey, options);
          logExchange(tenant, fullKey, shownText, gm.reply);
          return { reply: gm.reply, quickReplies: options };
        }
      }
      rule.stats.sent = (rule.stats.sent || 0) + 1;
      const options = ruleReplyOptions(rule);
      onRuleDelivered(tenant, rule, fullKey);
      rememberOptions(tenant, fullKey, options);
      const ruleReply = renderTemplate(rule.privateReply, tenant, fullKey);
      logExchange(tenant, fullKey, shownText, ruleReply);
      return { reply: ruleReply, quickReplies: options };
    }
  }

  // 7. Harid niyati (Hot Lead / Buyer) yoki Telefon raqam/email qoldirilganda aniqlash
  const lowerText = text.toLowerCase();
  const isBuyIntent = ["sotib", "olmoqchi", "zakaz", "buyurtma", "karta", "to'lov", "rekvizit", "dastavka", "olaman"].some((k) => lowerText.includes(k));

  // Telefon raqami tekshiruvi (+998901234567, 90 123 45 67, etc.)
  const phoneMatch = text.match(/(?:\+?998|8)?[\s-]?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/);
  const emailMatch = text.match(/[\w.-]+@[\w.-]+\.[a-z]{2,}/i);

  if (phoneMatch || emailMatch || isBuyIntent) {
    tenant.leads ||= [];
    const leadContact = phoneMatch ? phoneMatch[0].trim() : (emailMatch ? emailMatch[0].trim() : "");
    if (leadContact && !tenant.leads.some((l) => l.key === fullKey && l.contact === leadContact)) {
      tenant.leads.unshift({
        id: `lead_${Date.now()}`,
        key: fullKey,
        channel,
        contact: leadContact,
        lastMessage: text.slice(0, 120),
        status: "new",
        createdAt: new Date().toISOString(),
      });
      persist(tenant);
      fireEvent(tenant, "lead", { contact: fullKey, channel, phoneOrEmail: leadContact, message: text.slice(0, 300) });
    }
    notifyHotLead(tenant, channel, fullKey, text + (leadContact ? `\n📞 Kontakt: ${leadContact}` : "")).catch(() => {});
  }

  // 8. AI javob — fullKey bilan saqlanadi (inbox ko'ra olsin)
  // Mijozning shu chatKey bo'yicha BIRINCHI xabari ekanini generateReply chaqirilishidan
  // OLDIN aniqlaymiz — chunki generateReply o'zi tarixga yozib qo'yadi.
  const isFirstMessage = !(tenant.chats?.[fullKey]?.length > 0);
  let reply = await generateReply(tenant, fullKey, { text, media });
  if (prefix && reply) reply = `${prefix}\n\n${reply}`;

  // 9. Instagram'da birinchi xabarga — sozlangan bo'lsa — tezkor savol tugmalari qo'shiladi
  const icebreakers =
    channel === "instagram" && tenant.settings?.icebreakersQuick !== false
      ? (tenant.settings?.icebreakers || [])
          .map((x, i) => ({ title: String(typeof x === "string" ? x : x?.question || "").slice(0, 20), payload: `IB:${i}` }))
          .filter((o) => o.title)
      : [];
  if (isFirstMessage && icebreakers.length) {
    rememberOptions(tenant, fullKey, icebreakers);
    return { reply, quickReplies: icebreakers };
  }
  return { reply };

}
