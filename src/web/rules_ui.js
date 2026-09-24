/**
 * ChatPlace.io uslubidagi Ultra-Professional Automation Rules Studio (/triggers)
 * Follower Gate (Obuna tekshiruvi), Anti-Spam Komment Randomizer, Story Reply va DM voronkalar.
 */

import { Router } from "express";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { persist } from "../db.js";
import { ensureRules, addRule, updateRule, deleteRule } from "../rules.js";

export const rulesRouter = Router();

rulesRouter.get("/triggers", requireAuth, (req, res) => {
  const u = req.user;
  const rules = ensureRules(u);
  const filterType = req.query.type || "all";
  const saved = req.query.saved;
  u.settings ||= {};
  const autoLikeOn = Boolean(u.settings.autoLikeComments);

  let filteredRules = rules;
  if (filterType !== "all") {
    filteredRules = rules.filter((r) => r.type === filterType);
  }

  const rulesListHtml = filteredRules.length
    ? filteredRules
        .map((r) => {
          const typeBadge =
            r.type === "comment_to_dm"
              ? "💬 Comment-to-DM"
              : r.type === "story_mention"
                ? "🌟 Story Mention"
                : r.type === "story_reply"
                  ? "🗨️ Story Reply"
                  : "✉️ Direct Keyword";

          const publicRepliesCount = Array.isArray(r.publicReplies) ? r.publicReplies.length : (r.publicReply ? 1 : 0);

          return `
            <div class="card" style="margin-bottom:16px; border-left: 4px solid ${r.enabled ? "#4ade80" : "#64748b"}; background:var(--bg-card)">
              <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px">
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap">
                  <span class="status-tag" style="background:rgba(124,58,237,0.2); color:#c4b5fd; border:1px solid rgba(124,58,237,0.4)">
                    ${typeBadge}
                  </span>
                  ${r.requireFollow ? `<span class="status-tag" style="background:rgba(236,72,153,0.15); color:#f472b6; border:1px solid rgba(236,72,153,0.3)">🔒 Follower Gate (Obuna shart)</span>` : ""}
                  ${publicRepliesCount > 1 ? `<span class="status-tag" style="background:rgba(16,185,129,0.15); color:#34d399; border:1px solid rgba(16,185,129,0.3)">🎲 Anti-Spam (${publicRepliesCount} xil javob)</span>` : ""}
                  <b style="font-size:16px; color:#fff">${esc(r.name)}</b>
                </div>
                <div style="display:flex; gap:8px">
                  <form method="post" action="/triggers/toggle" style="margin:0">
                    <input type="hidden" name="id" value="${esc(r.id)}">
                    <button type="submit" class="secondary" style="padding:5px 12px; font-size:12px; margin:0">
                      ${r.enabled ? "✅ Faol" : "⏸️ O'chiq"}
                    </button>
                  </form>
                  <form method="post" action="/triggers/delete" style="margin:0" onsubmit="return confirm('Qoidani o\'chirishga ishonchingiz komilmi?')">
                    <input type="hidden" name="id" value="${esc(r.id)}">
                    <button type="submit" class="secondary" style="padding:5px 10px; font-size:12px; margin:0; color:#f87171">🗑️</button>
                  </form>
                </div>
              </div>
              
              <div style="margin-top:12px; font-size:13.5px; display:flex; gap:16px; flex-wrap:wrap">
                ${r.keyword ? `<div><span class="hint">Kalit so'z:</span> <code style="background:#0f172a; padding:3px 8px; border-radius:6px; color:#a78bfa">${esc(r.keyword)}</code> <span class="hint">(${esc(r.matchType)})</span></div>` : ""}
                ${r.targetMediaId && r.targetMediaId !== "*" ? `<div><span class="hint">Post ID:</span> <code style="background:#0f172a; padding:3px 8px; border-radius:6px; color:#38bdf8">${esc(r.targetMediaId)}</code></div>` : `<div><span class="hint">Qamrov:</span> <span style="color:#94a3b8">Barcha postlar (*)</span></div>`}
              </div>

              ${
                r.publicReplies && r.publicReplies.length > 1
                  ? `<div style="margin-top:10px; font-size:13px; background:rgba(255,255,255,0.03); padding:8px 12px; border-radius:8px">
                      <b>🎲 Ochiq Javoblar (Anti-Spam Aylanuvchi):</b>
                      <ul style="margin:4px 0 0 16px; padding:0; color:#cbd5e1">
                        ${r.publicReplies.map((pr) => `<li>${esc(pr)}</li>`).join("")}
                      </ul>
                    </div>`
                  : r.publicReply
                    ? `<div style="margin-top:10px; font-size:13px; background:rgba(255,255,255,0.03); padding:8px 12px; border-radius:8px"><b>💬 Ochiq Komment Javobi:</b> <i style="color:#cbd5e1">"${esc(r.publicReply)}"</i></div>`
                    : ""
              }

              ${
                r.requireFollow
                  ? `<div style="margin-top:8px; font-size:13px; background:rgba(236,72,153,0.08); border:1px dashed rgba(236,72,153,0.3); padding:8px 12px; border-radius:8px">
                      <b style="color:#f472b6">🔒 Obuna bo'lmaganlarga:</b> <i style="color:#fce7f3">"${esc(r.notFollowingMessage)}"</i>
                      <div style="margin-top:4px"><span class="hint">Tugma:</span> <span style="background:#831843; color:#fff; padding:2px 8px; border-radius:4px; font-size:11px">${esc(r.notFollowingButton || "Obuna bo'ldim ✅")}</span></div>
                    </div>`
                  : ""
              }

              ${
                r.privateReply
                  ? `<div style="margin-top:8px; font-size:13.5px; background:rgba(124,58,237,0.1); padding:8px 12px; border-radius:8px"><b>📥 Direct (DM) Sovg'a/Katalog:</b> <i style="color:#f8fafc">"${esc(r.privateReply)}"</i></div>`
                  : ""
              }
            </div>
          `;
        })
        .join("")
    : `<div class="card hint" style="text-align:center; padding:40px">Hali ushbu bo'lim bo'yicha qoida kiritilmagan.</div>`;

  res.send(
    page(
      "Triggers & Qoidalar",
      `
      ${saved ? `<div class="ok">Qoida muvaffaqiyatli saqlandi! ✅</div>` : ""}

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px">
        <div>
          <h2>🎯 ChatPlace.io Studio — Triggers & Follower Gate</h2>
          <p class="hint">Instagram Reels, Post kommentlari, Story mention va Direct voronkalari orqali obunachi va mijozlarni avtomatlashtirish.</p>
        </div>
        <a href="/templates" class="btn" style="background:linear-gradient(135deg,#8b5cf6,#ec4899); font-size:13px; padding:8px 16px">🎨 Tayyor Shablonlar Hubi ➔</a>
      </div>

      <!-- Auto-Like Comments Toggle -->
      <div class="card" style="margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; border:1px solid ${autoLikeOn ? "#ec4899" : "var(--border)"}; background:${autoLikeOn ? "rgba(236,72,153,0.08)" : "var(--bg-card)"}">
        <div>
          <b style="color:#fff; font-size:15px">❤️ Kommentlarga Avtomatik Layk</b>
          <p class="hint" style="margin:4px 0 0; font-size:12.5px">Yoqilgan bo'lsa, postlaringizga yozilgan HAR BIR kommentga biznes akkauntingiz nomidan avtomatik layk bosiladi.</p>
        </div>
        <form method="post" action="/triggers/auto-like" style="margin:0">
          <button type="submit" class="${autoLikeOn ? "" : "secondary"}" style="padding:8px 18px; font-size:13px; margin:0; ${autoLikeOn ? "background:#ec4899; border:0" : ""}">
            ${autoLikeOn ? "❤️ Yoqilgan" : "🤍 O'chirilgan"}
          </button>
        </form>
      </div>

      <!-- Filter Tablar -->
      <div style="display:flex; gap:8px; margin-bottom:20px; flex-wrap:wrap">
        <a href="/triggers?type=all" class="btn ${filterType === "all" ? "" : "secondary"}" style="padding:8px 16px; font-size:13px; margin:0">Barchasi (${rules.length})</a>
        <a href="/triggers?type=comment_to_dm" class="btn ${filterType === "comment_to_dm" ? "" : "secondary"}" style="padding:8px 16px; font-size:13px; margin:0">💬 Comment-to-DM</a>
        <a href="/triggers?type=story_mention" class="btn ${filterType === "story_mention" ? "" : "secondary"}" style="padding:8px 16px; font-size:13px; margin:0">🌟 Story Mention</a>
        <a href="/triggers?type=story_reply" class="btn ${filterType === "story_reply" ? "" : "secondary"}" style="padding:8px 16px; font-size:13px; margin:0">🗨️ Story Reply</a>
        <a href="/triggers?type=keyword_dm" class="btn ${filterType === "keyword_dm" ? "" : "secondary"}" style="padding:8px 16px; font-size:13px; margin:0">✉️ Direct Keyword</a>
      </div>

      <div class="grid split-form">
        <div>
          ${rulesListHtml}
        </div>

        <div class="card" style="height:fit-content; border: 1px solid #7c3aed; background: #131b2e">
          <h3 style="margin-top:0; font-size:18px; color:#fff">➕ Yangi Qoida Qo'shish</h3>
          <form method="post" action="/triggers/add">
            <label>Qoida nomi</label>
            <input type="text" name="name" placeholder="Masalan: 🎁 Reels Sovg'a (Follower Gate)" required>

            <label>Qoida turi</label>
            <select name="type" id="ruleTypeSelect">
              <option value="comment_to_dm">💬 Comment-to-DM (Kommentdan Direct'ga)</option>
              <option value="story_mention">🌟 Story Mention (Story'da belgilaganda)</option>
              <option value="story_reply">🗨️ Story Reply (Story'ga javob yozganda)</option>
              <option value="keyword_dm">✉️ Direct Message (DM Kalit so'z)</option>
            </select>

            <label>Kalit so'z (barchasi uchun * qo'ying)</label>
            <input type="text" name="keyword" placeholder="narx, sovg'a, info, *" required value="*">

            <label>Moslik turi</label>
            <select name="matchType">
              <option value="contains">O'z ichiga oladi (Contains)</option>
              <option value="exact">Aniq moslik (Exact)</option>
              <option value="any">Har qanday (*)</option>
            </select>

            <div style="background:rgba(236,72,153,0.1); border:1px solid rgba(236,72,153,0.3); border-radius:10px; padding:12px; margin:14px 0">
              <label style="display:flex; align-items:center; gap:8px; margin:0; cursor:pointer; font-weight:700; color:#f472b6">
                <input type="checkbox" name="requireFollow" value="true" style="width:auto; margin:0">
                🔒 Follower Gate: Faqat obunachilarga yuborish
              </label>
              <p class="hint" style="margin:6px 0 0; font-size:12px">Mijoz obuna bo'lmagan bo'lsa, bot avval obuna bo'lishni so'rab [Obuna bo'ldim ✅] tugmasini yuboradi.</p>

              <div style="margin-top:10px">
                <label style="font-size:12px">Obuna bo'lmaganlarga xabar:</label>
                <textarea name="notFollowingMessage" rows="2" placeholder="Sovg'ani olish uchun avval sahifamizga obuna bo'ling! 👇" style="font-size:12.5px"></textarea>
              </div>
            </div>

            <label>Aniq Post / Reels ID (ixtiyoriy, hamma postlar uchun * qo'ying)</label>
            <input type="text" name="targetMediaId" placeholder="*" value="*">

            <label>💬 Ochiq komment javoblari (Anti-Spam: har qatorda bitta variant)</label>
            <textarea name="publicReplies" rows="3" placeholder="Batafsil ma'lumotni Direct'ga yubordik! 📥&#10;Direct'ni tekshiring ✨&#10;Xabaringizga javob berdik! 😊"></textarea>

            <label>📥 Direct (DM) asosiy javob / Sovg'a matni</label>
            <textarea name="privateReply" rows="3" placeholder="Direct'ga yuboriladigan sovg'a, katalog yoki havola..." required></textarea>

            <button type="submit" class="btn" style="width:100%; margin-top:16px; background:linear-gradient(135deg,#7c3aed,#db2777)">💾 Qoidani Saqlash</button>
          </form>
        </div>
      </div>
      `,
      { user: u, active: "triggers" }
    )
  );
});

rulesRouter.post("/triggers/add", requireAuth, (req, res) => {
  const body = req.body || {};
  const rawPublic = body.publicReplies || body.publicReply || "";
  const publicReplies = rawPublic
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  addRule(req.user, {
    ...body,
    requireFollow: body.requireFollow === "true" || body.requireFollow === "on" || Boolean(body.requireFollow),
    publicReplies,
    publicReply: publicReplies[0] || "",
  });
  res.redirect("/triggers?saved=1");
});

rulesRouter.post("/triggers/toggle", requireAuth, (req, res) => {
  const { id } = req.body || {};
  const rules = ensureRules(req.user);
  const rule = rules.find((r) => r.id === id);
  if (rule) {
    updateRule(req.user, id, { enabled: !rule.enabled });
  }
  res.redirect("/triggers");
});

rulesRouter.post("/triggers/delete", requireAuth, (req, res) => {
  const { id } = req.body || {};
  deleteRule(req.user, id);
  res.redirect("/triggers");
});

rulesRouter.post("/triggers/auto-like", requireAuth, (req, res) => {
  const u = req.user;
  u.settings ||= {};
  u.settings.autoLikeComments = !u.settings.autoLikeComments;
  persist(u);
  res.redirect("/triggers");
});

