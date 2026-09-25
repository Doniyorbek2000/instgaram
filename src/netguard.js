/**
 * SSRF himoyasi: foydalanuvchi kiritgan URL'larga (webhook, Google Sheets, flow'dagi
 * HTTP so'rov) server nomidan so'rov yuborishdan oldin domen DNS orqali IP'ga
 * aylantiriladi va ichki/xizmat tarmoqlariga ishora qilsa rad etiladi.
 *
 * Faqat matnni tekshirish yetarli emas: `127.0.0.1.nip.io` kabi domen yoki tashqi
 * saytdan ichki manzilga redirect orqali server ichidagi xizmatlarga (Postgres,
 * docker tarmog'i, bulut metadata 169.254.169.254) yetib borish mumkin edi.
 * Redirectlar qo'lda kuzatiladi — har bir qadam qayta tekshiriladi.
 */
import dns from "node:dns/promises";
import net from "node:net";

const BLOCKED_V4 = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
];
const v4num = (ip) => ip.split(".").reduce((n, p) => n * 256 + Number(p), 0);

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const n = v4num(ip);
    return BLOCKED_V4.some(([base, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(v4num(base) / 2 ** (32 - bits)));
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return x === "::" || x === "::1" || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x);
  }
  return true; // noma'lum format — xavfsiz tomonga
}

/** URL tashqi (ommaviy) manzilga ishora qiladimi? DNS orqali tekshiradi. */
export async function assertPublicUrl(raw, { lookup = dns.lookup } = {}) {
  let u;
  try {
    u = new URL(String(raw || ""));
  } catch {
    throw new Error("URL noto'g'ri");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("faqat http(s)");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error("ichki tarmoq manziliga ruxsat yo'q");
  return u;
}

/**
 * fetch() o'rnini bosadi: har bir so'rov va redirect manzili tekshiriladi.
 * opts.redirect === "manual" bo'lsa redirect kuzatilmaydi (javob o'zi qaytadi).
 */
export async function safeFetch(url, opts = {}, { maxRedirects = 5, fetchFn = fetch, lookup } = {}) {
  let current = String(url);
  let init = { ...opts, redirect: "manual" };
  for (let hop = 0; ; hop++) {
    await assertPublicUrl(current, { lookup });
    const res = await fetchFn(current, init);
    const location = res.headers.get("location");
    if (opts.redirect === "manual" || res.status < 300 || res.status > 399 || !location) return res;
    if (hop >= maxRedirects) throw new Error("redirectlar juda ko'p");
    current = new URL(location, current).toString();
    // 301/302/303 — brauzerlar kabi GET'ga o'tamiz (Apps Script POST → 302 → GET)
    if (res.status !== 307 && res.status !== 308) {
      const { body: _body, ...rest } = init;
      init = { ...rest, method: "GET" };
      if (init.headers) init.headers = Object.fromEntries(Object.entries(init.headers).filter(([k]) => k.toLowerCase() !== "content-type"));
    }
  }
}
