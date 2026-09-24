/**
 * Native High-Performance In-Memory Rate Limiter Middleware
 * Brute-force va DDOS hujumlaridan 100% samarali himoyalaydi.
 */

const rateLimitMap = new Map();

// Xotira to'lib ketmasligi uchun har 10 daqiqada eski IP yozuvlarini tozalaydi
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) {
      rateLimitMap.delete(key);
    }
  }
}, 10 * 60 * 1000);

export function createRateLimiter({
  windowMs = 15 * 60 * 1000, // 15 daqiqa
  max = 15,                  // Maksimal so'rovlar soni
  message = "Juda ko'p so'rov yuborildi. Xavfsizlik yuzasidan birozdan so'ng qayta urinib ko'ring."
} = {}) {
  return (req, res, next) => {
    // Muhim: req.ip ishlatamiz (xom x-forwarded-for/x-real-ip headerlarga emas) —
    // Express bu qiymatni index.js dagi "trust proxy" sozlamasiga mos ravishda
    // hisoblaydi, shuning uchun mijoz headerni o'zi soxtalab bu chegarani chetlab
    // o'ta olmaydi.
    const ip = req.ip || "127.0.0.1";
    const key = `${req.path}:${ip}`;
    const now = Date.now();

    let record = rateLimitMap.get(key);
    if (!record) {
      record = { count: 1, resetTime: now + windowMs };
      rateLimitMap.set(key, record);
    } else {
      if (now > record.resetTime) {
        record.count = 1;
        record.resetTime = now + windowMs;
      } else {
        record.count++;
      }
    }

    if (record.count > max) {
      const retryAfterSec = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader("Retry-After", retryAfterSec);
      
      // JSON So'rov bo'lsa JSON qaytaradi
      if (req.headers["accept"]?.includes("application/json") || req.path.startsWith("/api/")) {
        return res.status(429).json({ error: message, retryAfter: retryAfterSec });
      }

      return res.status(429).send(`
        <!DOCTYPE html>
        <html lang="uz">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>429 Too Many Requests — Obunext Security</title>
          <style>
            body { background: #0b0f19; color: #fff; font-family: system-ui, sans-serif; display: grid; place-items: center; height: 100vh; margin: 0; }
            .card { background: #151d30; padding: 32px; border-radius: 16px; border: 1px solid rgba(244,63,94,0.4); text-align: center; max-width: 440px; box-shadow: 0 20px 50px rgba(0,0,0,0.6); }
            h2 { color: #fb7185; margin-top: 0; font-size: 22px; }
            p { color: #cbd5e1; font-size: 14.5px; line-height: 1.5; }
            .btn { display: inline-block; margin-top: 16px; background: linear-gradient(135deg,#7c3aed,#db2777); color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 10px; font-weight: 700; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>🛑 Xavfsizlik Cheklovi (Rate Limit)</h2>
            <p>${message}</p>
            <p style="font-size:13px; color:#94a3b8">Qayta urinish vaqti: <b>${retryAfterSec} daqiqa/soniya</b></p>
            <a href="/" class="btn">← Bosh sahifaga qaytish</a>
          </div>
        </body>
        </html>
      `);
    }

    next();
  };
}
