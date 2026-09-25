// .env faylini yuklaydi — env o'qiydigan har bir modul avval shuni import qiladi,
// shunda modullar qaysi tartibda yuklanishidan qat'i nazar sozlamalar tayyor bo'ladi.
// Testlarda (NODE_ENV=test) .env yuklanMAYDI: aks holda testlar production
// bazasiga ulanib, haqiqiy BASE_URL/tokenlar bilan ishlab ketardi.
import dotenv from "dotenv";

if (process.env.NODE_ENV !== "test") dotenv.config({ quiet: true });

export const isProduction = process.env.NODE_ENV === "production";
