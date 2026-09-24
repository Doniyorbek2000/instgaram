import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rulesPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "rules.json"
);

const rulesFile = JSON.parse(readFileSync(rulesPath, "utf8"));

/**
 * Kiruvchi matnga mos javobni topadi.
 * Qoidalardagi kalit so'zlardan biri matnda uchrasa — o'sha javob,
 * aks holda defaultReply qaytadi.
 */
export function findReply(text) {
  if (!text) return rulesFile.defaultReply;
  const lower = text.toLowerCase();
  for (const rule of rulesFile.rules) {
    if (rule.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      return rule.reply;
    }
  }
  return rulesFile.defaultReply;
}

export function commentReplyText() {
  return rulesFile.commentReply;
}

export function commentPrivateReplyText() {
  return rulesFile.commentPrivateReply;
}
