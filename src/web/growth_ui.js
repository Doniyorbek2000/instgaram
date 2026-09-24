/**
 * Obunext style O'sish Vositalari (Growth Tools / Gamification / Icebreakers) Module (/growth)
 */
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { brandIcon } from "./icons.js";
import { persist } from "../db.js";
import { getProfileStats, getAccountInsights, getRecentMedia, getMediaComments, privateReplyToComment } from "../services/instagram.js";

import { ensureFlows } from "../flows.js";
import { setIceBreakers } from "../services/instagram.js";

export const growthRouter = Router();

growthRouter.get("/growth", requireAuth, async (req, res) => {
  const user = req.user;
  user.growth ||= {};

  const tab = req.query.tab || "gamification";
  const saved = req.query.saved;

  const tabsHtml = [
    { id: "gamification", label: "🏆 Tasodifiy G'olib" },
    { id: "insights", label: "📊 Statistika (Instagram Insights)" },
    { id: "comments", label: "💬 Izohlarga avtomatik javoblar" },
    { id: "icebreakers", label: "👋 Salomlashuv tugmalari" },
    { id: "referrals", label: "🔗 Referal havolalar" },
  ]
    .map(
      (t) =>
        `<a href="/growth?tab=${t.id}" class="btn ${tab === t.id ? "" : "secondary"}" style="padding:8px 16px; font-size:13px; margin:0">${t.label}</a>`
    )
    .join("");

  let contentHtml = "";

  if (tab === "gamification") {
    const connected = Boolean(user.meta?.igUserId && (user.meta?.igAccessToken || user.meta?.pageAccessToken));
    if (!connected) {
      contentHtml = `
        <div class="card" style="text-align:center; padding:40px 20px">
          <div style="font-size:44px; margin-bottom:10px">🏆</div>
          <h3 style="margin:0 0 8px; color:#fff">G'olib tanlash uchun Instagram ulanishi kerak</h3>
          <p class="hint" style="max-width:460px; margin:0 auto 18px">Post ostidagi kommentlar orasidan tasodifiy g'olib tanlash uchun avval Instagram akkauntingizni ulang.</p>
          <a href="/account" class="btn">${brandIcon("instagram", { size: 18 })} Instagram bilan ulash ➔</a>
        </div>
      `;
    } else {
      const mediaRes = await getRecentMedia(user, 12);
      const lastWinner = user.growth?.lastWinner;

      const winnerBox = lastWinner
        ? `<div class="card" style="margin-bottom:20px; border:1px solid ${lastWinner.ok ? "rgba(52,211,153,0.4)" : "rgba(244,63,94,0.4)"}">
            <b style="color:${lastWinner.ok ? "#34d399" : "#fb7185"}">${lastWinner.ok ? "✅" : "❌"} So'nggi g'olib: @${esc(lastWinner.username)}</b>
            <p class="hint" style="margin-top:6px">${esc(lastWinner.message)} — ${esc(new Date(lastWinner.at).toLocaleString("uz"))}</p>
          </div>`
        : "";

      if (mediaRes?.error) {
        contentHtml = `${winnerBox}<div class="error">Postlar ro'yxatini olib bo'lmadi: ${esc(mediaRes.error.message || "")}</div>`;
      } else {
        const posts = mediaRes?.data || [];
        contentHtml = `
          ${winnerBox}
          <div class="card">
            <h3 style="margin-top:0">🏆 Tasodifiy G'olib Tanlash</h3>
            <p class="hint">Post ostidagi kommentlar orasidan tasodifiy bittasi tanlanadi va unga Direct orqali sovg'a xabari yuboriladi. <b>Eslatma:</b> Meta qoidasiga ko'ra shaxsiy javob faqat komment yozilganidan keyin 7 kun ichida yetkaziladi.</p>
            ${
              posts.length
                ? `<form method="post" action="/growth/random-winner" style="margin-top:16px">
                    <label>Post tanlang</label>
                    <select name="mediaId" required>
                      ${posts.map((p) => `<option value="${esc(p.id)}">${esc((p.caption || "(tavsifsiz)").slice(0, 60))} — ${esc(new Date(p.timestamp).toLocaleDateString("uz"))}</option>`).join("")}
                    </select>
                    <label>Sovg'a xabari</label>
                    <textarea name="prizeMessage" rows="3" placeholder="Tabriklaymiz! Siz g'olib bo'ldingiz 🎉 Sovg'angizni olish uchun..." required></textarea>
                    <button type="submit" class="btn" style="width:100%; margin-top:16px">🎲 G'olibni Tasodifiy Tanlash</button>
                  </form>`
                : `<p class="hint" style="margin-top:14px">So'nggi postlar topilmadi.</p>`
            }
          </div>
        `;
      }
    }
  } else if (tab === "insights") {
    const connected = Boolean(user.meta?.igUserId && (user.meta?.igAccessToken || user.meta?.pageAccessToken));
    if (!connected) {
      contentHtml = `
        <div class="card" style="text-align:center; padding:40px 20px">
          <div style="font-size:44px; margin-bottom:10px">📊</div>
          <h3 style="margin:0 0 8px; color:#fff">Statistika uchun Instagram ulanishi kerak</h3>
          <p class="hint" style="max-width:460px; margin:0 auto 18px">Haqiqiy followerlar soni va Insights ma'lumotlarini ko'rish uchun avval Instagram akkauntingizni ulang.</p>
          <a href="/account" class="btn">${brandIcon("instagram", { size: 18 })} Instagram bilan ulash ➔</a>
        </div>
      `;
    } else {
      const [profile, insights] = await Promise.all([
        getProfileStats(user),
        getAccountInsights(user, 7),
      ]);

      const profileBlock = profile?.error
        ? `<div class="error">Profil ma'lumotini olib bo'lmadi: ${esc(profile.error.message || "")}</div>`
        : `
          <div class="grid cols-3">
            <div class="card" style="margin:0"><div class="kpi"><div class="ic">👥</div><div><div class="num">${esc(String(profile.followers_count ?? "—"))}</div><div class="lbl">Followerlar</div></div></div></div>
            <div class="card" style="margin:0"><div class="kpi"><div class="ic">📸</div><div><div class="num">${esc(String(profile.media_count ?? "—"))}</div><div class="lbl">Postlar</div></div></div></div>
            <div class="card" style="margin:0"><div class="kpi"><div class="ic">🌐</div><div><div class="num" style="font-size:14px; word-break:break-all">${esc(profile.website || "—")}</div><div class="lbl">Veb-sayt</div></div></div></div>
          </div>
          ${profile.biography ? `<div class="card"><b style="color:#a78bfa">Bio:</b> ${esc(profile.biography)}</div>` : ""}
        `;

      let insightsBlock;
      if (insights?.error) {
        insightsBlock = `<div class="error">Instagram Insights hozircha mavjud emas: ${esc(insights.error.message || "")}<br><span class="hint">Bu Meta'ning o'zi qaytargan xabar — haqiqiy sabab shu.</span></div>`;
      } else {
        const metrics = insights?.data || [];
        insightsBlock = metrics.length
          ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Metrika</th>${(metrics[0]?.values || []).map((v) => `<th>${esc(new Date(v.end_time).toLocaleDateString("uz"))}</th>`).join("")}</tr></thead><tbody>${metrics.map((m) => `<tr><td>${esc(m.title || m.name)}</td>${(m.values || []).map((v) => `<td>${esc(String(v.value))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
          : `<p class="hint">So'nggi 7 kun uchun Insights ma'lumoti yo'q.</p>`;
      }

      contentHtml = `
        <div class="sec-title"><h2>📊 Haqiqiy Instagram statistikasi</h2><span class="tag">@${esc(profile?.username || user.meta?.igUsername || "")}</span></div>
        ${profileBlock}
        <div class="card" style="margin-top:20px">
          <h3 style="margin-top:0">Oxirgi 7 kun — Reach va Profil ko'rishlari</h3>
          ${insightsBlock}
        </div>
      `;
    }
  } else if (tab === "comments") {
    contentHtml = `
      <div class="card">
        <h3>💬 Izohlarga Avtomatik Javoblar (Auto Comment Replies)</h3>
        <p class="hint">Post va Reels ostidagi kommentariyalarga soniyalarda ochiq va DM shaxsiy javob qaytarish.</p>
        <p><a href="/triggers?type=comment_to_dm" class="btn" style="padding:8px 16px; font-size:13px">⚡ Komment Qoidalarini Sozlash ➔</a></p>
      </div>
    `;
  } else if (tab === "icebreakers") {
    const ib = normalizeIcebreakers(user.settings?.icebreakers);
    const flows = ensureFlows(user).list;
    const status = user.settings?.icebreakersStatus;
    const row = (i) => `
      <div style="display:flex; gap:8px; flex-wrap:wrap">
        <input type="text" name="q${i}" maxlength="80" placeholder="${["💰 Narxlar qancha?", "📍 Manzilingiz qayerda?", "🚚 Yetkazib berasizmi?", "👤 Operator bilan gaplashish"][i]}" value="${esc(ib[i]?.question || "")}" style="flex:2; min-width:220px; margin:0">
        <select name="f${i}" style="flex:1; min-width:180px; margin:0">
          <option value="">🧠 AI javob beradi</option>
          ${flows.map((f) => `<option value="${esc(f.id)}" ${ib[i]?.flowId === f.id ? "selected" : ""}>🧩 ${esc(f.name)}</option>`).join("")}
        </select>
      </div>`;
    contentHtml = `
      <div class="card">
        <h3>👋 Salomlashuv tugmalari (Instagram Ice Breakers)</h3>
        <p class="hint">Mijoz Instagram Direct'ni birinchi marta ochganda, hali hech narsa yozmasidan <b>oldin</b> shu savollar ko'rinadi. Bosilgan savolga AI javob beradi yoki tanlangan flow ishga tushadi. 4 tagacha.</p>
        ${status ? `<div class="${status.ok ? "ok" : "error"}" style="margin:10px 0">${status.ok ? "✅ Instagram'da ro'yxatdan o'tkazildi" : `⚠️ Instagram qabul qilmadi: ${esc(status.error || "")}`} <span style="opacity:.7">(${esc(String(status.at || "").slice(0, 16).replace("T", " "))})</span></div>` : ""}
        <form method="post" action="/growth/icebreakers">
          <div style="display:flex; flex-direction:column; gap:10px; margin-top:12px">
            ${[0, 1, 2, 3].map(row).join("")}
            <label style="display:flex; gap:8px; align-items:center; cursor:pointer; margin:4px 0 0; text-transform:none; letter-spacing:0; font-size:13.5px; font-weight:600">
              <input type="checkbox" name="alsoQuick" ${user.settings?.icebreakersQuick !== false ? "checked" : ""} style="width:auto; margin:0">
              Birinchi AI javobida ham tezkor tugma sifatida ko'rsatish
            </label>
            <button type="submit" class="btn" style="width:fit-content; margin-top:8px">💾 Saqlash va Instagram'ga yuborish</button>
          </div>
        </form>
      </div>
    `;
  } else if (tab === "referrals") {
    const referrals = user.growth?.referrals || [];
    const refLink = `https://chat.voxo.uz/register?ref=${user.id.slice(0, 8)}`;
    contentHtml = `
      <div class="card">
        <h3>🔗 Referal Havolalar (Referral System)</h3>
        <p class="hint">Do'stlaringiz shu havola orqali ro'yxatdan o'tsa, obuna/sinov muddatingiz avtomatik <b>+3 kunga</b> uzayadi.</p>
        <div style="background:#0f172a; padding:16px; border-radius:10px; border:1px solid rgba(255,255,255,0.08); margin-top:14px; display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap">
          <div>
            <span style="color:#a78bfa; font-size:12px; font-weight:700">Sizning taklif havolangiz:</span>
            <div style="margin-top:6px; font-size:14px; font-weight:700; color:#fff; word-break:break-all">${esc(refLink)}</div>
          </div>
          <span class="tag">${referrals.length} ta taklif</span>
        </div>
      </div>
      <div class="card" style="margin-top:20px">
        <h3 style="margin-top:0">Taklif qilingan foydalanuvchilar</h3>
        ${
          referrals.length
            ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Email</th><th>Sana</th></tr></thead><tbody>${referrals
                .map((r) => `<tr><td>${esc(r.email)}</td><td>${esc(new Date(r.at).toLocaleDateString("uz"))}</td></tr>`)
                .join("")}</tbody></table></div>`
            : `<p class="hint">Hali hech kim taklif havolangiz orqali ro'yxatdan o'tmagan.</p>`
        }
      </div>
    `;
  }

  res.send(
    page(
      "O'sish vositalari",
      `
      ${saved ? `<div class="ok">O'zgarishlar muvaffaqiyatli saqlandi! ✅</div>` : ""}

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px">
        <div>
          <h2>🚀 O'sish vositalari va Geymifikatsiya (Growth Tools)</h2>
          <p class="hint">Organik obunachilar va reaksiyalarni ko'paytirish uchun virusli vositalar.</p>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div style="display:flex; gap:8px; margin-bottom:24px; flex-wrap:wrap">
        ${tabsHtml}
      </div>

      ${contentHtml}
      `,
      { user, active: "growth" }
    )
  );
});

growthRouter.post("/growth/icebreakers", requireAuth, async (req, res) => {
  const b = req.body || {};
  const u = req.user;
  const flows = ensureFlows(u).list;
  u.settings ||= {};
  u.settings.icebreakers = [0, 1, 2, 3]
    .map((i) => ({
      question: String(b[`q${i}`] || "").trim().slice(0, 80),
      flowId: flows.some((f) => f.id === b[`f${i}`]) ? b[`f${i}`] : "",
    }))
    .filter((x) => x.question);
  u.settings.icebreakersQuick = b.alsoQuick === "on";

  // Instagram'ga haqiqiy Ice Breakers sifatida ro'yxatdan o'tkazamiz
  const items = u.settings.icebreakers.map((x, i) => {
    const flow = x.flowId ? flows.find((f) => f.id === x.flowId) : null;
    return { question: x.question, payload: flow?.start ? `FLOW:${flow.id}:${flow.start}` : `IB:${i}` };
  });
  const connected = Boolean(u.meta?.igAccessToken || u.meta?.pageAccessToken);
  if (connected) {
    const r = await setIceBreakers(u, items);
    u.settings.icebreakersStatus = r && !r.error
      ? { ok: true, at: new Date().toISOString() }
      : { ok: false, error: r?.error?.message || "Meta so'rovni rad etdi (instagram_business_manage_messages ruxsatini tekshiring)", at: new Date().toISOString() };
  } else {
    u.settings.icebreakersStatus = { ok: false, error: "Instagram ulanmagan — tugmalar saqlandi, ulangach qayta saqlang", at: new Date().toISOString() };
  }
  persist(u);
  res.redirect("/growth?tab=icebreakers&saved=1");
});

/** Eski format (satrlar ro'yxati) va yangi format ({question, flowId}) ni birxillashtiradi. */
export function normalizeIcebreakers(list) {
  return (Array.isArray(list) ? list : [])
    .map((x) => (typeof x === "string" ? { question: x, flowId: "" } : { question: String(x?.question || ""), flowId: String(x?.flowId || "") }))
    .filter((x) => x.question);
}

growthRouter.post("/growth/random-winner", requireAuth, async (req, res) => {
  const user = req.user;
  const { mediaId, prizeMessage } = req.body || {};
  user.growth ||= {};

  if (!mediaId || !prizeMessage) return res.redirect("/growth?tab=gamification");

  const commentsRes = await getMediaComments(user, mediaId, 100);
  if (commentsRes?.error) {
    user.growth.lastWinner = { ok: false, username: "", message: `Kommentlarni olib bo'lmadi: ${commentsRes.error.message || ""}`, at: new Date().toISOString() };
    persist(user);
    return res.redirect("/growth?tab=gamification");
  }

  const comments = commentsRes?.data || [];
  if (!comments.length) {
    user.growth.lastWinner = { ok: false, username: "", message: "Bu postda hech qanday komment topilmadi", at: new Date().toISOString() };
    persist(user);
    return res.redirect("/growth?tab=gamification");
  }

  const winner = comments[Math.floor(Math.random() * comments.length)];
  const replyRes = await privateReplyToComment(user, winner.id, prizeMessage);

  user.growth.lastWinner = {
    ok: Boolean(replyRes && !replyRes.error),
    username: winner.username || "noma'lum",
    message: replyRes && !replyRes.error ? "Sovg'a xabari yuborildi" : `Yuborib bo'lmadi: ${replyRes?.error?.message || "Meta 7 kunlik muddat o'tgan bo'lishi mumkin"}`,
    at: new Date().toISOString(),
  };
  persist(user);
  res.redirect("/growth?tab=gamification");
});
