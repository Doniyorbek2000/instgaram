/**
 * Brend logotipi — emoji emas, haqiqiy SVG belgi.
 * Har chaqiruvda gradient id noyob bo'lishi uchun idSuffix beriladi.
 */
let _c = 0;

export function logoMark(size = 34) {
  return `<img src="/logo.webp" width="${size}" height="${size}" alt="Obunext" decoding="async" style="display:inline-block;vertical-align:middle;flex:none;width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.24)}px" onerror="this.onerror=null;this.src='/logo.png'">`;
}

/** To'liq logotip: belgi + matn (ixtiyoriy) */
export function logo(size = 32, { text = true, textColor = "" } = {}) {
  return `<span class="brand-lockup" style="display:inline-flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-.02em;${textColor ? `color:${textColor}` : ""}">
    ${logoMark(size)}${text ? `<span class="brand-txt">Obunext</span>` : ""}
  </span>`;
}
