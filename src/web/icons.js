/**
 * Umumiy SVG ikonka to'plami — sidebar navigatsiyasi va marketing sayt uchun.
 * Emoji o'rniga: outline (stroke) uslubida, currentColor bilan (CSS orqali rangini
 * boshqarish mumkin), Phosphor/Heroicons uslubiga mos oddiy geometrik shakllar.
 */

const PATHS = {
  // ---- Sidebar navigatsiya ----
  grid: `<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>`,
  chat: `<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.2 0-2.35-.24-3.4-.68L3 21l1.85-4.63A8.46 8.46 0 0 1 3.5 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5Z"/>`,
  users: `<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.5 2.9-6 6.5-6s6.5 2.5 6.5 6"/><circle cx="17.5" cy="9" r="2.6"/><path d="M15.2 14.3c2.7.5 4.6 2.4 5.3 4.3"/>`,
  megaphone: `<path d="M3 10v4a1 1 0 0 0 1 1h2l7 4V5L6 9H4a1 1 0 0 0-1 1Z"/><path d="M17 9a4 4 0 0 1 0 6"/><path d="M20 7a7.5 7.5 0 0 1 0 10"/>`,
  bolt: `<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>`,
  layout: `<rect x="3" y="4" width="18" height="6" rx="1.6"/><rect x="3" y="14" width="8" height="6" rx="1.6"/><rect x="13" y="14" width="8" height="6" rx="1.6"/>`,
  trending: `<polyline points="3,17 9,11 13,15 21,7"/><polyline points="15,7 21,7 21,13"/>`,
  calendar: `<rect x="3" y="5" width="18" height="16" rx="2.2"/><line x1="3" y1="9.5" x2="21" y2="9.5"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>`,
  card: `<rect x="2.5" y="5.5" width="19" height="13" rx="2.2"/><line x1="2.5" y1="10" x2="21.5" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/>`,
  spark: `<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="M19 14.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z"/>`,
  gear: `<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="8"/><line x1="12" y1="2" x2="12" y2="4.5"/><line x1="12" y1="19.5" x2="12" y2="22"/><line x1="2" y1="12" x2="4.5" y2="12"/><line x1="19.5" y1="12" x2="22" y2="12"/><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"/>`,
  key: `<circle cx="7" cy="12" r="4"/><line x1="10.5" y1="12" x2="21" y2="12"/><line x1="17" y1="12" x2="17" y2="16"/><line x1="20" y1="12" x2="20" y2="15"/>`,

  // ---- Marketing sayt xususiyatlari ----
  globe: `<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3c2.8 2.5 4.2 5.7 4.2 9s-1.4 6.5-4.2 9c-2.8-2.5-4.2-5.7-4.2-9s1.4-6.5 4.2-9Z"/>`,
  shield: `<path d="M12 3l7 3v5c0 5-3.2 8.5-7 10-3.8-1.5-7-5-7-10V6l7-3Z"/><polyline points="9,12 11,14 15,9.5"/>`,
  user: `<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7"/>`,
  pen: `<path d="M4 20l1-4.2L15.8 5c.8-.8 2-.8 2.8 0l.4.4c.8.8.8 2 0 2.8L8.2 19 4 20Z"/><line x1="14" y1="6.8" x2="17.2" y2="10"/>`,
  camera: `<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M8 7l1.5-2.5h5L16 7"/><circle cx="12" cy="13.5" r="3.8"/>`,
  chart: `<line x1="4" y1="20" x2="20" y2="20"/><rect x="6" y="12" width="3" height="8"/><rect x="11" y="8" width="3" height="12"/><rect x="16" y="4" width="3" height="16"/>`,
  mic: `<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="9" y1="21" x2="15" y2="21"/>`,
};

/**
 * Ikonka SVG belgisini qaytaradi. name — PATHS kalitlaridan biri.
 * Noma'lum nom kelsa (masalan hali ko'chirilmagan emoji) — bo'sh string qaytadi,
 * chaqiruvchi joy shu holatda asl qiymatni ko'rsatishi kerak.
 */
export function icon(name, { size = 18, style = "" } = {}) {
  const d = PATHS[name];
  if (!d) return "";
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex:none;${style}">${d}</svg>`;
}

// ---- Ijtimoiy tarmoq brend belgilari (haqiqiy, ko'p rangli logotiplar —
// yuqoridagi bir rangli stroke ikonkalardan farqli, "Kanallar Hubi" kabi
// joylarda emoji o'rniga ishlatiladi). ----
const BRAND_ICONS = {
  instagram: `<defs><linearGradient id="ig{u}" x1="2" y1="46" x2="46" y2="2" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FED576"/><stop offset="0.26" stop-color="#F47133"/><stop offset="0.6" stop-color="#BC3081"/><stop offset="1" stop-color="#4C63D2"/></linearGradient></defs><rect x="1" y="1" width="46" height="46" rx="13" fill="url(#ig{u})"/><rect x="13" y="13" width="22" height="22" rx="7" fill="none" stroke="#fff" stroke-width="2.6"/><circle cx="24" cy="24" r="6" fill="none" stroke="#fff" stroke-width="2.6"/><circle cx="33.2" cy="14.8" r="1.7" fill="#fff"/>`,
  telegram: `<circle cx="24" cy="24" r="23" fill="#29A9EA"/><path d="M35 14 L30.5 35 C30.2 36.3 29.4 36.6 28.3 36 L21.8 31.2 L18.7 34.2 C18.3 34.6 18 34.9 17.3 34.9 L17.8 28.2 L30 17.2 C30.5 16.7 29.9 16.5 29.2 16.9 L14 26.7 L7.5 24.7 C6.1 24.3 6.1 23.3 7.8 22.6 L33.2 12.7 C34.4 12.3 35.4 13 35 14 Z" fill="#fff"/>`,
  whatsapp: `<circle cx="24" cy="24" r="23" fill="#25D366"/><path d="M24 10.5c-7.5 0-13.5 6-13.5 13.5 0 2.5.7 4.9 1.9 6.9L10 37.5l6.8-1.8c1.9 1.1 4.1 1.7 6.4 1.7h.1c7.5 0 13.5-6 13.5-13.5S31.7 10.5 24.2 10.5H24z" fill="#fff"/><path d="M31.7 27.4c-.4-.2-2.2-1.1-2.6-1.2-.3-.1-.6-.2-.9.2-.3.4-1 1.2-1.2 1.5-.2.2-.4.3-.8.1-.4-.2-1.6-.6-3.1-1.9-1.1-1-1.9-2.3-2.2-2.7-.2-.4 0-.6.2-.8.2-.2.4-.4.5-.6.2-.2.2-.4.4-.6.1-.2.1-.5 0-.6-.1-.2-.9-2.2-1.3-3-.3-.8-.7-.7-.9-.7h-.8c-.3 0-.7.1-1.1.5-.4.4-1.4 1.3-1.4 3.3s1.4 3.8 1.6 4c.2.3 2.8 4.4 7 6.1 3.4 1.4 3.6.9 4.3.9.7-.1 2.2-.9 2.5-1.8.3-.9.3-1.7.2-1.8-.1-.2-.3-.3-.7-.5z" fill="#25D366"/>`,
  facebook: `<circle cx="24" cy="24" r="23" fill="#1877F2"/><path d="M27.5 24.5h4l.6-4h-4.6v-2.6c0-1.4.4-2.4 2.4-2.4h2.4V11.7c-.4 0-1.8-.2-3.4-.2-3.4 0-5.7 2.1-5.7 5.9v3.1H19v4h4.2V37h4.3V24.5z" fill="#fff"/>`,
};

let _brandId = 0;
/** Ijtimoiy tarmoq brend logotipi (rangli, real belgi) — BRAND_ICONS kalitlaridan biri. */
export function brandIcon(name, { size = 28 } = {}) {
  const raw = BRAND_ICONS[name];
  if (!raw) return "";
  const d = raw.replaceAll("{u}", String(++_brandId)); // gradient id'lari bir sahifada takrorlanmasligi uchun
  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true" style="display:block;flex:none">${d}</svg>`;
}

/** Ro'yxatdagi barcha ikonka nomlari (testlar/tekshiruv uchun) */
export const ICON_NAMES = Object.keys(PATHS);
