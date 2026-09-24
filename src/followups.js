/**
 * Kechiktirilgan xabarlar navbati (ChatPlace "Delay" + "Reminder" bloklari).
 *
 *  - reminder: obuna darvozasidan o'tmagan mijozga N daqiqadan so'ng eslatma
 *    (ChatPlace ma'lumotiga ko'ra tashlab ketilgan lidlarning 15-20% ini qaytaradi).
 *    Mijoz obunani tasdiqlasa — eslatma bekor qilinadi.
 *  - followup: sovg'a/katalog yuborilgach N daqiqadan so'ng qo'shimcha xabar
 *    (masalan: "Katalog yoqdimi? Bugun buyurtma bersangiz −10%").
 *
 * Navbat tenant.followUps da saqlanadi (JSON va PostgreSQL bazada) — server qayta
 * ishga tushsa ham yo'qolmaydi. Meta'ning 24 soatlik xabar oynasi sababli
 * kechikish 23 soatdan oshmaydi, muddati o'tgan vazifa yuborilmaydi.
 */
import { listUsers, persist, updateUser } from "./db.js";
import { sendReply, splitKey } from "./outbound.js";
import { isActive } from "./subscription.js";

const MAX_DELAY_MS = 23 * 60 * 60 * 1000;
const MAX_JOBS_PER_TENANT = 5000;
// Server uzoq to'xtab qolgan bo'lsa, juda eskirgan eslatmani yubormaymiz
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

function jobsOf(tenant) {
  if (!Array.isArray(tenant.followUps)) tenant.followUps = [];
  return tenant.followUps;
}

/**
 * Vazifa qo'shadi. Bir mijoz + qoida + tur uchun faqat bitta vazifa bo'ladi —
 * mijoz tugmani qayta-qayta bossa ham eslatma bir marta keladi.
 * Qaytaradi: yaratilgan vazifa yoki null (matn/kechikish yo'q).
 */
export function scheduleFollowUp(tenant, { key, kind, ruleId = "", text, options = [], delayMin }) {
  const body = String(text || "").trim();
  const delayMs = Math.min(MAX_DELAY_MS, Math.max(0, Number(delayMin) || 0) * 60 * 1000);
  if (!key || !body || !delayMs) return null;

  const jobs = jobsOf(tenant);
  const idx = jobs.findIndex((j) => j.key === key && j.kind === kind && j.ruleId === ruleId);
  if (idx >= 0) jobs.splice(idx, 1);

  const job = {
    id: `fu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    key,
    kind,
    ruleId,
    text: body,
    options: (options || []).filter((o) => o && o.title).slice(0, 3),
    dueAt: Date.now() + delayMs,
    createdAt: Date.now(),
  };
  jobs.push(job);
  if (jobs.length > MAX_JOBS_PER_TENANT) jobs.splice(0, jobs.length - MAX_JOBS_PER_TENANT);
  persist(tenant);
  return job;
}

/** Mijozning kutilayotgan vazifalarini bekor qiladi (kind/ruleId bo'yicha filtr ixtiyoriy). */
export function cancelFollowUps(tenant, key, { kind, ruleId } = {}) {
  const jobs = jobsOf(tenant);
  const before = jobs.length;
  tenant.followUps = jobs.filter(
    (j) => !(j.key === key && (!kind || j.kind === kind) && (!ruleId || j.ruleId === ruleId))
  );
  if (tenant.followUps.length !== before) persist(tenant);
  return before - tenant.followUps.length;
}

/** Bitta biznesning muddati kelgan vazifalarini yuboradi. Qaytaradi: yuborilganlar soni. */
export async function runTenantFollowUps(tenant, now = Date.now(), send = sendReply) {
  const jobs = jobsOf(tenant);
  const due = jobs.filter((j) => j.dueAt <= now);
  if (!due.length) return 0;

  tenant.followUps = jobs.filter((j) => j.dueAt > now);
  let sent = 0;
  if (isActive(tenant)) {
    for (const job of due) {
      if (now - job.dueAt > STALE_AFTER_MS) continue;
      const { chan, id } = splitKey(job.key);
      try {
        const ok = await send(tenant, chan, id, job.text, job.options);
        if (ok) sent++;
        else console.warn(`[FollowUp] ${tenant.businessName}: ${job.key} ga ${job.kind} yuborilmadi (24 soatlik oyna yopiq bo'lishi mumkin)`);
      } catch (err) {
        console.error(`[FollowUp] ${job.key} ga yuborishda xato:`, err.message);
      }
    }
  }
  // Faqat navbat maydonini yozamiz — butun obyektni persist qilish shu vaqtda
  // webhook yozgan boshqa maydonlarni (chats, stats) eski qiymat bilan bosib ketishi mumkin
  await updateUser(tenant.id, { followUps: tenant.followUps });
  return sent;
}

let running = false;

/** Barcha bizneslar bo'yicha muddati kelgan vazifalarni yuboradi (index.js da har daqiqada). */
export async function runDueFollowUps() {
  if (running) return 0;
  running = true;
  let total = 0;
  try {
    const now = Date.now();
    for (const tenant of await listUsers()) {
      if (!tenant.followUps?.some((j) => j.dueAt <= now)) continue;
      total += await runTenantFollowUps(tenant, now);
    }
  } finally {
    running = false;
  }
  if (total) console.log(`[FollowUp] ${total} ta kechiktirilgan xabar yuborildi`);
  return total;
}
