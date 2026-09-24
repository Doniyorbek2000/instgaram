import { commentReplyText, commentPrivateReplyText } from "../autoReply.js";
import { sendReply } from "../outbound.js";
import { award, confirmPendingReferral } from "../gamification.js";
import { processMessage } from "../respond.js";
import { isActive } from "../subscription.js";
import { isDuplicate } from "../dedup.js";
import { fetchAsBase64 } from "../media.js";
import { persist } from "../db.js";
import {
  findCommentRule,
  findStoryMentionRule,
  findStoryReplyRule,
  pickPublicReply,
  ensureRules,
} from "../rules.js";
import {
  replyToComment,
  privateReplyToComment,
  sendDirectMessage,
  sendDirectQuickReplies,
  checkFollowerStatus,
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

    // Postback yoki Quick Reply bosilganda
    const qrPayload = message?.quick_reply?.payload || postback?.payload || "";
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
        const formBtn = rule?.formId ? [{ title: rule.formButton || "📝 Ariza qoldirish", payload: `FORM:${rule.formId}` }] : [];
        await sendReply(tenant, "instagram", senderId, rewardText, formBtn);
        confirmPendingReferral(tenant, `ig:${senderId}`).catch(() => {});
      } else {
        console.log(`[IG Follower Gate] ❌ ${senderId} hali obuna bo'lmagan`);
        const warnText = "Siz hali sahifamizga obuna bo'lmabsiz 🥺 Iltimos, profilimizga obuna bo'ling va so'ng quyidagi tugmani bosing:";
        const btnText = rule?.notFollowingButton || "Obuna bo'ldim ✅";
        await sendDirectQuickReplies(tenant, senderId, warnText, [
          { title: btnText, payload: qrPayload },
        ]);
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
      const storyRule = findStoryMentionRule(tenant);
      if (storyRule && storyRule.privateReply) {
        storyRule.stats ||= {};
        storyRule.stats.triggered = (storyRule.stats.triggered || 0) + 1;
        storyRule.stats.sent = (storyRule.stats.sent || 0) + 1;
        persist(tenant);
        const extra = pts > 0 ? `\n\n⭐ +${pts} ball! Balingizni ko'rish uchun "${tenant.gamification.keywords.balance}" deb yozing.` : "";
        await sendDirectMessage(tenant, senderId, storyRule.privateReply + extra);
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
      const storyReplyRule = findStoryReplyRule(tenant, message.text);
      if (storyReplyRule && storyReplyRule.privateReply) {
        console.log(`[IG Story Reply] ${tenant.businessName}: ${senderId} story'ga javob berdi`);
        storyReplyRule.stats ||= {};
        storyReplyRule.stats.triggered = (storyReplyRule.stats.triggered || 0) + 1;
        storyReplyRule.stats.sent = (storyReplyRule.stats.sent || 0) + 1;
        persist(tenant);
        await sendDirectMessage(tenant, senderId, storyReplyRule.privateReply);
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
      profile: { username: cached?.username || "", name: cached?.name || "" },
    });
    if (reply) {
      const ok = await sendReply(tenant, "instagram", senderId, reply, quickReplies);
      if (ok) console.log(`[IG Direct Javob] ${tenant.businessName} -> ${senderId}: OK ✅`);
      else console.error(`[IG Direct Xatolik] ${tenant.businessName} -> ${senderId}: Meta xabar yubormadi`);
    }
  }

  // Kommentlar (Comment-to-DM & Follower Gate Triggers)
  for (const change of entry.changes || []) {
    if (change.field !== "comments") continue;
    const comment = change.value;
    if (!comment?.id) continue;
    if (comment.from?.id === tenant.meta.igUserId) continue;
    if (isDuplicate(`c:${comment.id}`)) continue;
    if (!isActive(tenant)) continue;

    const mediaId = comment.media?.id || "";
    console.log(
      `[IG Komment] ${tenant.businessName}: @${comment.from?.username || "?"}: "${comment.text}" (post: ${mediaId || "any"})`
    );

    // Webhook'da kelgan username'ni Live Inbox uchun tekin keshlaymiz (API so'rovsiz)
    if (cacheCommentProfile(tenant, comment.from?.id, comment.from?.username)) {
      persist(tenant);
    }

    // Sozlamada yoqilgan bo'lsa — har bir kommentga biznes nomidan avtomatik layk
    if (tenant.settings?.autoLikeComments) {
      const likeRes = await likeComment(tenant, comment.id);
      console.log(`[IG Auto-Layk] @${comment.from?.username || "?"} kommentiga: ${likeRes && !likeRes.error ? "OK ❤️" : "XATO"}`);
    }

    // Geymifikatsiya: komment uchun ball (erta komment bonusi bilan)
    if (comment.from?.id) {
      award(tenant, `ig:${comment.from.id}`, "comment", { username: comment.from.username || "", mediaId }).catch(() => {});
    }

    // ChatPlace uslubida qoidani qidiramiz (mediaId va kalit so'z bo'yicha)
    const commentRule = findCommentRule(tenant, comment.text, mediaId);
    if (commentRule) {
      commentRule.stats ||= {};
      commentRule.stats.triggered = (commentRule.stats.triggered || 0) + 1;
    }

    // 1. Anti-Spam: Ochiq komment javobini random tanlaymiz
    const publicText = pickPublicReply(commentRule) || commentReplyText();
    if (publicText) {
      const pub = await replyToComment(tenant, comment.id, publicText);
      console.log(`[IG Komment] ochiq javob (${publicText.slice(0, 30)}...): ${pub ? "OK" : "XATO"}`);
    }

    // 2. Follower Gate (Obunani tekshirish)
    if (commentRule && commentRule.requireFollow) {
      const fromId = comment.from?.id;
      const isFollowing = fromId ? await checkFollowerStatus(tenant, fromId) : false;

      if (!isFollowing) {
        commentRule.stats.gateBlocked = (commentRule.stats.gateBlocked || 0) + 1;
        persist(tenant);
        console.log(`[IG Follower Gate] @${comment.from?.username} obuna bo'lmagan — ogohlantirish yuborilmoqda`);
        const warnMsg = commentRule.notFollowingMessage || "Sovg'ani olish uchun avval sahifamizga obuna bo'ling! 👇";
        const btnTitle = commentRule.notFollowingButton || "Obuna bo'ldim ✅";
        
        // Private Reply orqali Quick Reply tugmali ogohlantirish yuboramiz
        await privateReplyToComment(tenant, comment.id, warnMsg);
        if (fromId) {
          await sendDirectQuickReplies(tenant, fromId, warnMsg, [
            { title: btnTitle, payload: `CHECK_FOLLOW:${commentRule.id}` }
          ]);
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
    let privateText = commentRule?.privateReply || "";
    if (!privateText && comment.text) {
      const { reply } = await processMessage(tenant, "instagram", `comment:${comment.from?.id || comment.id}`, {
        text: comment.text,
      });
      privateText = reply || "";
    }
    if (!privateText) {
      privateText = commentPrivateReplyText(); // AI ham ishlamasa oxirgi zaxira
    }
    if (privateText) {
      const priv = await privateReplyToComment(tenant, comment.id, privateText);
      console.log(`[IG Komment] Direct shaxsiy javob: ${priv ? "OK" : "XATO"}`);
      if (commentRule && priv && !priv.error) {
        commentRule.stats.sent = (commentRule.stats.sent || 0) + 1;
        persist(tenant);
      }
    }
  }
}

