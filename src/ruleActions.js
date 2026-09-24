/**
 * Qoida ishlaganda bajariladigan umumiy amallar (ChatPlace "Action" bloklari).
 * Sovg'a yetkazish 4 joyda sodir bo'ladi (komment, DM kalit so'z, IG obuna
 * tugmasi, Telegram obuna tugmasi) — mantiq shu yerda bir marta yozilgan.
 */
import { addTags } from "./contacts.js";
import { scheduleFollowUp, cancelFollowUps } from "./followups.js";
import { persist } from "./db.js";

const DEFAULT_REMINDER =
  "Sovg'angiz hali ham sizni kutyapti 🎁 Sahifamizga obuna bo'ling va «Obuna bo'ldim ✅» tugmasini bosing — darhol yuboramiz!";

function bump(rule, field) {
  rule.stats ||= {};
  rule.stats[field] = (rule.stats[field] || 0) + 1;
}

/** Sovg'a xabari bilan yuboriladigan tugmalar: havolalar + (bo'lsa) forma tugmasi. */
export function ruleReplyOptions(rule) {
  if (!rule) return [];
  const links = (rule.buttons || []).filter((b) => b?.title && b?.url).map((b) => ({ title: b.title, url: b.url }));
  const form = rule.formId ? [{ title: rule.formButton || "📝 Ariza qoldirish", payload: `FORM:${rule.formId}` }] : [];
  return [...links, ...form];
}

/**
 * Sovg'a/javob mijozga yetkazilganda: teglar qo'yiladi, obuna eslatmasi bekor
 * qilinadi, follow-up xabar rejalashtiriladi. `sent` statistikasini chaqiruvchi o'zi oshiradi.
 */
export function onRuleDelivered(tenant, rule, key) {
  if (!rule || !key) return;
  if (rule.tags?.length) addTags(tenant, key, rule.tags);
  cancelFollowUps(tenant, key, { kind: "reminder", ruleId: rule.id });
  if (rule.followUpText) {
    scheduleFollowUp(tenant, {
      key,
      kind: "followup",
      ruleId: rule.id,
      text: rule.followUpText,
      delayMin: rule.followUpDelayMin || 60,
    });
  }
  persist(tenant);
}

/**
 * Mijoz obuna darvozasidan o'tmadi: statistika va (yoqilgan bo'lsa) eslatma.
 * options — eslatma bilan qayta yuboriladigan "Obuna bo'ldim" tugmasi.
 */
export function onGateBlocked(tenant, rule, key, options = []) {
  if (!rule || !key) return;
  bump(rule, "gateBlocked");
  const delayMin = rule.reminderDelayMin ?? 45;
  if (delayMin > 0) {
    scheduleFollowUp(tenant, {
      key,
      kind: "reminder",
      ruleId: rule.id,
      text: rule.reminderText || DEFAULT_REMINDER,
      options,
      delayMin,
    });
  }
  persist(tenant);
}
