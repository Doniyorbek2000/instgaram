/**
 * ADM AI Style Shablonlar Hub (Templates Gallery & 1-Click Rule Applier)
 * URL: /templates
 */
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { addRule } from "../rules.js";

export const templatesRouter = Router();

export const TEMPLATES = [
  {
    id: "tpl_sub_check",
    category: "obuna",
    categoryName: "Obunani tekshirish",
    icon: "🔔",
    platform: "ig",
    title: "Instagram'da obunani tekshirish",
    description: "Instagram akkauntingizga obunani tekshiradi va fayl yoki veb-sayt havolasini yuboradi.",
    rule: {
      name: "🎁 Instagram Obuna Tekshiruv (Follower Gate)",
      type: "comment_to_dm",
      keyword: "sovg'a",
      matchType: "contains",
      requireFollow: true,
      notFollowingMessage: "Assalomu alaykum! 🎁 Maxsus sovg'a va materiallarni olish uchun avval sahifamizga obuna bo'ling va quyidagi tugmani bosing:",
      notFollowingButton: "Obuna bo'ldim ✅",
      publicReplies: [
        "Batafsil ma'lumotni Direct'ga yubordik! 📥",
        "Xabaringizga javob berdik! Direct'ni tekshiring ✨",
        "Direct'ingizga yozib yubordik! 😊"
      ],
      publicReply: "Batafsil ma'lumotni Direct'ga yubordik! 📥",
      privateReply: "Assalomu alaykum! 🎁 Va'da qilingan eksklyuziv sovg'angiz qabul qiling: https://instagram.com/gift",
    },

  },
  {
    id: "tpl_account_badge",
    category: "obuna",
    categoryName: "Obunani tekshirish",
    icon: "🏷️",
    platform: "ig",
    title: "Akkaunt belgisi & Story Mention",
    description: "Instagram story'da belgilaganda avtomatik minnatdorchilik va maxsus lid-magnit yuboradi.",
    rule: {
      name: "Story Mention Rahmat Xabari",
      type: "story_mention",
      keyword: "*",
      matchType: "any",
      publicReply: "",
      privateReply: "Bizni Story'ingizda belgilaganingiz uchun katta rahmat! 🌟 Mana siz uchun maxsus 10% chegirma promokodi: PROMO2026",
    },
  },
  {
    id: "tpl_tg_sub",
    category: "obuna",
    categoryName: "Obunani tekshirish",
    icon: "✈️",
    platform: "tg",
    title: "Telegram'da obunani tekshirish",
    description: "Telegram kanaldagi obunani tekshiradi va havola yoki PDF faylga kirishni ta'minlaydi.",
    rule: {
      name: "Telegram Kanal Obuna Tekshiruvi",
      type: "keyword_dm",
      keyword: "kanal",
      matchType: "contains",
      publicReply: "",
      privateReply: "Bosh sahifa va eksklyuziv materiallarni olish uchun rasmiy kanalimizga obuna bo'ling!",
    },
  },
  {
    id: "tpl_ai_agent",
    category: "ai",
    categoryName: "AI chatbotlar",
    icon: "🤖",
    platform: "all",
    title: "AI Agent 24/7",
    description: "Learns from your data and responds 24/7. Adapts to dialogue, removes routine tasks.",
    rule: {
      name: "AI Agent Avto-Muloqot",
      type: "keyword_dm",
      keyword: "*",
      matchType: "any",
      publicReply: "",
      privateReply: "Assalomu alaykum! Men ADM AI yordamchisiman. Sizga qanday yordam bera olaman?",
    },
  },
  {
    id: "tpl_comment_price",
    category: "ai",
    categoryName: "AI chatbotlar",
    icon: "💬",
    platform: "ig",
    title: "Kommentga Avto-DM (Price Bot)",
    description: "Post/Reels ostida narx so'ralganda ochiq javob qoldirib, narxlarni shaxsiy Direct'ga yuboradi.",
    rule: {
      name: "Narx so'ralganda Direct'ga",
      type: "comment_to_dm",
      keyword: "narx",
      matchType: "contains",
      publicReply: "Batafsil ma'lumotni Direct'ga yubordik! 📥 Check qiling.",
      privateReply: "Assalomu alaykum! Barcha mahsulotlarimiz va hozirgi aksiya narxlari bilan tanishing! 😊",
    },
  },
  {
    id: "tpl_live_stream",
    category: "content",
    categoryName: "Kontent faoliyati",
    icon: "🎥",
    platform: "ig",
    title: "Jonli efir (Live Stream Auto-DM)",
    description: "Jonli efir paytida izoh qoldirganlarga Telegram-guruh yoki mahsulot havolasini yuboradi.",
    rule: {
      name: "Jonli Efir Avto-Javob",
      type: "comment_to_dm",
      keyword: "efir",
      matchType: "contains",
      publicReply: "Efirimizda qatnashganingiz uchun rahmat! Havola DM'ga yuborildi 🚀",
      privateReply: "Jonli efir materiallari va navbatdagi dars havolasi: https://t.me",
    },
  },
  {
    id: "tpl_payme_checkout",
    category: "crm",
    categoryName: "CRM va to'lov",
    icon: "💳",
    platform: "all",
    title: "Payme / Click Avto-To'lov Bot",
    description: "Mijozga to'lov havolasi va hisob-fakturani avtomatik taqdim etadi.",
    rule: {
      name: "To'lov Rekvizitlari & Checkout",
      type: "keyword_dm",
      keyword: "to'lov",
      matchType: "contains",
      publicReply: "",
      privateReply: "To'lovni Payme yoki Click orqali amalga oshirishingiz mumkin. Kartamiz: 8600... (TGroup MCHJ)",
    },
  },
  {
    id: "tpl_lead_magnet",
    category: "crm",
    categoryName: "CRM va to'lov",
    icon: "🧲",
    platform: "all",
    title: "Lid-Magnit va Kontakt Yig'ish",
    description: "Foydalanuvchi ma'lumotlarini (telefon/email) yig'adi va CRM bazaga saqlaydi.",
    rule: {
      name: "Kontakt Yig'ish & Lid-Magnit",
      type: "keyword_dm",
      keyword: "katalog",
      matchType: "contains",
      publicReply: "",
      privateReply: "Katalogni yuklab olish uchun telefon raqamingizni qoldiring, mutaxassisimiz bog'lanadi!",
    },
  },
];

templatesRouter.get("/templates", requireAuth, (req, res) => {
  const cat = req.query.cat || "all";
  const search = (req.query.q || "").toLowerCase().trim();

  let list = TEMPLATES;
  if (cat !== "all") {
    list = list.filter((t) => t.category === cat);
  }
  if (search) {
    list = list.filter(
      (t) => t.title.toLowerCase().includes(search) || t.description.toLowerCase().includes(search)
    );
  }

  const categoryTabs = [
    { id: "all", label: "Barcha mavzular" },
    { id: "obuna", label: "Obunani tekshirish" },
    { id: "ai", label: "AI chatbotlar" },
    { id: "content", label: "Kontent faoliyati" },
    { id: "crm", label: "CRM va to'lov" },
  ];

  const tabsHtml = categoryTabs
    .map(
      (t) =>
        `<a href="/templates?cat=${t.id}" class="btn ${cat === t.id ? "" : "secondary"}" style="padding:7px 16px; font-size:13px; margin:0">${t.label}</a>`
    )
    .join("");

  const cardsHtml = list.length
    ? list
        .map(
          (t) => `
        <div class="card" style="margin:0; display:flex; flex-direction:column; justify-content:space-between; border:1px solid rgba(255,255,255,0.08); transition:0.2s">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px">
              <div style="font-size:32px">${t.icon}</div>
              <span class="status-tag" style="background:rgba(124,58,237,0.15); color:#a78bfa; font-size:11px">${esc(t.categoryName)}</span>
            </div>
            <h3 style="margin:0 0 6px; font-size:16.5px; color:#fff">${esc(t.title)}</h3>
            <p class="hint" style="font-size:13px; line-height:1.5; margin:0 0 16px">${esc(t.description)}</p>
          </div>

          <form method="post" action="/templates/apply" style="margin:0">
            <input type="hidden" name="templateId" value="${esc(t.id)}">
            <button type="submit" class="btn" style="width:100%; margin:0; padding:9px; font-size:13px; background:linear-gradient(135deg,#7c3aed,#db2777)">
              ✨ Qo'llash & Aktivlashtirish
            </button>
          </form>
        </div>`
        )
        .join("")
    : `<div class="card hint" style="grid-column: 1/-1; text-align:center; padding:40px">Bunday shablon topilmadi.</div>`;

  res.send(
    page(
      "Shablonlar Hubi",
      `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px">
        <div>
          <h2>🎨 ADM AI Shablonlar Hubi (Templates Center)</h2>
          <p class="hint">ADM AI uslubidagi tayyor va sinovdan o'tgan avtomatlashtirish shablonlari (1-Click Install).</p>
        </div>
        <form method="get" action="/templates" style="display:flex; gap:8px; margin:0">
          <input type="hidden" name="cat" value="${esc(cat)}">
          <input type="text" name="q" value="${esc(search)}" placeholder="Shablonlar bo'yicha qidiruv..." style="padding:8px 14px; font-size:13px; width:220px">
          <button class="btn secondary" style="padding:8px 14px; font-size:13px; margin:0">Qidirish</button>
        </form>
      </div>

      <!-- Category Filter Tabs -->
      <div style="display:flex; gap:8px; margin-bottom:24px; flex-wrap:wrap">
        ${tabsHtml}
      </div>

      <!-- Templates Grid -->
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px;">
        ${cardsHtml}
      </div>
      `,
      { user: req.user, active: "templates" }
    )
  );
});

templatesRouter.post("/templates/apply", requireAuth, (req, res) => {
  const { templateId } = req.body || {};
  const tpl = TEMPLATES.find((t) => t.id === templateId);
  if (tpl && tpl.rule) {
    addRule(req.user, tpl.rule);
  }
  res.redirect("/triggers?saved=1");
});
