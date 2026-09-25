/**
 * Publik sayt sozlamalari (admin panel → "Sayt"): aloqa ma'lumotlari, ishonch qatori,
 * haqiqiy mijoz fikrlari va saytdan kelgan murojaatlar. Platforma sozlamalarida
 * `site` va `contactMessages` kalitlarida saqlanadi.
 */
import crypto from "node:crypto";
import { platformSettings, savePlatformSettings } from "./credits.js";
import { getPlatformSettings } from "./db.js";

export const SITE_DEFAULTS = {
  email: "info@obunext.uz",
  telegram: "",
  phone: "+998 94 939 22 50",
  trustText: "", // bo'sh — haqiqiy bizneslar soni yoki neytral matn ko'rsatiladi
  showBusinessCount: true,
  minBusinessCount: 20, // shundan kam bo'lsa son ko'rsatilmaydi
  rating: "", // masalan "4.8" — faqat haqiqiy baholash manbai bo'lsa
  testimonials: [], // [{ quote, name, role }] — faqat ruxsat olingan haqiqiy fikrlar
  dataLocation: "Yevropa Ittifoqi", // maxfiylik siyosatida ko'rsatiladi — haqiqiy joylashuvni kiriting
};

const MAX_MESSAGES = 500;

export function siteSettings() {
  const s = platformSettings().site || {};
  return { ...SITE_DEFAULTS, ...s, testimonials: Array.isArray(s.testimonials) ? s.testimonials : [] };
}

const clean = (v, n) => String(v ?? "").trim().slice(0, n);

/** Admin formasidan kelgan qiymatlarni tekshirib saqlaydi. Qaytaradi: { ok } | { error } */
export async function saveSiteSettings(input = {}) {
  const email = clean(input.email, 120).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return { error: "Email noto'g'ri" };
  const telegram = clean(input.telegram, 64).replace(/^@|^https?:\/\/t\.me\//i, "");
  if (telegram && !/^[a-z0-9_]{4,32}$/i.test(telegram)) return { error: "Telegram username noto'g'ri (masalan: obunext)" };
  const phone = clean(input.phone, 32);
  if (phone && !/^\+?[\d\s()-]{7,20}$/.test(phone)) return { error: "Telefon raqam noto'g'ri" };
  const rating = clean(input.rating, 4);
  if (rating && !(Number(rating) >= 1 && Number(rating) <= 5)) return { error: "Reyting 1 dan 5 gacha bo'lsin yoki bo'sh qoldiring" };
  const testimonials = String(input.testimonials || "")
    .split("\n")
    .map((line) => line.split("|").map((x) => x.trim()))
    .filter(([quote, name]) => quote && name)
    .slice(0, 12)
    .map(([quote, name, role = ""]) => ({ quote: quote.slice(0, 400), name: name.slice(0, 60), role: role.slice(0, 80) }));
  await savePlatformSettings({
    site: {
      email,
      telegram,
      phone,
      rating,
      testimonials,
      trustText: clean(input.trustText, 120),
      dataLocation: clean(input.dataLocation, 120) || SITE_DEFAULTS.dataLocation,
      showBusinessCount: input.showBusinessCount === "on" || input.showBusinessCount === true,
      minBusinessCount: Math.max(1, Math.min(100000, Math.round(Number(input.minBusinessCount) || SITE_DEFAULTS.minBusinessCount))),
    },
  });
  return { ok: true };
}

/** Saytdagi "Bog'lanish" formasi — murojaatni saqlaydi. */
export async function addContactMessage({ name, email, phone, message, lang, ip }) {
  const text = clean(message, 3000);
  if (text.length < 5) return { error: "short" };
  const s = (await getPlatformSettings()) || {};
  const list = Array.isArray(s.contactMessages) ? s.contactMessages : [];
  const item = { id: crypto.randomBytes(6).toString("hex"), at: new Date().toISOString(), name: clean(name, 80), email: clean(email, 120), phone: clean(phone, 32), message: text, lang: clean(lang, 4), ip: clean(ip, 64), read: false };
  list.unshift(item);
  await savePlatformSettings({ contactMessages: list.slice(0, MAX_MESSAGES) });
  return { ok: true, item };
}

export async function contactMessages() {
  const s = (await getPlatformSettings()) || {};
  return Array.isArray(s.contactMessages) ? s.contactMessages : [];
}

export async function updateContactMessages(mutator) {
  const list = await contactMessages();
  const next = mutator(list) || list;
  await savePlatformSettings({ contactMessages: next.slice(0, MAX_MESSAGES) });
  return next;
}
