/**
 * ADM AI style Web Post & Reels Scheduler UI (/scheduler)
 */

import { Router } from "express";
import { requireAuth } from "../auth.js";
import { persist } from "../db.js";
import { page, esc } from "./layout.js";

export const schedulerRouter = Router();

schedulerRouter.get("/scheduler", requireAuth, (req, res) => {
  const u = req.user;
  const posts = u.scheduledPosts || [];
  const saved = req.query.saved;

  const postListHtml = posts.length
    ? posts
        .map(
          (p) => `
          <div class="card" style="margin-bottom:14px">
            <div style="display:flex; justify-content:space-between; align-items:center">
              <div>
                <span class="status-tag" style="background:rgba(217,70,239,0.2); color:#f0abfc; border:1px solid rgba(217,70,239,0.4)">
                  ${esc((p.type || "IMAGE").toUpperCase())}
                </span>
                <b style="font-size:14.5px; margin-left:10px; color:#fff">📅 ${new Date(p.publishAt).toLocaleString("uz")}</b>
              </div>
              <div style="display:flex; gap:8px; align-items:center">
                ${
                  p.status === "published"
                    ? `<span class="badge-success">✅ Joylandi</span>`
                    : p.status === "failed"
                      ? `<span class="badge-warn">❌ Xato: ${esc(p.error || "")}</span>`
                      : p.status === "processing"
                        ? `<span class="status-tag" style="background:rgba(139,92,246,0.2); color:#c4b5fd">🔄 Nashr qilinmoqda...</span>`
                        : `<span class="status-tag" style="background:rgba(234,179,8,0.2); color:#facc15">⏳ Kutilmoqda</span>`
                }
                <form method="post" action="/scheduler/delete" style="margin:0" onsubmit="return confirm('Postni o\'chirishga ishonchingiz komilmi?')">
                  <input type="hidden" name="id" value="${esc(p.id)}">
                  <button type="submit" class="secondary" style="padding:4px 8px; font-size:12px; margin:0; color:#f87171">🗑️</button>
                </form>
              </div>
            </div>
            <div style="margin-top:12px; font-size:14px; color:#f8fafc"><b>Tavsif:</b> ${esc(p.caption || "[Tavsifsiz]")}</div>
            <div style="margin-top:6px; font-size:12px" class="hint">
              ${
                p.type === "carousel"
                  ? `Carousel (${(p.mediaUrls || []).length} ta rasm): ` + (p.mediaUrls || []).map((u) => `<code style="background:#0f172a; padding:2px 6px; border-radius:4px; color:#a78bfa; margin-right:4px">${esc(u)}</code>`).join("")
                  : `Media fayl URL: <code style="background:#0f172a; padding:2px 6px; border-radius:4px; color:#a78bfa">${esc(p.mediaUrl || "")}</code>`
              }
            </div>
          </div>
        `
        )
        .join("")
    : `<div class="card hint" style="text-align:center; padding:40px">Hali rejalashtirilgan postlar yo'q.</div>`;

  res.send(
    page(
      "Post Scheduler",
      `
      ${saved ? `<div class="ok">Post muvaffaqiyatli rejalashtirildi! ✅</div>` : ""}

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px">
        <div>
          <h2>📅 Instagram Post & Reels Scheduler Studio</h2>
          <p class="hint">Rasm, Reels va Karusellarni belgilangan vaqtda avtomatik joylash.</p>
        </div>
      </div>

      <!-- Publishing Guide Box -->
      <div class="card" style="background: linear-gradient(135deg, rgba(217,70,239,0.12) 0%, rgba(139,92,246,0.12) 100%); border:1px solid rgba(217,70,239,0.3); margin-bottom:20px">
        <b style="color:#f0abfc; font-size:15px">💡 Mukammal Post & Reels Rejalashtirish Qo'llanmasi</b>
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-top:10px">
          <div style="font-size:12.5px; color:#cbd5e1"><b>📷 Rasm formati:</b> Direct HTTPS URL (JPG, PNG). 1080x1080px.</div>
          <div style="font-size:12.5px; color:#cbd5e1"><b>🎬 Reels formati:</b> MP4 video URL (9:16 vertikal, max 60s).</div>
          <div style="font-size:12.5px; color:#cbd5e1"><b>⏰ Prime Time:</b> Eng yaxshi vaqtlar: 12:30, 19:00, 21:30.</div>
        </div>
      </div>

      <div class="grid split-form">
        <div>
          ${postListHtml}
        </div>

        <div class="card" style="height:fit-content; border: 1px solid #7c3aed">
          <h3 style="margin-top:0; font-size:18px; color:#fff">➕ Yangi Post Rejalashtirish</h3>
          <form method="post" action="/scheduler/add" onsubmit="return window.prepScheduleSubmit(this)">
            <label>Post turi</label>
            <select name="type" onchange="window.toggleScheduleMediaField(this.value)">
              <option value="image">🖼️ Rasm (Image)</option>
              <option value="reel">🎬 Reels / Video</option>
              <option value="carousel">🎠 Karusel (Carousel — 2-10 ta rasm)</option>
            </select>

            <div id="singleMediaField">
              <label>Media fayl manzili (HTTPS URL)</label>
              <input type="url" name="mediaUrl" id="mediaUrlInput" placeholder="https://example.com/photo.jpg" required>
            </div>

            <div id="carouselMediaField" style="display:none">
              <label>Rasm URL'lari (har qatorda bittadan, 2-10 ta)</label>
              <textarea id="mediaUrlsInput" rows="4" placeholder="https://example.com/1.jpg&#10;https://example.com/2.jpg"></textarea>
              <input type="hidden" name="mediaUrls" id="mediaUrlsHidden">
            </div>

            <label>Joylash vaqti (Publish Time)</label>
            <input type="datetime-local" name="publishAt" required style="color-scheme:dark">

            <label>Post tavsifi (Caption)</label>
            <textarea name="caption" rows="4" placeholder="Post matni va heshteglar..."></textarea>

            <button type="submit" class="btn" style="width:100%; margin-top:16px">💾 Rejalashtirish</button>
          </form>
        </div>

        <script>
          window.toggleScheduleMediaField = function(type) {
            const single = document.getElementById('singleMediaField');
            const carousel = document.getElementById('carouselMediaField');
            const singleInput = document.getElementById('mediaUrlInput');
            if (type === 'carousel') {
              single.style.display = 'none';
              carousel.style.display = 'block';
              singleInput.required = false;
            } else {
              single.style.display = 'block';
              carousel.style.display = 'none';
              singleInput.required = true;
            }
          };
          window.prepScheduleSubmit = function(form) {
            if (form.type.value === 'carousel') {
              const lines = document.getElementById('mediaUrlsInput').value
                .split('\\n').map(function(s) { return s.trim(); }).filter(Boolean);
              if (lines.length < 2 || lines.length > 10) {
                alert("Carousel uchun 2 dan 10 gacha rasm URL kiriting (har qatorda bittadan).");
                return false;
              }
              document.getElementById('mediaUrlsHidden').value = JSON.stringify(lines);
            }
            return true;
          };
        </script>
      </div>
      `,
      { user: u, active: "scheduler" }
    )
  );
});

schedulerRouter.post("/scheduler/add", requireAuth, (req, res) => {
  const u = req.user;
  const { type, mediaUrl, mediaUrls, publishAt, caption } = req.body || {};
  if (!publishAt) return res.redirect("/scheduler");

  let parsedMediaUrls = [];
  if (type === "carousel") {
    try {
      parsedMediaUrls = JSON.parse(mediaUrls || "[]");
    } catch {
      parsedMediaUrls = [];
    }
    if (!Array.isArray(parsedMediaUrls) || parsedMediaUrls.length < 2 || parsedMediaUrls.length > 10) {
      return res.redirect("/scheduler");
    }
  } else if (!mediaUrl) {
    return res.redirect("/scheduler");
  }

  u.scheduledPosts ||= [];
  u.scheduledPosts.unshift({
    id: `post_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: type || "image",
    mediaUrl: mediaUrl || "",
    mediaUrls: parsedMediaUrls,
    publishAt: new Date(publishAt).toISOString(),
    caption: caption || "",
    status: "pending",
    createdAt: new Date().toISOString(),
  });

  persist(u);
  res.redirect("/scheduler?saved=1");
});

schedulerRouter.post("/scheduler/delete", requireAuth, (req, res) => {
  const u = req.user;
  const { id } = req.body || {};
  if (u.scheduledPosts) {
    u.scheduledPosts = u.scheduledPosts.filter((p) => p.id !== id);
    persist(u);
  }
  res.redirect("/scheduler");
});
