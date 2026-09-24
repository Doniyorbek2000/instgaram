/**
 * Brend logotipi — emoji emas, haqiqiy SVG belgi.
 * Har chaqiruvda gradient id noyob bo'lishi uchun idSuffix beriladi.
 */
let _c = 0;

export function logoMark(size = 34) {
  const id = "lg" + ++_c;
  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display:block">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
        <stop stop-color="#7c3aed"/><stop offset=".55" stop-color="#db2777"/><stop offset="1" stop-color="#f97316"/>
      </linearGradient>
    </defs>
    <rect width="40" height="40" rx="11" fill="url(#${id})"/>
    <rect x="9.5" y="12.5" width="17" height="12.5" rx="4.2" fill="#fff"/>
    <path d="M13.5 25h5.5l-5.5 4.3z" fill="#fff"/>
    <circle cx="14.4" cy="18.7" r="1.5" fill="#7c3aed"/>
    <circle cx="18" cy="18.7" r="1.5" fill="#db2777"/>
    <circle cx="21.6" cy="18.7" r="1.5" fill="#f97316"/>
    <path d="M29 8.6l1.05 2.5 2.5 1.05-2.5 1.05L29 15.7l-1.05-2.5-2.5-1.05 2.5-1.05z" fill="#fff"/>
  </svg>`;
}

/** To'liq logotip: belgi + matn (ixtiyoriy) */
export function logo(size = 32, { text = true, textColor = "" } = {}) {
  return `<span class="brand-lockup" style="display:inline-flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-.02em;${textColor ? `color:${textColor}` : ""}">
    ${logoMark(size)}${text ? `<span class="brand-txt">AI Biznes Yordamchi</span>` : ""}
  </span>`;
}
