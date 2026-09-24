import { commentReplyText, commentPrivateReplyText } from "../autoReply.js";
import { sendReply, optionsAsText } from "../outbound.js";
import { classifyIntent } from "../ai.js";
import { ruleReplyOptions, onRuleDelivered, onGateBlocked } from "../ruleActions.js";
import { findFlowTrigger, aiFlowCandidates, startFlow, pickPublicReply as pickFlowPublicReply } from "../flows.js";
import { renderTemplate } from "../templating.js";
import { resolvePayload, rememberOptions } from "../automation.js";
import { award, confirmPendingReferral } from "../gamification.js";
import { processMessage, commentAiReply } from "../respond.js";
import { botEnabled } from "../credits.js";
import { isDuplicate } from "../dedup.js";
import { fetchAsBase64 } from "../media.js";
import { persist } from "../db.js";
import {
  findCommentRule,
  findStoryMentionRule,
  findStoryReplyRule,
  pickPublicReply,
  ensureRules,
  isCatchAll,
  aiRules,
} from "../rules.js";
import {
  replyToComment,
  privateReplyToComment,
  sendDirectMessage,
  checkFollowerStatus,
  getFollowStatus,
  showTyping,
  getUserProfile,
  likeComment,
} from "../services/instagram.js";

/**
 * Live Inbox'da real ism/username ko'rsatish uchun IGSID'ning profilini bir
 * marta olib keshga saqlaydi (keyingi xabarlarda qayta so'rov yubormaslik uchun).
 */
async function ensureContactProfile(tenant, igsid) {
  tenant.contactProfiles ||= {};
  if (tenant.contactProfiles[igsid]) return;
  const profile = await getUserProfile(tenant, igsid);
  if (profile && (profile.username || profile.name)) {
    tenant.contactProfiles[igsid] = {
      username: profile.username || "",
      name: profile.name || "",
      profilePic: profile.profile_pic || "",
      fetchedAt: new Date().toISOString(),
    };
    await persist(tenant);
  }
}

/** Komment webhookida keladigan username'ni (API so'rovsiz, tekin) keshga yozadi. */
function cacheCommentProfile(tenant, fromId, username) {
  if (!fromId || !username) return false;
  tenant.contactProfiles ||= {};
  const existing = tenant.contactProfiles[fromId];
  if (existing?.username === username) return false;
  tenant.contactProfiles[fromId] = { ...existing, username, fetchedAt: new Date().toISOString() };
  return true;
}

/** IG/Messenger xabaridagi biriktirmalarni (rasm/ovoz/video) yuklab oladi */
export async function loadAttachments(attachments = []) {
  const media = [];
  for (const att of attachments) {
    if (!["image", "video", "audio"].includes(att.type)) continue;
    const url = att.payload?.url;
    if (!url) continue;
    try {
      media.push(await fetchAsBase64(url));
    } catch (err) {
      console.error("Biriktirmani yuklab bo'lmadi:", err.message);
    }
  }
  return media;
}

/** Instagram webhook (object: "instagram") hodisalarini qayta ishlaydi. */
export async function handleInstagramEntry(tenant, entry) {
  // Direct (DM) xabarlar, Story Mention & Quick Reply'lar
  for (const event of entry.messaging || []) {
    const senderId = event.sender?.id;
    const message = event.message;
    const postback = event.postback;
    if (!senderId) continue;
    if (senderId === tenant.meta.igUserId) continue;

    // Postback yoki Quick Reply bosilganda. Tugmalar o'rniga raqamli variant
    // yuborilgan bo'lsa, mijoz "1" yoki tugma nomini yozadi — uni ham tugma deb olamiz.
    const typedGate = !message?.quick_reply && !postback && message?.text && !message.is_echo
      ? resolvePayload(tenant, `ig:${senderId}`, message.text)
      : "";
    const qrPayload = message?.quick_reply?.payload || postback?.payload || (typedGate.startsWith("CHECK_FOLLOW") ? typedGate : "");
    // ig.me/m/<username>?ref=... havolasi orqali kelganda (auditoriya referal tizimi)
    const refParam = event.referral?.ref || message?.referral?.ref || postback?.referral?.ref || "";
    if (qrPayload.startsWith("CHECK_FOLLOW")) {
      console.log(`[IG Follower Gate] ${tenant.businessName}: ${senderId} obunani tekshirishni so'radi (${qrPayload})`);
      showTyping(tenant, senderId); // Kosmetik — javob tezligiga ta'sir qilmasin

      const isFollowing = await checkFollowerStatus(tenant, senderId);
      const ruleId = qrPayload.split(":")[1];
      const rules = ensureRules(tenant);
      const rule = rules.find((r) => r.id === ruleId) || rules.find((r) => r.type === "comment_to_dm" && r.requireFollow);

      if (isFollowing) {
        console.log(`[IG Follower Gate] ✅ ${senderId} obuna bo'lgani tasdiqlandi!`);
        const rewardText = rule?.privateReply || "Obunangiz tasdiqlandi! 🎉 Va'da qilingan material va sovg'angiz qabul qiling! 😊";
        if (rule) {
          rule.stats ||= {};
          rule.stats.gatePassed = (rule.stats.gatePassed || 0) + 1;
          rule.stats.sent = (rule.stats.sent || 0) + 1;
          persist(tenant);
        }
        await sendReply(tenant, "instagram", senderId, rewardText, ruleReplyOptions(rule));
        onRuleDelivered(tenant, rule, `ig:${senderId}`);
        confirmPendingReferral(tenant, `ig:${senderId}`).catch(() => {});
      } else {
        console.log(`[IG Follower Gate] ❌ ${senderId} hali obuna bo'lmagan`);
        const profile = tenant.meta?.igUsername ? `\n\n👉 instagram.com/${tenant.meta.igUsername}` : "";
        const warnText = `Siz hali sahifamizga obuna bo'lmabsiz 🥺 Iltimos, profilimizga obuna bo'ling va so'ng quyidagi tugmani bosing:${profile}`;
        const btnText = rule?.notFollowingButton || "Obuna bo'ldim ✅";
        const gateOptions = [{ title: btnText, payload: qrPayload }];
        await sendReply(tenant, "instagram", senderId, warnText, gateOptions);
        rememberOptions(tenant, `ig:${senderId}`, gateOptions);
        onGateBlocked(tenant, rule, `ig:${senderId}`, gateOptions);
      }
      continue;
    }

    // Xabarsiz hodisalar: tugma (postback) yoki faqat referal (ig.me?ref=)
    if (!message && (qrPayload || refParam)) {
      ensureContactProfile(tenant, senderId);
      const { reply, quickReplies } = await processMessage(tenant, "instagram", senderId, { text: "", payload: qrPayload, ref: refParam });
      if (reply) await sendReply(tenant, "instagram", senderId, reply, quickReplies);
      continue;
    }

    if (!message || message.is_echo) continue;
    if (isDuplicate(message.mid)) continue; // takroriy webhook
    const key = `ig:${senderId}`;

    // 1. Story mention tekshiruvi
    const isStoryMention =
      message.attachments?.some((a) => a.type === "story_mention") ||
      message.text?.includes("mentioned you in their story");

    if (isStoryMention) {
      console.log(`[IG Story Mention] ${tenant.businessName}: ${senderId} sizni story'da belgiladi!`);
      const pts = await award(tenant, key, "story_mention").catch(() => 0);
      const mentionFlow = findFlowTrigger(tenant, "story_mention", {});
      if (mentionFlow) {
        await startFlow(tenant, key, mentionFlow.flow, { userText: "🌟 Story'da belgiladi" });
        continue;
      }
      const storyRule = findStoryMentionRule(tenant);
      if (storyRule && storyRule.privateReply) {
        storyRule.stats ||= {};
        storyRule.stats.triggered = (storyRule.stats.triggered || 0) + 1;
        storyRule.stats.sent = (storyRule.stats.sent || 0) + 1;
        persist(tenant);
        const extra = pts > 0 ? `\n\n⭐ +${pts} ball! Balingizni ko'rish uchun "${tenant.gamification.keywords.balance}" deb yozing.` : "";
        await sendReply(tenant, "instagram", senderId, renderTemplate(storyRule.privateReply, tenant, key) + extra, ruleReplyOptions(storyRule));
        onRuleDelivered(tenant, storyRule, key);
        continue;
      }
      if (pts > 0) {
        await sendDirectMessage(tenant, senderId, `Story'da belgilaganingiz uchun rahmat! 🌟 +${pts} ball.`);
        continue;
      }
    }

    // 2. Story reply tekshiruvi (Story'ga javob/reaksiya)
    const isStoryReply = Boolean(message.reply_to?.story || message.attachments?.some((a) => a.type === "story_reply"));
    if (isStoryReply) {
      award(tenant, key, "story_reply").catch(() => {});
      let storyFlow = findFlowTrigger(tenant, "story_reply", { text: message.text || "" });
      if ((!storyFlow || storyFlow.catchAll) && message.text) {
        storyFlow = (await classifyIntent(tenant, message.text, aiFlowCandidates(tenant, "story_reply"))) || storyFlow;
      }
      if (storyFlow) {
        await startFlow(tenant, key, storyFlow.flow, { text: message.text || "", userText: `🗨️ Story javobi: ${message.text || ""}` });
        continue;
      }
      let storyReplyRule = findStoryReplyRule(tenant, message.text);
      if ((!storyReplyRule || isCatchAll(storyReplyRule)) && message.text) {
        storyReplyRule = (await classifyIntent(tenant, message.text, aiRules(tenant, "story_reply"))) || storyReplyRule;
      }
      if (storyReplyRule && storyReplyRule.privateReply) {
        console.log(`[IG Story Reply] ${tenant.businessName}: ${senderId} story'ga javob berdi`);
        storyReplyRule.stats ||= {};
        storyReplyRule.stats.triggered = (storyReplyRule.stats.triggered || 0) + 1;
        storyReplyRule.stats.sent = (storyReplyRule.stats.sent || 0) + 1;
        persist(tenant);
        await sendReply(tenant, "instagram", senderId, renderTemplate(storyReplyRule.privateReply, tenant, key), ruleReplyOptions(storyReplyRule));
        onRuleDelivered(tenant, storyReplyRule, key);
        continue;
      }
    }

    const text = message.text || "";
    const media = await loadAttachments(message.attachments);
    if (!text && !qrPayload && media.length === 0) continue;

    console.log(
      `[IG Direct] ${tenant.businessName}: ${senderId} -> "${text}"${qrPayload ? ` [${qrPayload}]` : ""} (${media.length} media)`
    );
    // Fon rejimida (javob tezligiga ta'sir qilmasdan) — Live Inbox'da real ism
    // ko'rsatish uchun kontakt profilini bir martalik olib keshlaymiz. "Yozmoqda..."
    // belgisi ham sof kosmetik bo'lgani uchun endi kutilmaydi (ilgari bu Meta'ga
    // qo'shimcha tarmoq so'rovini AI javobidan OLDIN kutib turishga majbur qilardi).
    ensureContactProfile(tenant, senderId);
    showTyping(tenant, senderId);
    const cached = tenant.contactProfiles?.[senderId];
    const { reply, quickReplies } = await processMessage(tenant, "instagram", senderId, {
      text,
      media,
      payload: qrPayload,
      ref: refParam,
      messageId: message.mid || "",
      profile: { username: cached?.username || "", name: cached?.name || "" },
    });
    if (reply) {
      const ok = await sendReply(tenant, "instagram", senderId, reply, quickReplies);
      if (ok) console.log(`[IG Direct Javob] ${tenant.businessName} -> ${senderId}: OK ✅`);
      else console.error(`[IG Direct Xatolik] ${tenant.businessName} -> ${senderId}: Meta xabar yubormadi`);
    }
  }

  // Kommentlar va jonli efir kommentlari (Comment-to-DM, Follower Gate, Flow triggerlari)
  for (const change of entry.changes || []) {
    if (change.field !== "comments" && change.field !== "live_comments") continue;
    const isLive = change.field === "live_comments";
    const comment = change.value;
    if (!comment?.id) continue;
    if (comment.from?.id === tenant.meta.igUserId) continue;
    if (isDuplicate(`c:${comment.id}`)) continue;
    if (!botEnabled(tenant)) continue;

    const mediaId = comment.media?.id || "";
    console.log(
      `[IG Komment] ${tenant.businessName}: @${comment.from?.username || "?"}: "${comment.text}" (post: ${mediaId || "any"})`
    );

    // Webhook'da kelgan username'ni Live Inbox uchun tekin keshlaymiz (API so'rovsiz)
    if (cacheCommentProfile(tenant, comment.from?.id, comment.from?.username)) {
      persist(tenant);
    }

    // Sozlamada yoqilgan bo'lsa — har bir kommentga biznes nomidan avtomatik layk
    if (tenant.settings?.autoLikeComments && !isLive) {
      const likeRes = await likeComment(tenant, comment.id);
      console.log(`[IG Auto-Layk] @${comment.from?.username || "?"} kommentiga: ${likeRes && !likeRes.error ? "OK ❤️" : "XATO"}`);
    }

    // Geymifikatsiya: komment uchun ball (erta komment bonusi bilan)
    if (comment.from?.id) {
      award(tenant, `ig:${comment.from.id}`, "comment", { username: comment.from.username || "", mediaId }).catch(() => {});
    }

    // Ustuvorlik: aniq kalit so'zli flow → aniq kalit so'zli qoida → AI (flow va
    // qoidalar birga, bitta so'rov) → "hamma komment" flow'i → "hamma komment" qoidasi
    const flowType = isLive ? "live_comment" : "comment";
    const ruleType = isLive ? "live_comment" : "comment_to_dm";
    const flowCandidate = findFlowTrigger(tenant, flowType, { text: comment.text || "", mediaId });
    const ruleCandidate = findCommentRule(tenant, comment.text, mediaId, ruleType);
    let flowHit = null;
    let commentRule = null;
    if (flowCandidate && !flowCandidate.catchAll) flowHit = flowCandidate;
    else if (ruleCandidate && !isCatchAll(ruleCandidate)) commentRule = ruleCandidate;
    else {
      const smart = comment.text
        ? await classifyIntent(tenant, comment.text, [
            ...aiFlowCandidates(tenant, flowType, mediaId),
            ...aiRules(tenant, ruleType, mediaId),
          ])
        : null;
      if (smart) console.log(`[IG AI Trigger] "${comment.text}" → "${smart.name}"`);
      if (smart?.flow) flowHit = smart;
      else if (smart) commentRule = smart;
      else if (flowCandidate) flowHit = flowCandidate;
      else commentRule = ruleCandidate;
    }
    if (flowHit) {
      const fromId = comment.from?.id;
      if (!isLive) {
        const pub = pickFlowPublicReply(flowHit.trigger);
        if (pub) await replyToComment(tenant, comment.id, pub);
      }
      if (fromId) {
        await startFlow(tenant, `ig:${fromId}`, flowHit.flow, {
          commentId: comment.id,
          text: comment.text || "",
          userText: `${isLive ? "🔴 Jonli efir" : "💬 Komment"}: ${comment.text || ""}`,
        });
      }
      continue;
    }
    // Jonli efirda qoida/flow topilmasa — har bir kommentga javob bermaymiz (spam bo'ladi)
    if (isLive && !commentRule) continue;
    if (commentRule) {
      commentRule.stats ||= {};
      commentRule.stats.triggered = (commentRule.stats.triggered || 0) + 1;
    }

    // 1. Anti-Spam: Ochiq komment javobini random tanlaymiz (jonli efirda ochiq javob yo'q)
    const publicText = isLive ? "" : pickPublicReply(commentRule) || commentReplyText();
    if (publicText) {
      const pub = await replyToComment(tenant, comment.id, publicText);
      console.log(`[IG Komment] ochiq javob (${publicText.slice(0, 30)}...): ${pub ? "OK" : "XATO"}`);
    }

    // 2. Follower Gate (Obunani tekshirish).
    // Meta komment egasining profilini (obuna holatini) u Direct'da javob bermaguncha
    // odatda ko'rsatmaydi. Shuning uchun: aniq obunachi bo'lsa — darhol material;
    // aks holda BITTA private reply: salom + "obuna bo'ling" + tugma. Tugma bosilganda
    // (endi suhbat ochiq) obuna aniq tekshiriladi — CHECK_FOLLOW yuqorida.
    if (commentRule && commentRule.requireFollow) {
      const fromId = comment.from?.id;
      const status = fromId ? await getFollowStatus(tenant, fromId) : null;
      if (status !== true) {
        console.log(`[IG Follower Gate] @${comment.from?.username}: obuna ${status === false ? "yo'q" : "hali noma'lum"} — tugmali xabar yuborilmoqda`);
        const key = fromId ? `ig:${fromId}` : "";
        const rawMsg = commentRule.notFollowingMessage || "Assalomu alaykum! 👋 Materialni olish uchun sahifamizga obuna bo'ling va quyidagi tugmani bosing 👇";
        const warnMsg = key ? renderTemplate(rawMsg, tenant, key) : rawMsg;
        const btnTitle = commentRule.notFollowingButton || "Obuna bo'ldim ✅";
        const gateOptions = [{ title: btnTitle, payload: `CHECK_FOLLOW:${commentRule.id}` }];
        const sent = await privateReplyToComment(tenant, comment.id, warnMsg, gateOptions);
        console.log(`[IG Follower Gate] tugmali private reply: ${sent && !sent.error ? "OK" : "XATO"}`);
        if (key) {
          rememberOptions(tenant, key, gateOptions);
          if (status === false) onGateBlocked(tenant, commentRule, key, gateOptions);
          else persist(tenant);
        }
        continue;
      }
    }

    // 3. Shaxsiy Direct xabarni yetkazish.
    // MUHIM: avval qoidada aniq belgilangan matn ishlatiladi; aks holda statik
    // shablon o'rniga AI orqali AYNAN shu kommentga mos, biznesga xos shaxsiy
    // javob generatsiya qilinadi (bu oldin `commentPrivateReplyText()` doim
    // "truthy" qaytargani sababli hech qachon ishga tushmaydigan o'lik kod edi —
    // natijada barcha mijozlarga BIR XIL statik matn ketardi).
    let privateText = commentRule?.privateReply && comment.from?.id
      ? renderTemplate(commentRule.privateReply, tenant, `ig:${comment.from.id}`)
      : commentRule?.privateReply || "";
    if (!privateText && comment.text && comment.from?.id) {
      // AI javobi mijozning haqiqiy chatiga (ig:<id>) yoziladi — Inbox'da shu odam ostida
      privateText = await commentAiReply(tenant, "instagram", comment.from.id, comment.text);
    }
    if (!privateText) {
      privateText = commentPrivateReplyText(); // AI ham ishlamasa oxirgi zaxira
    }
    if (privateText) {
      // Private reply faqat matn qabul qiladi — havola tugmalari matn oxiriga qo'shiladi
      const links = (commentRule?.buttons || []).map((b) => ({ title: b.title, url: b.url }));
      const priv = await privateReplyToComment(tenant, comment.id, optionsAsText(privateText, links));
      console.log(`[IG Komment] Direct shaxsiy javob: ${priv ? "OK" : "XATO"}`);
      if (commentRule && priv && !priv.error) {
        commentRule.stats.sent = (commentRule.stats.sent || 0) + 1;
        if (comment.from?.id) onRuleDelivered(tenant, commentRule, `ig:${comment.from.id}`);
        persist(tenant);
      }
    }
  }
}

