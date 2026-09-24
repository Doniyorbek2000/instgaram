/**
 * Payme fiskal chek ma'lumotlari (CheckPerformTransaction javobidagi `detail`).
 * O'zbekistonda onlayn to'lov uchun chek MXIK (IKPU) kodi va o'lchov birligi
 * (package_code) bilan shakllantiriladi. Kodlarni tasnif.soliq.uz'dan olib,
 * admin panelda (platforma) yoki do'kon sozlamalarida (biznes) kiriting.
 * Kod kiritilmagan bo'lsa `detail` yuborilmaydi (avvalgi xatti-harakat).
 */
import { platformSettings } from "./credits.js";

export const cleanCode = (v) => String(v || "").replace(/\D/g, "").slice(0, 20);

/** Platforma sozlamasi: { ikpu, packageCode, vatPercent } */
export function platformFiscal() {
  const f = platformSettings().fiscal || {};
  return { ikpu: cleanCode(f.ikpu || process.env.PAYME_IKPU), packageCode: cleanCode(f.packageCode || process.env.PAYME_PACKAGE_CODE), vatPercent: Number.isFinite(Number(f.vatPercent)) ? Number(f.vatPercent) : 12 };
}

/**
 * items: [{ title, price (so'm, 1 dona), count, ikpu?, packageCode?, vatPercent? }]
 * Har bir qatorda MXIK kodi bo'lsa — `detail` qaytaradi, aks holda null.
 */
export function receiptDetail(items, defaults = {}) {
  const list = (items || []).map((it) => ({
    title: String(it.title || "").slice(0, 120),
    price: Math.round((Number(it.price) || 0) * 100), // tiyin
    count: Math.max(1, Number(it.count) || 1),
    code: cleanCode(it.ikpu || defaults.ikpu),
    package_code: cleanCode(it.packageCode || defaults.packageCode),
    vat_percent: Number.isFinite(Number(it.vatPercent)) ? Number(it.vatPercent) : Number(defaults.vatPercent) || 0,
  }));
  if (!list.length || list.some((it) => !it.code || !it.package_code)) return null;
  return { receipt_type: 0, items: list };
}
