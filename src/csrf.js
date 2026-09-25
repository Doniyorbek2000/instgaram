/**
 * CSRF himoyasi (biznes paneli). SameSite=Lax cookie ko'p holatni yopadi, lekin
 * qo'shimcha qatlam sifatida: sessiya cookie'si bilan kelgan o'zgartiruvchi so'rov
 * (POST/PUT/PATCH/DELETE) boshqa saytdan yuborilgan bo'lsa — rad etiladi.
 *
 * Brauzer boshqa saytdan yuborilgan so'rovga har doim Origin (yoki Referer) qo'yadi.
 * Server-server chaqiruvlari (Meta/Payme/Telegram webhooklari, MCP) sessiya cookie'siz
 * keladi — ularga bu tekshiruv ta'sir qilmaydi.
 */
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

function hasSessionCookie(req) {
  return /(?:^|;\s*)(sid|ws)=/.test(String(req.headers.cookie || ""));
}

export function csrfGuard(req, res, next) {
  if (SAFE.has(req.method) || !hasSessionCookie(req)) return next();
  const source = req.get("origin") || req.get("referer") || "";
  if (!source) return next(); // eski brauzerlar/ilovalar — SameSite=Lax himoya qiladi
  let sourceHost = "";
  try {
    sourceHost = new URL(source).host.toLowerCase();
  } catch {
    sourceHost = "";
  }
  const host = String(req.headers.host || "").toLowerCase();
  if (sourceHost && sourceHost === host) return next();
  console.warn(`[CSRF] rad etildi: ${req.method} ${req.path} (manba: ${source.slice(0, 100)})`);
  return res.status(403).send("Noto'g'ri so'rov manbai");
}
