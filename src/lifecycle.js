/**
 * Obuna eslatmalari: sinov/obuna tugashidan oldin va tugaganda biznes egasiga
 * Telegram (ulangan bo'lsa), email (SMTP sozlangan bo'lsa) va Web Push orqali xabar.
 * Har bir bosqich bitta muddat uchun faqat bir marta yuboriladi (meta.subReminders).
 *
 * Bosqichlar: 3 kun qoldi → 1 kun qoldi → tugadi (tugaganidan keyin 3 kun ichida).
 * Avtomatik uzaytirish (kartadan har oy yechish) yo'q — Payme'ning obuna (recurrent)
 * API'si alohida shartnoma talab qiladi; shuning uchun eslatma havolasi to'lov sahifasiga olib boradi.
 */
import { listUsers, persist } from "./db.js";
import { config } from "./config.js";
import { sendPlatformMail } from "./mailer.js";

const DAY = 86400000;

function periodEnd(u) {
  const s = u.subscription || {};
  if (s.status === "trial" && s.trialEndsAt) return { kind: "trial", end: Date.parse(s.trialEndsAt) };
  if (s.status === "active" && s.expiresAt) return { kind: "paid", end: Date.parse(s.expiresAt) };
  return null;
}

/** Hozir qaysi eslatma kerak: "d3" | "d1" | "ended" | null */
export function reminderStage(u, now = Date.now()) {
  const p = periodEnd(u);
  if (!p || !p.end) return null;
  const left = p.end - now;
  if (left <= 0) return left > -3 * DAY ? "ended" : null;
  if (left <= DAY) return "d1";
  if (left <= 3 * DAY) return p.kind === "paid" ? "d3" : null; // 3 kunlik sinovda "3 kun qoldi" ma'nosiz
  return null;
}

function message(u, stage, kind) {
  const who = kind === "trial" ? "Bepul sinov muddatingiz" : "Obunangiz";
  if (stage === "d3") return `${who} 3 kundan so'ng tugaydi. Bot to'xtab qolmasligi uchun oldindan uzaytiring.`;
  if (stage === "d1") return `${who} ertaga tugaydi. Mijozlaringiz javobsiz qolmasligi uchun hozir uzaytiring.`;
  return `${who} tugadi — AI javoblar va avtomatlashtirish cheklandi. Davom ettirish uchun tarifni tanlang.`;
}

/** Bitta biznes uchun kerakli eslatmani yuboradi. Qaytaradi: yuborilgan kanallar ro'yxati. */
export async function remindTenant(u, now = Date.now(), { sendTelegram, notifyPush } = {}) {
  if (u.meta?.blocked) return [];
  const stage = reminderStage(u, now);
  if (!stage) return [];
  const p = periodEnd(u);
  const key = `${p.kind}:${new Date(p.end).toISOString().slice(0, 10)}:${stage}`;
  u.meta ||= {};
  const done = (u.meta.subReminders ||= []);
  if (done.includes(key)) return [];
  done.push(key);
  if (done.length > 20) done.splice(0, done.length - 20);
  await persist(u);

  const text = message(u, stage, p.kind);
  const url = `${(config.baseUrl || "").replace(/\/$/, "")}/billing`;
  const channels = [];
  const chatId = u.settings?.telegramChatId;
  if (chatId) {
    const send = sendTelegram || (await import("./notify.js")).sendTelegram;
    if ((await send(chatId, `⏳ <b>Obunext</b>\n\n${text}\n${url}`).catch(() => false)) !== false) channels.push("telegram");
  }
  if (await sendPlatformMail(u.email, { subject: stage === "ended" ? "Obunext — obuna tugadi" : "Obunext — obuna tugashiga oz qoldi", lines: [text], button: { label: "Tarifni uzaytirish", url } })) channels.push("email");
  const push = notifyPush || (await import("./push.js")).notifyPush;
  await Promise.resolve()
    .then(() => push(u, { title: "⏳ Obuna", body: text, url: "/billing", tag: "subscription" }))
    .catch(() => {});
  return channels;
}

let running = false;

export async function runSubscriptionReminders(now = Date.now()) {
  if (running) return 0;
  running = true;
  let n = 0;
  try {
    for (const u of await listUsers()) {
      try {
        if ((await remindTenant(u, now)).length) n++;
      } catch (err) {
        console.error(`[Obuna eslatma] ${u.businessName}:`, err.message);
      }
    }
  } finally {
    running = false;
  }
  return n;
}
