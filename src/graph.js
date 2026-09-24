import { graphUrl, igGraphUrl } from "./config.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Graph API'ga GET so'rov (OAuth va sahifa/IG ma'lumotlarini olish uchun).
 * params — query obyekt. Xato bo'lsa { error } qaytaradi.
 */
async function doGet(urlFor, path, params = {}, token = "") {
  const queryParams = { ...params };
  if (token && !queryParams.access_token) {
    queryParams.access_token = token;
  }
  const qs = new URLSearchParams(queryParams).toString();
  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(urlFor(qs ? `${path}?${qs}` : path), { headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`Graph GET xatosi [${path}] (${res.status}):`, JSON.stringify(data).slice(0, 300));
      return { error: data.error || { message: `HTTP ${res.status}` } };
    }
    return data;
  } catch (err) {
    console.error(`Graph GET tarmoq xatosi [${path}]:`, err.message);
    return { error: { message: err.message } };
  }
}


/**
 * Meta Graph API'ga POST so'rov yuboradi. Tarmoq/server xatosida
 * eksponensial kutish bilan qayta uriniladi (2s, 4s). Xato bo'lsa null.
 * Bitta xabar xato bo'lsa butun server yiqilmasligi kerak.
 */
async function doPost(urlFor, path, body, accessToken, retries) {
  if (!accessToken) {
    console.error(`Graph API [${path}]: access token yo'q — o'tkazib yuborildi`);
    return null;
  }

  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(urlFor(path), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Tarmoq xatosi — qayta urinamiz
      if (attempt < retries) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      console.error(`Graph API [${path}] tarmoq xatosi:`, err.message);
      return null;
    }

    const data = await res.json().catch(() => ({}));
    // Meta ba'zan HTTP 200 bilan javob berib, xatoni JSON tanasida qaytaradi
    // ("soft error") — bu holat oldin sukut saqlab (log'siz) qaytar edi, endi
    // diagnostika uchun albatta log qilinadi.
    if (res.ok) {
      if (data?.error) {
        console.error(`Graph API "soft" xatosi [${path}]:`, JSON.stringify(data.error).slice(0, 300));
      }
      return data;
    }

    // 5xx — vaqtinchalik, qayta urinamiz; 4xx — qayta urinishning foydasi yo'q
    if (res.status >= 500 && attempt < retries) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    console.error(`Graph API xatosi [${path}] (${res.status}):`, JSON.stringify(data).slice(0, 300));
    return null;
  }
}

// Facebook Graph (graph.facebook.com) — Page/WhatsApp uchun
export const graphGet = (path, params, token) => doGet(graphUrl, path, params, token);
export const graphPost = (path, body, token, { retries = 2 } = {}) =>
  doPost(graphUrl, path, body, token, retries);

// Instagram Graph (graph.instagram.com) — Instagram Login uchun
export const igGraphGet = (path, params, token) => doGet(igGraphUrl, path, params, token);
export const igGraphPost = (path, body, token, { retries = 2 } = {}) =>
  doPost(igGraphUrl, path, body, token, retries);

