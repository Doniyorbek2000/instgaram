/**
 * AI menejer amallari (ChatPlace "ИИ-менеджер сам добавляет клиента в CRM").
 *
 * AI javobining oxiriga yashirin blok qo'shadi:
 *   [[ACTIONS]]{"name":"Aziza","phone":"+998901234567","tags":["lid"],"lead":true,"summary":"..."}[[/ACTIONS]]
 * Blok mijozga yuborilmaydi — bu yerda o'qilib, bajariladi:
 *   - ism / telefon / email / manzil → kontakt kartasi (CRM)
 *   - teglar
 *   - lead: true → "Lidlar" ro'yxati, integratsiyalar (webhook/Sheets), amoCRM/Bitrix24, Telegram bildirishnoma
 *   - handoff: true → suhbat operatorga o'tadi
 *   - booking → {booking_service, booking_date, booking_time}
 * Shaxsiy ma'lumotga rozilik (sozlamada yoqilgan bo'lsa): AI avval rozilik so'raydi,
 * "consent": true kelmaguncha telefon/email saqlanmaydi.
 */
import { setFields, addTags, getContactMeta } from "./contacts.js";
import { persist } from "./db.js";
import { aiSettings } from "./aiControl.js";

const BLOCK_RE = /\[\[ACTIONS\]\]([\s\S]*?)(?:\[\[\/ACTIONS\]\]|$)/i;

/** Tizim ko'rsatmasiga qo'shiladigan qism. */
export function actionsPrompt(tenant, key) {
  const s = aiSettings(tenant);
  if (!s.actions) return "";
  const consentGiven = Boolean(getContactMeta(tenant, key).fields?.consent);
  const consentRule = s.askConsent && !consentGiven
    ? `\n- ROZILIK: Mijoz telefon yoki email bersa, uni saqlashdan oldin bir qisqa savol bilan shaxsiy ma'lumotlarni qayta ishlashga rozilik so'ra (masalan: "Ma'lumotlaringizni buyurtma uchun saqlashimizga rozimisiz?"). Mijoz rozi bo'lgandagina "consent": true yoz.`
    : "";
  return `

# YASHIRIN AMALLAR (mijozga ko'rinmaydi)
Agar mijoz ism, telefon, email, manzil bersa, buyurtma/yozilish istasa yoki jonli operator so'rasa — javobing OXIRIGA, yangi qatorda, aynan shu formatda JSON blok qo'sh:
[[ACTIONS]]{"name":"","phone":"","email":"","address":"","tags":[],"lead":false,"handoff":false,"booking":{"service":"","date":"","time":""},"consent":false,"summary":""}[[/ACTIONS]]
- Faqat mijoz AYNAN aytgan qiymatlarni yoz, bo'shlarini tashlab ket; hech narsani o'ylab topma.
- "lead": true — mijoz sotib olish/buyurtma/yozilish niyatini bildirsa va kontaktini qoldirsa.
- "handoff": true — mijoz odam/operator bilan gaplashmoqchi bo'lsa yoki sen javob bera olmaydigan murakkab masala bo'lsa.
- "tags": qisqa lotin harfli teglar, masalan "lid", "buyurtma", "narx" — 3 tagacha.
- "summary": bir jumlada mijoz nima xohlayotgani (menejer uchun).
- Saqlash uchun hech narsa bo'lmasa blokni UMUMAN qo'shma.${consentRule}`;
}

/** AI javobidan yashirin blokni ajratadi. */
export function extractActions(reply) {
  const text = String(reply || "");
  const m = text.match(BLOCK_RE);
  if (!m) return { text: text.trim(), actions: null };
  let actions = null;
  try {
    const raw = m[1].trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    actions = JSON.parse(raw);
    if (!actions || typeof actions !== "object" || Array.isArray(actions)) actions = null;
  } catch {
    actions = null;
  }
  return { text: text.replace(BLOCK_RE, "").trim(), actions };
}

const clean = (v, max = 200) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);

/** Ajratilgan amallarni bajaradi. Qaytaradi: bajarilgan amallar ro'yxati (log/test uchun). */
export async function executeAiActions(tenant, key, a, { channel = "" } = {}) {
  if (!a) return [];
  const s = aiSettings(tenant);
  if (!s.actions) return [];
  const done = [];
  const meta = getContactMeta(tenant, key);
  const consentOk = !s.askConsent || a.consent === true || Boolean(meta.fields?.consent);
  if (a.consent === true && !meta.fields?.consent) {
    setFields(tenant, key, { consent: new Date().toISOString().slice(0, 16).replace("T", " ") });
    done.push("consent");
  }

  const { normalizePhone } = await import("./forms.js");
  const fields = {};
  if (clean(a.name, 80)) fields.name = clean(a.name, 80);
  if (consentOk) {
    const phone = a.phone ? normalizePhone(String(a.phone)) : "";
    if (phone) fields.phone = phone;
    const email = clean(a.email, 120);
    if (/^[\w.+-]+@[\w-]+\.[\w.-]{2,}$/i.test(email)) fields.email = email.toLowerCase();
    if (clean(a.address, 300)) fields.address = clean(a.address, 300);
  }
  const b = a.booking && typeof a.booking === "object" ? a.booking : {};
  if (clean(b.service, 120)) fields.booking_service = clean(b.service, 120);
  if (clean(b.date, 40)) fields.booking_date = clean(b.date, 40);
  if (clean(b.time, 40)) fields.booking_time = clean(b.time, 40);
  if (clean(a.summary, 300)) fields.ai_summary = clean(a.summary, 300);
  if (Object.keys(fields).length) {
    setFields(tenant, key, fields);
    done.push("fields");
  }

  const tags = (Array.isArray(a.tags) ? a.tags : []).map((t) => clean(t, 30)).filter(Boolean).slice(0, 3);
  if (tags.length) {
    addTags(tenant, key, tags);
    done.push("tags");
  }

  const contact = fields.phone || fields.email || "";
  if (a.lead === true && contact) {
    tenant.leads ||= [];
    if (!tenant.leads.some((l) => l.key === key && l.contact === contact)) {
      tenant.leads.unshift({
        id: `lead_${Date.now()}`,
        key,
        channel,
        contact,
        lastMessage: `🤖 ${fields.ai_summary || "AI suhbatdan lid"}`.slice(0, 200),
        status: "new",
        createdAt: new Date().toISOString(),
      });
      addTags(tenant, key, ["lid"]);
      const { fireEvent } = await import("./integrations.js");
      fireEvent(tenant, "lead", { contact: key, channel, phoneOrEmail: contact, name: fields.name || "", summary: fields.ai_summary || "", source: "ai" });
      const { autoPushCrm } = await import("./crm.js");
      const f = getContactMeta(tenant, key).fields;
      autoPushCrm(tenant, "ai", {
        key, name: f.name, phone: f.phone, email: f.email,
        title: `AI: ${f.name || contact}${f.booking_service ? ` — ${f.booking_service}` : ""}`,
        note: [f.ai_summary, f.address && `Manzil: ${f.address}`, f.booking_date && `Sana: ${f.booking_date} ${f.booking_time || ""}`].filter(Boolean).join("\n"),
        tags: getContactMeta(tenant, key).tags,
      });
      const { notifyHotLead } = await import("./notify.js");
      notifyHotLead(tenant, channel, key, `🤖 AI lid: ${fields.name || ""} ${contact}\n${fields.ai_summary || ""}`).catch(() => {});
      done.push("lead");
    }
  }

  if (a.handoff === true && s.aiHandoff) {
    const { startHandoff } = await import("./engagement.js");
    const { notifyHandoff } = await import("./notify.js");
    startHandoff(tenant, channel, key);
    notifyHandoff(tenant, channel, key).catch(() => {});
    done.push("handoff");
  }
  if (done.length) persist(tenant);
  return done;
}
