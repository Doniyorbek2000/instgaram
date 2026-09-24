import { commentReplyText } from "../autoReply.js";
import { processMessage, commentAiReply } from "../respond.js";
import { botEnabled } from "../credits.js";
import { isDuplicate } from "../dedup.js";
import { loadAttachments } from "./instagram.js";
import { findCommentRule, pickPublicReply } from "../rules.js";
import { sendReply } from "../outbound.js";
import {
  replyToFacebookComment,
  privateReplyToFacebookComment,
  showTyping,
} from "../services/messenger.js";

/** Facebook sahifa webhook (object: "page") hodisalarini qayta ishlaydi. */
export async function handleFacebookEntry(tenant, entry) {
  const pageId = entry.id;

  // Messenger xabarlari — matn, ovoz, rasm, video
  for (const event of entry.messaging || []) {
    const senderId = event.sender?.id;
    const message = event.message;
    if (!senderId || senderId === pageId) continue;
    const payload = message?.quick_reply?.payload || event.postback?.payload || "";
    const ref = event.referral?.ref || event.postback?.referral?.ref || message?.referral?.ref || "";

    // Xabarsiz hodisa: tugma (postback) yoki m.me?ref= orqali kelish
    if (!message && (payload || ref)) {
      const { reply, quickReplies } = await processMessage(tenant, "facebook", senderId, { text: "", payload, ref });
      if (reply) await sendReply(tenant, "facebook", senderId, reply, quickReplies);
      continue;
    }
    if (!message || message.is_echo) continue;
    if (isDuplicate(message.mid)) continue;

    const text = message.text || "";
    const media = await loadAttachments(message.attachments);
    if (!text && media.length === 0) continue;

    console.log(
      `[Messenger] ${tenant.businessName}: ${senderId} -> "${text}" (${media.length} media)`
    );
    showTyping(tenant, senderId); // Kosmetik — javob tezligiga ta'sir qilmasin
    const { reply, quickReplies } = await processMessage(tenant, "facebook", senderId, { text, media, payload, ref });
    if (reply) await sendReply(tenant, "facebook", senderId, reply, quickReplies);
  }

  // Sahifa postlaridagi kommentlar (feed) — Instagram'dagi kabi Rules Engine
  // (comment-to-DM) qo'llaniladi. Follower Gate FB'da qo'llanilmaydi: Graph API'da
  // "shu foydalanuvchi sahifaga obunami" degan xavfsiz/ishonchli maydon yo'q,
  // shuning uchun soxta tekshiruv qo'shish noto'g'ri bo'lardi.
  for (const change of entry.changes || []) {
    if (change.field !== "feed") continue;
    const value = change.value;
    if (value?.item !== "comment" || value?.verb !== "add") continue;
    if (value.from?.id === pageId) continue;
    if (isDuplicate(`c:${value.comment_id}`)) continue;
    if (!botEnabled(tenant)) continue; // obuna faol emas

    console.log(
      `[FB Komment] ${tenant.businessName}: ${value.from?.name || "?"}: "${value.message}"`
    );

    const commentRule = findCommentRule(tenant, value.message, value.post_id || "");

    // 1. Anti-Spam: Ochiq komment javobini random tanlaymiz (rule bo'lsa) yoki default
    const publicText = pickPublicReply(commentRule) || commentReplyText();
    if (publicText) {
      const pub = await replyToFacebookComment(tenant, value.comment_id, publicText);
      console.log(`[FB Komment] ochiq javob (${publicText.slice(0, 30)}...): ${pub ? "OK" : "XATO"}`);
    }

    // 2. Messenger orqali shaxsiy javob (rule bo'lsa uning matni, bo'lmasa AI orqali)
    const privateText = commentRule?.privateReply;
    if (privateText) {
      const priv = await privateReplyToFacebookComment(tenant, value.comment_id, privateText);
      console.log(`[FB Komment] Messenger shaxsiy javob: ${priv ? "OK" : "XATO"}`);
    } else if (value.message) {
      const reply = value.from?.id ? await commentAiReply(tenant, "facebook", value.from.id, value.message) : "";
      if (reply) await privateReplyToFacebookComment(tenant, value.comment_id, reply);
    }
  }
}
