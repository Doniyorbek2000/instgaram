/**
 * Bot-bot tsiklidan himoya.
 *
 * Ba'zi Instagram/Telegram akkauntlarning o'z avto-javob boti bor. Bizning bot unga
 * javob bersa, u darhol qaytib yozadi va ikki bot cheksiz yozishib, AI kreditini
 * yoqadi va mijoz oldida kulgili holat bo'ladi (production'da @temdon.uz bilan
 * bot javobidan 0 soniyada qayta yozish kuzatilgan).
 *
 * Belgi: mijoz xabari botning oldingi javobidan FAST_MS ichida keladi — odam bunday
 * tez o'qib-yozolmaydi. Oxirgi WINDOW_MS ichida shunday "juda tez" javoblar
 * STRIKES martaga yetsa (joriy xabar bilan birga) — tsikl deb hisoblanadi.
 */
export const FAST_MS = 5000;
export const WINDOW_MS = 10 * 60 * 1000;
export const STRIKES = 3;

const ts = (m) => Date.parse(m?.at || m?.time || "") || 0;

/**
 * history — suhbat keshi (tenant.chats[key]), joriy kiruvchi xabar hali qo'shilmagan.
 * Qaytaradi: true — joriy xabar bilan birga tsikl aniqlandi.
 */
export function isBotLoop(history = [], now = Date.now()) {
  const list = history.filter((m) => m && (m.role === "user" || m.role === "assistant"));
  const last = list[list.length - 1];
  // Joriy xabar botning javobidan keyin juda tez kelmagan bo'lsa — tsikl emas
  if (!last || last.role !== "assistant" || now - ts(last) > FAST_MS) return false;
  let strikes = 1; // joriy xabar
  for (let i = list.length - 1; i > 0 && strikes < STRIKES; i--) {
    const cur = list[i];
    const prev = list[i - 1];
    if (now - ts(cur) > WINDOW_MS) break;
    if (cur.role === "user" && prev.role === "assistant" && ts(cur) - ts(prev) <= FAST_MS) strikes++;
  }
  return strikes >= STRIKES;
}
