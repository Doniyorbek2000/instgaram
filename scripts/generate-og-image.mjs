/**
 * Ijtimoiy tarmoqlarda havola ulashilganda (Telegram, Facebook, Twitter/X)
 * ko'rinadigan rasmni (og:image, 1200x630) generatsiya qiladi. Bir martalik
 * skript — natija assets/og-image.png ga saqlanadi va shu fayl serverdan
 * statik tarzda beriladi (har so'rovda qayta chizilmaydi).
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets");
mkdirSync(outDir, { recursive: true });

const W = 1200;
const H = 630;

const svg = `
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="${W}" y2="${H}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#7c3aed"/>
      <stop offset="0.55" stop-color="#db2777"/>
      <stop offset="1" stop-color="#f97316"/>
    </linearGradient>
    <radialGradient id="glow" cx="82%" cy="12%" r="60%">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="logoBg" x1="0" y1="0" x2="130" y2="130" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#fdf2f8"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <!-- Logo mark (chat-bubble belgisi, brand.js dagi logoMark bilan bir xil naqsh, kattalashtirilgan) -->
  <g transform="translate(80,72)">
    <rect width="130" height="130" rx="34" fill="url(#logoBg)"/>
    <rect x="31" y="40" width="55" height="41" rx="14" fill="#7c3aed"/>
    <path d="M44 81h18l-18 14z" fill="#7c3aed"/>
    <circle cx="47" cy="60.5" r="4.8" fill="#fff"/>
    <circle cx="58.5" cy="60.5" r="4.8" fill="#fff"/>
    <circle cx="70" cy="60.5" r="4.8" fill="#fff"/>
    <path d="M100 22l3.4 8 8 3.4-8 3.4-3.4 8-3.4-8-8-3.4 8-3.4z" fill="#f97316"/>
  </g>

  <text x="240" y="150" font-family="Arial, sans-serif" font-size="58" font-weight="800" fill="#ffffff" letter-spacing="-1">ADM AI</text>

  <text x="80" y="300" font-family="Arial, sans-serif" font-size="60" font-weight="800" fill="#ffffff" letter-spacing="-1.5">Mijozlaringizga AI</text>
  <text x="80" y="372" font-family="Arial, sans-serif" font-size="60" font-weight="800" fill="#ffffff" letter-spacing="-1.5">javob bersin 24/7</text>

  <text x="80" y="430" font-family="Arial, sans-serif" font-size="26" font-weight="500" fill="#fdf2f8" opacity="0.95">Instagram, WhatsApp va Facebook uchun rasmiy Meta API</text>
  <text x="80" y="465" font-family="Arial, sans-serif" font-size="26" font-weight="500" fill="#fdf2f8" opacity="0.95">orqali ishlaydigan sun'iy intellektli Sales avtomatlashtirish.</text>

  <!-- Pastki "trust" chizig'i -->
  <g transform="translate(80,530)">
    <rect width="360" height="46" rx="23" fill="#ffffff" fill-opacity="0.16"/>
    <circle cx="26" cy="23" r="6" fill="#4ade80"/>
    <text x="42" y="30" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#ffffff">500+ tadbirkor ishonch bildirgan</text>
  </g>

  <text x="1120" y="580" text-anchor="end" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#ffffff" opacity="0.85">chat.voxo.uz</text>
</svg>
`;

const outPath = path.join(outDir, "og-image.png");
await sharp(Buffer.from(svg)).png({ quality: 90 }).toFile(outPath);
console.log("OG image generated:", outPath);

// Favicon — brand.js dagi logoMark bilan bir xil naqsh, real (data: URI emas)
// PNG fayl sifatida. Ko'p havola-preview bot va qidiruv tizimlari data: URI
// favicon'ni o'qiy olmaydi — shuning uchun haqiqiy statik fayl kerak.
const faviconSvg = `
<svg width="512" height="512" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="fg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
      <stop stop-color="#7c3aed"/><stop offset=".55" stop-color="#db2777"/><stop offset="1" stop-color="#f97316"/>
    </linearGradient>
  </defs>
  <rect width="40" height="40" rx="11" fill="url(#fg)"/>
  <rect x="9.5" y="12.5" width="17" height="12.5" rx="4.2" fill="#fff"/>
  <path d="M13.5 25h5.5l-5.5 4.3z" fill="#fff"/>
  <circle cx="14.4" cy="18.7" r="1.5" fill="#7c3aed"/>
  <circle cx="18" cy="18.7" r="1.5" fill="#db2777"/>
  <circle cx="21.6" cy="18.7" r="1.5" fill="#f97316"/>
  <path d="M29 8.6l1.05 2.5 2.5 1.05-2.5 1.05L29 15.7l-1.05-2.5-2.5-1.05 2.5-1.05z" fill="#fff"/>
</svg>
`;
const faviconPath = path.join(outDir, "favicon.png");
await sharp(Buffer.from(faviconSvg)).resize(512, 512).png().toFile(faviconPath);
console.log("Favicon generated:", faviconPath);
