import { graphPost } from "../graph.js";

/** Facebook Messenger orqali xabar yuboradi. */
export function sendMessengerMessage(tenant, psid, text, { humanAgent = false } = {}) {
  return graphPost(
    "me/messages",
    {
      recipient: { id: psid },
      // Operator javobi 24 soatdan keyin 7 kungacha — HUMAN_AGENT belgisi bilan
      ...(humanAgent ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } : { messaging_type: "RESPONSE" }),
      message: { text },
    },
    tenant.meta.pageAccessToken
  );
}

/** "Yozmoqda…" ko'rsatkichi (tirik operator taassuroti). */
export function showTyping(tenant, psid) {
  return graphPost(
    "me/messages",
    { recipient: { id: psid }, sender_action: "typing_on" },
    tenant.meta.pageAccessToken
  );
}

/** Facebook post kommentiga ochiq (public) javob yozadi. */
export function replyToFacebookComment(tenant, commentId, message) {
  return graphPost(
    `${commentId}/comments`,
    { message },
    tenant.meta.pageAccessToken
  );
}

/**
 * Komment egasiga Messenger orqali shaxsiy javob (Private Reply) yuboradi.
 * Meta qoidasi: faqat komment yozilganidan keyin 7 kun ichida mumkin.
 * Instagram'dagi services/instagram.js#privateReplyToComment bilan bir xil mantiq.
 */
export function privateReplyToFacebookComment(tenant, commentId, text) {
  return graphPost(
    `${commentId}/private_replies`,
    { message: text },
    tenant.meta.pageAccessToken
  );
}
