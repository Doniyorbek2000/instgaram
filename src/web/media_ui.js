/**
 * Media kutubxonasi (/media) va yuklash API'si.
 *  - POST /media/upload     — fayl yuklash (JSON javob; builder va broadcast ishlatadi)
 *  - GET  /media/library    — kutubxona (JSON)
 *  - GET  /media/ig-posts   — Instagram'dagi oxirgi postlar ("post ulashish" uchun)
 *  - GET  /u/:file          — ochiq fayl (Meta/Telegram serverlari yuklab oladi)
 */
import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { config } from "../config.js";
import { saveUpload, deleteUpload, serveUpload, MAX_UPLOAD_BYTES } from "../mediaStore.js";
import { getRecentMedia } from "../services/instagram.js";

export const mediaRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

mediaRouter.get("/u/:file", serveUpload);

mediaRouter.post("/media/upload", requireAuth, (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      const msg = err.code === "LIMIT_FILE_SIZE" ? "Fayl 25 MB dan katta" : "Yuklashda xatolik";
      return res.status(400).json({ ok: false, error: msg });
    }
    if (!req.file) return res.status(400).json({ ok: false, error: "Fayl tanlanmagan" });
    const item = saveUpload(req.user, req.file.buffer, req.file.mimetype, req.file.originalname);
    if (item.error) return res.status(400).json({ ok: false, error: item.error });
    res.json({ ok: true, item, warning: config.baseUrl ? "" : "BASE_URL sozlanmagan — Instagram/WhatsApp faylni yuklab ololmaydi" });
  });
});

mediaRouter.get("/media/library", requireAuth, (req, res) => {
  res.json({ ok: true, items: req.user.mediaLibrary || [] });
});

mediaRouter.get("/media/ig-posts", requireAuth, async (req, res) => {
  const r = await getRecentMedia(req.user, 24);
  if (!r || r.error) return res.json({ ok: false, error: r?.error?.message || "Instagram postlarini olib bo'lmadi", items: [] });
  res.json({
    ok: true,
    items: (r.data || []).map((m) => ({
      id: m.id,
      caption: String(m.caption || "").slice(0, 120),
      thumb: m.thumbnail_url || "",
      type: m.media_type,
      permalink: m.permalink || "",
      at: m.timestamp,
    })),
  });
});

mediaRouter.post("/media/:id/delete", requireAuth, (req, res) => {
  deleteUpload(req.user, req.params.id);
  res.redirect("/media");
});

const ICON = { image: "🖼️", video: "🎬", audio: "🎧", file: "📎" };
const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

mediaRouter.get("/media", requireAuth, (req, res) => {
  const items = req.user.mediaLibrary || [];
  res.send(
    page(
      "Media kutubxona",
      `
      ${config.baseUrl ? "" : `<div class="info">⚠️ BASE_URL sozlanmagan — fayllar mijozlarga havola bo'lib boradi, Instagram/WhatsApp ularni media sifatida ko'rsata olmaydi.</div>`}
      <div class="card" style="border:1px dashed #7c3aed; text-align:center; padding:28px" id="drop">
        <div style="font-size:34px">📤</div>
        <p style="margin:6px 0"><b>Faylni shu yerga tashlang</b> yoki</p>
        <label class="btn" style="display:inline-block; margin:0; cursor:pointer">Fayl tanlash<input type="file" id="fileInput" hidden accept="image/*,video/mp4,video/quicktime,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.pptx,.zip,.txt"></label>
        <p class="hint" style="font-size:12.5px">Rasm, video, audio, PDF, Office — 25 MB gacha. Flow xabarlari va ommaviy xabarlarda ishlatiladi.</p>
        <div id="status" class="hint"></div>
      </div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:12px">
        ${items.map((m) => `
          <div class="card" style="margin:0; padding:12px">
            <div style="height:120px; border-radius:8px; background:#0b0f19; display:grid; place-items:center; overflow:hidden">
              ${m.type === "image" ? `<img src="${esc(m.url)}" alt="" style="max-width:100%; max-height:120px; object-fit:cover">` : `<span style="font-size:40px">${ICON[m.type] || "📎"}</span>`}
            </div>
            <div style="margin-top:8px; font-size:13px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${esc(m.name)}">${esc(m.name)}</div>
            <div class="hint" style="font-size:11.5px">${esc(fmtSize(m.size))} · ${esc(String(m.at).slice(0, 10))}</div>
            <div style="display:flex; gap:6px; margin-top:8px">
              <button type="button" class="secondary" style="margin:0; padding:4px 10px; font-size:12px; flex:1" onclick="navigator.clipboard.writeText('${esc(m.url)}'); this.textContent='✓'">🔗 Havola</button>
              <form method="post" action="/media/${esc(m.id)}/delete" style="margin:0" onsubmit="return confirm('Fayl o\\'chirilsinmi? Uni ishlatayotgan flow\\'larda media yo\\'qoladi.')"><button class="secondary" style="margin:0; padding:4px 10px; font-size:12px; color:#f87171">🗑️</button></form>
            </div>
          </div>`).join("") || `<p class="hint">Kutubxona bo'sh</p>`}
      </div>
      <script>
      (function () {
        var status = document.getElementById("status");
        function send(file) {
          var fd = new FormData();
          fd.append("file", file);
          status.textContent = "Yuklanmoqda…";
          fetch("/media/upload", { method: "POST", body: fd }).then(function (r) { return r.json(); }).then(function (d) {
            if (!d.ok) { status.textContent = "⚠️ " + d.error; return; }
            location.reload();
          }).catch(function () { status.textContent = "⚠️ Tarmoq xatosi"; });
        }
        document.getElementById("fileInput").addEventListener("change", function (e) { if (e.target.files[0]) send(e.target.files[0]); });
        var drop = document.getElementById("drop");
        drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.style.background = "rgba(139,92,246,0.08)"; });
        drop.addEventListener("dragleave", function () { drop.style.background = ""; });
        drop.addEventListener("drop", function (e) { e.preventDefault(); drop.style.background = ""; if (e.dataTransfer.files[0]) send(e.dataTransfer.files[0]); });
      })();
      </script>`,
      { user: req.user, active: "media" }
    )
  );
});
