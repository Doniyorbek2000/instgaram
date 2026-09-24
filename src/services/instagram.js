import { graphPost, igGraphPost, graphGet, igGraphGet, igGraphDelete } from "../graph.js";

// Instagram Login tokeni (yo'q bo'lsa — eski Page token bilan orqaga moslik).
const igToken = (tenant) => tenant?.meta?.igAccessToken || tenant?.meta?.pageAccessToken || "";

/**
 * Foydalanuvchi profil ma'lumotlarini Meta Instagram Graph API dan oladi.
 * fields: name, username, profile_pic, is_user_follow_business, is_business_follow_user
 */
export async function getUserProfile(tenant, igsid) {
  const token = igToken(tenant);
  if (!token || !igsid) return null;

  // Instagram Graph API orqali so'rov
  const res1 = await igGraphGet(
    igsid,
    { fields: "name,username,profile_pic,is_user_follow_business,is_business_follow_user" },
    token
  );
  if (res1 && !res1.error) return res1;

  // Facebook Graph API orqali zaxira so'rov
  const res2 = await graphGet(
    igsid,
    { fields: "name,username,profile_pic,is_user_follow_business,is_business_follow_user" },
    token
  );
  if (res2 && !res2.error) return res2;

  return null;
}

/**
 * Foydalanuvchining obunachilari soni (geymifikatsiyadagi "minimal obunachi" sharti
 * uchun). Alohida so'rov — getUserProfile'ga qo'shilmagan, chunki maydon
 * qaytmasa asosiy Follower Gate so'rovi ham buzilib qolmasin. null — noma'lum.
 */
export async function getUserFollowerCount(tenant, igsid) {
  const token = igToken(tenant);
  if (!token || !igsid) return null;
  const res = await igGraphGet(igsid, { fields: "follower_count" }, token);
  return res && !res.error && typeof res.follower_count === "number" ? res.follower_count : null;
}

/**
 * Obuna holati: true / false / null (aniqlab bo'lmadi).
 * Meta komment egasining profilini u Direct'da javob bermaguncha (tugma bosish ham
 * hisob) ko'pincha bermaydi — shunda null qaytadi.
 */
export async function getFollowStatus(tenant, igsid) {
  const profile = await getUserProfile(tenant, igsid);
  if (!profile || typeof profile.is_user_follow_business !== "boolean") return null;
  return profile.is_user_follow_business;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const FOLLOW_RECHECK_MS = { value: 2500 };

/**
 * Foydalanuvchi biznes sahifasiga obuna bo'lganmi (Follower Gate) — qat'iy: aniqlab
 * bo'lmasa false. Mijoz "Obuna bo'ldim" deb bosganda Meta yangi obunani darhol
 * ko'rsatmasligi mumkin, shuning uchun "yo'q" chiqsa bir marta qayta tekshiriladi.
 */
export async function checkFollowerStatus(tenant, igsid) {
  const first = await getFollowStatus(tenant, igsid);
  if (first === true) return true;
  await sleep(FOLLOW_RECHECK_MS.value);
  return (await getFollowStatus(tenant, igsid)) === true;
}

/** Instagram kommentiga ochiq (public) javob yozadi. */
export function replyToComment(tenant, commentId, message) {
  return igGraphPost(`${commentId}/replies`, { message }, igToken(tenant));
}

/** Instagram kommentiga biznes akkaunt nomidan "layk" bosadi (Comment Moderation API). */
export function likeComment(tenant, commentId) {
  return igGraphPost(`${commentId}/likes`, {}, igToken(tenant));
}

/**
 * Komment egasiga Direct'ga shaxsiy javob (Private Reply) yuboradi.
 * Meta qoidasi: faqat komment yozilganidan keyin 7 kun ichida mumkin.
 */
export async function privateReplyToComment(tenant, commentId, text, quickReplies = []) {
  const token = igToken(tenant);
  const qr = (quickReplies || [])
    .filter((o) => o && o.title && o.payload)
    .slice(0, 13)
    .map((o) => ({ content_type: "text", title: String(o.title).slice(0, 20), payload: String(o.payload) }));
  if (qr.length) {
    // Tugmali private reply — mijoz tugmani bosishi bilan 24 soatlik suhbat oynasi
    // ochiladi va flow davom etadi. API rad etsa, oddiy matnga qaytamiz.
    const withButtons = await igGraphPost(
      "me/messages",
      { recipient: { comment_id: commentId }, message: { text: String(text), quick_replies: qr } },
      token
    );
    if (withButtons && !withButtons.error) return withButtons;
  }
  // Tugmalar qabul qilinmasa — raqamli variantlar: mijoz "1" yoki tugma nomini yozadi
  const body = qr.length
    ? `${text}\n\n${qr.map((o, i) => `${i + 1}. ${o.title}`).join("\n")}\n\n👉 Raqamini yozib yuboring`
    : String(text);
  return igGraphPost(
    "me/messages",
    { recipient: { comment_id: commentId }, message: { text: body } },
    token
  );
}

/**
 * Instagram "Salomlashuv tugmalari" (Ice Breakers) — mijoz birinchi marta Direct
 * ochganda, hali hech narsa yozmasidan OLDIN ko'rinadigan savollar.
 * items: [{ question, payload }] (maksimal 4 ta). Bo'sh ro'yxat — o'chiradi.
 */
export async function setIceBreakers(tenant, items = []) {
  const token = igToken(tenant);
  if (!token) return { error: { message: "Instagram ulanmagan" } };
  const list = (items || [])
    .filter((i) => i && i.question)
    .slice(0, 4)
    .map((i) => ({ question: String(i.question).slice(0, 80), payload: String(i.payload || i.question).slice(0, 1000) }));
  if (!list.length) {
    return igGraphDelete("me/messenger_profile", { fields: ["ice_breakers"] }, token);
  }
  return igGraphPost(
    "me/messenger_profile",
    { platform: "instagram", ice_breakers: [{ call_to_actions: list, locale: "default" }] },
    token
  );
}

/** Instagram Direct (DM) xabariga oddiy matnli javob yuboradi. */
export async function sendDirectMessage(tenant, igsid, text) {
  const token = igToken(tenant);
  if (!token || !igsid || !text) return null;

  const payload = { recipient: { id: igsid }, message: { text: String(text) } };

  const res1 = await igGraphPost("me/messages", payload, token);
  if (res1 && !res1.error) return res1;

  return graphPost("me/messages", payload, token);
}

/**
 * Instagram Direct'ga Tezkor Tugmalar (Quick Replies) yuboradi.
 * quickReplies: [{ title: "Obuna bo'ldim ✅", payload: "CHECK_FOLLOW" }, ...] yoki stringlar
 */
export async function sendDirectQuickReplies(tenant, igsid, text, quickReplies = []) {
  const token = igToken(tenant);
  if (!token || !igsid) return null;

  const formattedQuickReplies = quickReplies.map((qr) => {
    if (typeof qr === "string") {
      return {
        content_type: "text",
        title: qr.slice(0, 20),
        payload: qr,
      };
    }
    return {
      content_type: "text",
      title: String(qr.title || "").slice(0, 20),
      payload: String(qr.payload || qr.title || "QR_CLICK"),
    };
  });

  const payload = {
    recipient: { id: igsid },
    message: {
      text: String(text),
      quick_replies: formattedQuickReplies,
    },
  };

  const res1 = await igGraphPost("me/messages", payload, token);
  if (res1 && !res1.error) return res1;

  return graphPost("me/messages", payload, token);
}

/**
 * Instagram Direct'ga CTA Tugmali Kartochka (Button Template) yuboradi.
 * buttons: [{ type: "web_url", url: "https://...", title: "Saytga o'tish" }, ...]
 */
export async function sendDirectButtons(tenant, igsid, text, buttons = []) {
  const token = igToken(tenant);
  if (!token || !igsid) return null;

  const payload = {
    recipient: { id: igsid },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: String(text),
          buttons: buttons.map((b) => ({
            type: b.type || (b.url ? "web_url" : "postback"),
            title: String(b.title || "").slice(0, 20),
            ...(b.url ? { url: b.url } : {}),
            ...(b.payload ? { payload: b.payload } : { payload: b.title || "BTN_CLICK" }),
          })),
        },
      },
    },
  };

  const res1 = await igGraphPost("me/messages", payload, token);
  if (res1 && !res1.error) return res1;

  return graphPost("me/messages", payload, token);
}

/**
 * Instagram Direct'ga Rasmli Kartochka (Generic Template) yuboradi.
 */
export async function sendDirectGenericCard(tenant, igsid, { title, subtitle = "", imageUrl = "", buttons = [] }) {
  const token = igToken(tenant);
  if (!token || !igsid) return null;

  const element = {
    title: String(title || "").slice(0, 80),
    ...(subtitle ? { subtitle: String(subtitle).slice(0, 80) } : {}),
    ...(imageUrl ? { image_url: imageUrl } : {}),
    ...(buttons.length ? {
      buttons: buttons.map((b) => ({
        type: b.type || (b.url ? "web_url" : "postback"),
        title: String(b.title || "").slice(0, 20),
        ...(b.url ? { url: b.url } : {}),
        ...(b.payload ? { payload: b.payload } : { payload: b.title || "BTN_CLICK" }),
      })),
    } : {}),
  };

  const payload = {
    recipient: { id: igsid },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [element],
        },
      },
    },
  };

  const res1 = await igGraphPost("me/messages", payload, token);
  if (res1 && !res1.error) return res1;

  return graphPost("me/messages", payload, token);
}

/**
 * Akkauntning haqiqiy profil statistikasi (Business Discovery emas — o'z profili,
 * shuning uchun oddiy field so'rovi bilan ishlaydi, Insights API'dan farqli
 * ravishda versiyaga unchalik bog'liq emas — eng ishonchli manba).
 */
export async function getProfileStats(tenant) {
  const token = igToken(tenant);
  const igUserId = tenant?.meta?.igUserId;
  if (!token || !igUserId) return { error: { message: "Instagram ulanmagan" } };

  const res = await igGraphGet(
    igUserId,
    { fields: "username,biography,website,followers_count,media_count" },
    token
  );
  if (res && !res.error) return res;
  return graphGet(igUserId, { fields: "username,biography,website,followers_count,media_count" }, token);
}

/**
 * Business Discovery — ULANGAN akkaunt orqali BOSHQA istalgan ochiq Instagram
 * Business/Creator akkauntining (masalan raqobatchining) haqiqiy ommaviy
 * ma'lumotlarini o'qiydi (Meta rasmiy API'si, faqat business_discovery uchun
 * mo'ljallangan — shaxsiy akkauntlar va yashirin profillar qaytmaydi).
 * Javob: { username, name, biography, website, followers_count, media_count }
 * yoki { error } (masalan target topilmasa yoki business akkaunt bo'lmasa).
 */
export async function getBusinessDiscovery(tenant, targetUsername) {
  const token = igToken(tenant);
  const igUserId = tenant?.meta?.igUserId || tenant?.meta?.pageId;
  const uname = String(targetUsername || "").trim().replace(/^@/, "");
  if (!token || !igUserId) return { error: { message: "Instagram ulanmagan" } };
  if (!uname) return { error: { message: "Akkaunt nomi kiritilmagan" } };

  const field = `business_discovery.username(${uname}){username,name,biography,website,followers_count,media_count}`;
  const res = await graphGet(igUserId, { fields: field }, token);
  if (res?.business_discovery) return res.business_discovery;
  if (res?.error) return { error: res.error };
  return { error: { message: "@" + uname + " uchun ommaviy biznes ma'lumoti topilmadi (akkaunt shaxsiy yoki mavjud emas bo'lishi mumkin)" } };
}

/**
 * Haqiqiy Instagram Insights (reach, profile_views) — oxirgi N kun.
 * Meta metrikalarni ba'zan API versiyasiga qarab o'zgartiradi — shuning uchun
 * xato bo'lsa Meta'ning o'z xabari qaytariladi (hech qachon o'ylab topilgan
 * raqam ko'rsatilmaydi).
 */
export async function getAccountInsights(tenant, days = 7) {
  const token = igToken(tenant);
  const igUserId = tenant?.meta?.igUserId;
  if (!token || !igUserId) return { error: { message: "Instagram ulanmagan" } };

  const until = Math.floor(Date.now() / 1000);
  const since = until - days * 86400;

  const res = await igGraphGet(
    `${igUserId}/insights`,
    { metric: "reach,profile_views", period: "day", since, until },
    token
  );
  if (res && !res.error) return res;
  return graphGet(`${igUserId}/insights`, { metric: "reach,profile_views", period: "day", since, until }, token);
}

/** "Yozmoqda…" ko'rsatkichi va o'qildi belgisi (tirik operator taassuroti). */
export function showTyping(tenant, igsid) {
  return igGraphPost(
    "me/messages",
    { recipient: { id: igsid }, sender_action: "typing_on" },
    igToken(tenant)
  );
}

// ==================== Post/Reels nashr qilish (Content Publishing API) ====================
// Eslatma: bu endpointlar "me" emas, aynan tenant.meta.igUserId'ni talab qiladi —
// messaging endpointlaridan farqli.

/**
 * Media konteyner yaratadi (nashr qilishning 1-bosqichi).
 * type: "image" | "reel". Javob: { id } yoki { error }.
 */
export function createMediaContainer(tenant, { type, mediaUrl, caption = "" }) {
  const igUserId = tenant?.meta?.igUserId;
  const token = igToken(tenant);
  if (!igUserId || !token) return Promise.resolve({ error: { message: "Instagram ulanmagan" } });

  const payload =
    type === "reel"
      ? { media_type: "REELS", video_url: mediaUrl, caption }
      : { image_url: mediaUrl, caption };

  return igGraphPost(`${igUserId}/media`, payload, token);
}

/** Konteyner holatini tekshiradi (video/reel qayta ishlanishini kutish uchun). */
export function getContainerStatus(tenant, containerId) {
  return igGraphGet(containerId, { fields: "status_code" }, igToken(tenant));
}

/** Tayyor konteynerni Instagram'da chop etadi (2-bosqich). Javob: { id: publishedMediaId }. */
export function publishContainer(tenant, containerId) {
  const igUserId = tenant?.meta?.igUserId;
  const token = igToken(tenant);
  if (!igUserId || !token) return Promise.resolve({ error: { message: "Instagram ulanmagan" } });
  return igGraphPost(`${igUserId}/media_publish`, { creation_id: containerId }, token);
}

/**
 * Carousel (2-10 ta rasm) uchun ota konteyner yaratadi — avval har bir rasm
 * uchun "bola" konteyner, so'ng ularni birlashtiruvchi ota konteyner.
 * Faqat rasm carousel qo'llab-quvvatlanadi (video aralashmasi hozircha yo'q).
 * Javob: { id: parentContainerId } yoki { error }.
 */
export async function createCarouselContainer(tenant, { mediaUrls, caption = "" }) {
  const igUserId = tenant?.meta?.igUserId;
  const token = igToken(tenant);
  if (!igUserId || !token) return { error: { message: "Instagram ulanmagan" } };
  if (!Array.isArray(mediaUrls) || mediaUrls.length < 2 || mediaUrls.length > 10) {
    return { error: { message: "Carousel uchun 2 dan 10 gacha rasm URL kerak" } };
  }

  const childIds = [];
  for (const url of mediaUrls) {
    const child = await igGraphPost(`${igUserId}/media`, { image_url: url, is_carousel_item: true }, token);
    if (!child?.id) {
      return { error: { message: `Bola konteyner yaratilmadi (${url.slice(0, 60)}): ${child?.error?.message || "noma'lum xato"}` } };
    }
    childIds.push(child.id);
  }

  return igGraphPost(`${igUserId}/media`, { media_type: "CAROUSEL", children: childIds, caption }, token);
}

/** Akkauntning so'nggi postlari — "Tasodifiy G'olib" uchun post tanlash ro'yxati. */
export function getRecentMedia(tenant, limit = 12, after = "") {
  const igUserId = tenant?.meta?.igUserId;
  const token = igToken(tenant);
  if (!igUserId || !token) return Promise.resolve({ error: { message: "Instagram ulanmagan" } });
  const params = { fields: "id,caption,thumbnail_url,media_url,media_type,media_product_type,permalink,timestamp", limit };
  if (after) params.after = after;
  return igGraphGet(`${igUserId}/media`, params, token);
}

/** Bitta post ostidagi kommentlar ro'yxati — g'olibni tasodifiy tanlash uchun. Javob: { data: [...] }. */
export function getMediaComments(tenant, mediaId, limit = 100) {
  const token = igToken(tenant);
  if (!token) return Promise.resolve({ error: { message: "Instagram ulanmagan" } });
  return igGraphGet(`${mediaId}/comments`, { fields: "id,text,username,timestamp", limit }, token);
}

