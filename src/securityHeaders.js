/**
 * HTTP xavfsizlik sarlavhalari (helmet o'rniga — qo'shimcha kutubxonasiz).
 * Sahifalar server tomonda chiziladi va inline <script>/<style> ishlatadi, shuning
 * uchun CSP'da 'unsafe-inline' bor; asosiy foyda — boshqa domendan skript/iframe/
 * plagin yuklashni va sahifani begona saytga joylashni (clickjacking) taqiqlash.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https:",
  "frame-src 'self' https://accounts.google.com https://www.youtube.com https://www.instagram.com",
  "frame-ancestors 'self'",
  "form-action 'self' https:",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

// Boshqa saytlarga joylashtirilishi kerak bo'lgan yo'llar (widget skripti, havolalar)
const EMBEDDABLE = /^\/(w\/|l\/|g\/|p\/)/;

export function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  if (!EMBEDDABLE.test(req.path)) {
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Content-Security-Policy", CSP);
  }
  if (req.secure || req.get("x-forwarded-proto") === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  res.removeHeader("X-Powered-By");
  next();
}
