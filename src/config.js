import "dotenv/config";

export const config = {
  port: Number(process.env.PORT || 3000),
  verifyToken: process.env.VERIFY_TOKEN || "",
  appSecret: process.env.APP_SECRET || "",
  graphApiVersion: process.env.GRAPH_API_VERSION || "v21.0",
  // Admin (dasturchi) email'i — bu foydalanuvchi barcha bizneslarning
  // Meta tokenlarini boshqara oladi. Vergul bilan bir nechta bo'lishi mumkin.
  // MUHIM: faqat .env dan olinadi. Kodga qattiq yozilgan email bo'lmasligi shart —
  // ro'yxatdan o'tishda email tasdiqlanmaydi, ya'ni shu emailni birinchi bo'lib
  // band qilgan har kim admin bo'lib qolardi.
  adminEmails: (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.toLowerCase().trim())
    .filter(Boolean),
  // Facebook OAuth uchun (Messenger/WhatsApp qismlarida ishlatiladi)
  fbAppId: process.env.FB_APP_ID || "",
  // "Instagram bilan ulash" (Instagram API with Instagram Login) uchun.
  // Bular Facebook App ID/Secret'dan boshqa: Meta panel → Use cases →
  // Instagram → API setup with Instagram login bo'limida turadi.
  igAppId: process.env.IG_APP_ID || "",
  igAppSecret: process.env.IG_APP_SECRET || "",
  // OAuth redirect uchun tashqi manzil, masalan: https://bot.example.uz
  baseUrl: (process.env.BASE_URL || "").replace(/\/$/, ""),
  // "Google bilan kirish" (ro'yxatdan o'tish/kirish uchun, ijtimoiy tarmoq
  // ulash bilan aloqasi yo'q) — Google Cloud Console → APIs & Services →
  // Credentials → OAuth 2.0 Client ID (Web application) dan olinadi.
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  // ==== Payme to'lov tizimi ====
  payme: {
    merchantId: process.env.PAYME_MERCHANT_ID || "",
    // Merchant kabinetdan olingan kalit (webhook Basic-auth paroli sifatida ishlatiladi)
    key: process.env.PAYME_KEY || "",
    // true bo'lsa test checkout (test.paycom.uz) ishlatiladi
    test: String(process.env.PAYME_TEST || "").toLowerCase() === "true",
    // Payme merchant kabinetida sozlangan "account" maydoni nomi
    accountField: process.env.PAYME_ACCOUNT_FIELD || "order_id",
  },
};

/** Payme sozlanganmi? */
export const paymeReady = Boolean(
  process.env.PAYME_MERCHANT_ID && process.env.PAYME_KEY
);

// "Facebook bilan ulash" uchun so'raladigan ruxsatlar
export const OAUTH_SCOPES = [
  "pages_show_list",
  "pages_manage_metadata",
  "pages_messaging",
  "instagram_basic",
  "instagram_manage_messages",
  "instagram_manage_comments",
  "business_management",
].join(",");

export const graphUrl = (path) =>
  `https://graph.facebook.com/${config.graphApiVersion}/${path}`;

// Instagram API with Instagram Login uchun (graph.instagram.com)
export const igGraphUrl = (path) =>
  `https://graph.instagram.com/${config.graphApiVersion}/${path}`;
