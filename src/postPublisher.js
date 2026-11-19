/**
 * Instagram Post/Reels Scheduler — haqiqiy nashr qilish.
 *
 * /scheduler sahifasida ([web/scheduler_ui.js]) foydalanuvchi post rejalashtiradi
 * (tur, media URL, vaqt, tavsif) — bu modul davriy ravishda (src/index.js dagi
 * setInterval) barcha foydalanuvchilarning muddati kelgan postlarini Meta Graph
 * Content Publishing API orqali chinakam Instagram'ga chiqaradi.
 *
 * Ikki bosqichli Meta jarayoni:
 *   1. Media konteyner yaratish (POST /{ig-user-id}/media)
 *   2. Konteyner tayyor bo'lgach nashr qilish (POST /{ig-user-id}/media_publish)
 * Video/Reels konteyneri darhol tayyor bo'lmaydi — shuning uchun holat
 * "processing" bo'lib, keyingi tekshiruv turida status_code FINISHED bo'lganda
 * nashr qilinadi.
 *
 * Carousel (2-10 ta rasm) — bola konteynerlar + ota konteyner (CAROUSEL) orqali
 * haqiqiy nashr qilinadi (faqat rasm, video aralashmasi hozircha yo'q).
 */

import { listUsers, persist } from "./db.js";
import { createMediaContainer, createCarouselContainer, getContainerStatus, publishContainer } from "./services/instagram.js";
import { notifyPostResult } from "./reportsBot.js";

// Video/reel qayta ishlanishi shu vaqtdan ortiq davom etsa — "vaqt tugadi" deb belgilanadi
const PROCESSING_TIMEOUT_MS = 30 * 60 * 1000;

/** Bitta "pending" postni nashr qilish jarayonini boshlaydi (konteyner yaratadi). */
async function startPublishing(user, post) {
  const token = user.meta?.igAccessToken || user.meta?.pageAccessToken;
  if (!user.meta?.igUserId || !token) {
    post.status = "failed";
    post.error = "Instagram ulanmagan";
    return;
  }

  // await'dan oldin belgilaymiz: parallel chaqiruv (interval + Telegram bot) shu postni
  // yana "pending" deb ko'rib, ikkinchi marta joylab yubormasin
  post.status = "creating";
  const result =
    post.type === "carousel"
      ? await createCarouselContainer(user, { mediaUrls: post.mediaUrls || [], caption: post.caption })
      : await createMediaContainer(user, { type: post.type, mediaUrl: post.mediaUrl, caption: post.caption });

  if (result?.id) {
    post.containerId = result.id;
    post.status = "processing";
    post.processingStartedAt = new Date().toISOString();
  } else {
    post.status = "failed";
    post.error = result?.error?.message || "Media konteyner yaratib bo'lmadi";
  }
}

/** "processing" holatidagi postning konteyner holatini tekshirib, tayyor bo'lsa nashr qiladi. */
async function checkProcessing(user, post, now) {
  const startedAt = post.processingStartedAt
    ? new Date(post.processingStartedAt).getTime()
    : new Date(post.publishAt).getTime();

  if (now - startedAt > PROCESSING_TIMEOUT_MS) {
    post.status = "failed";
    post.error = "Vaqt tugadi — media qayta ishlash juda uzoq davom etdi";
    return;
  }

  const status = await getContainerStatus(user, post.containerId);
  const code = status?.status_code;

  if (code === "FINISHED") {
    const pub = await publishContainer(user, post.containerId);
    if (pub?.id) {
      post.status = "published";
      post.publishedMediaId = pub.id;
    } else {
      post.status = "failed";
      post.error = pub?.error?.message || "Nashr qilib bo'lmadi";
    }
  } else if (code === "ERROR" || code === "EXPIRED") {
    post.status = "failed";
    post.error = `Media qayta ishlashda xato (${code})`;
  }
  // IN_PROGRESS — hozircha kutamiz, keyingi turda qayta tekshiramiz
}

/** Bitta foydalanuvchining muddati kelgan/jarayondagi postlarini ko'rib chiqadi. */
export async function publishDuePosts(user, now = Date.now()) {
  let changed = false;
  for (const post of user.scheduledPosts || []) {
    if (post.status === "pending" && new Date(post.publishAt).getTime() <= now) {
      await startPublishing(user, post);
      changed = true;
    }
    // Rasm konteyneri odatda darhol tayyor — keyingi turni kutmasdan tekshiramiz
    if (post.status === "processing") {
      await checkProcessing(user, post, now);
      if (post.status !== "processing") changed = true;
    }
    if (post.source === "telegram" && (post.status === "published" || post.status === "failed") && !post.notified) {
      post.notified = true;
      changed = true;
      notifyPostResult(user, post).catch((err) => console.error("[PostPublisher] bildirishnoma xatosi:", err.message));
    }
  }

  if (changed) {
    try {
      await persist(user);
    } catch (err) {
      console.error("[PostPublisher] persist xatosi:", err.message);
    }
  }
}

/** Har chaqiruvda barcha foydalanuvchilarning muddati kelgan/jarayondagi postlarini ko'rib chiqadi. */
export async function checkAndPublishScheduledPosts() {
  const now = Date.now();
  for (const user of await listUsers()) {
    if (user.scheduledPosts?.length) await publishDuePosts(user, now);
  }
}
