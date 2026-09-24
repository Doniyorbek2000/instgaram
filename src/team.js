/**
 * Jamoa: xodimlarni biznes ish maydoniga taklif qilish va rollar.
 *
 * Xavfsizlik modeli:
 *  - Taklif — bir martalik maxfiy havola (/team/join/<token>, 7 kun). A'zolik
 *    email bo'yicha EMAS, havolani ochgan akkaunt ID'si bo'yicha bog'lanadi —
 *    ro'yxatdan o'tishda email tasdiqlanmagani sababli emailga ishonib bo'lmaydi.
 *  - A'zo "ws" cookie orqali egasining ish maydoniga o'tadi: req.user = egasining
 *    biznesi, req.actor = { user: haqiqiy kirgan shaxs, role }.
 *  - Har bir so'rov roli bo'yicha tekshiriladi (canAccess). Parol, jamoa boshqaruvi,
 *    to'lov va admin panel — faqat egasiga.
 *
 * Rollar: owner (egasi), admin (hammasi, egasiga xos amallardan tashqari),
 *         operator (Inbox, kontaktlar, dashboard), viewer (faqat ko'rish).
 */
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { findUserById, listUsers, persist } from "./db.js";

export const ROLES = {
  admin: "Administrator — barcha bo'limlar",
  operator: "Operator — Inbox, kontaktlar, dashboard",
  viewer: "Kuzatuvchi — faqat ko'rish",
};

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_MEMBERS = 50;

const OWNER_ONLY = ["/team", "/integrations/tokens", "/account/password", "/settings/password", "/billing/pay", "/admin", "/connect/instagram", "/account/delete"];
const ALWAYS = ["/workspace", "/logout", "/assets/", "/team/join/"];
const OPERATOR = ["/dashboard", "/inbox", "/clients", "/contacts", "/handoff", "/analytics", "/shop/orders", "/push"];
const VIEWER_GET = ["/media", "/dashboard", "/inbox", "/clients", "/contacts", "/analytics", "/flows", "/triggers", "/forms", "/game", "/broadcasts", "/content", "/growth", "/scheduler", "/templates", "/integrations", "/sequences", "/shop", "/growth-tools"];

const als = new AsyncLocalStorage();

const matches = (path, prefixes) =>
  prefixes.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`) || (p.endsWith("/") && path.startsWith(p)));

/** Rol berilgan so'rovni bajara oladimi. */
export function canAccess(role, method, path) {
  if (!role || role === "owner") return true;
  if (matches(path, ALWAYS)) return true;
  if (matches(path, OWNER_ONLY)) return false;
  if (role === "admin") return true;
  // Operator mijozlar bilan ishlaydi, lekin kontakt ma'lumotlarini o'chira olmaydi
  if (role === "operator") return matches(path, OPERATOR) && !path.endsWith("/delete");
  if (role === "viewer") return method === "GET" && matches(path, VIEWER_GET);
  return false;
}

/** Joriy so'rovdagi jamoa a'zosi (egasining o'zi bo'lsa null) — layout menyusi uchun. */
export function currentActor() {
  return als.getStore()?.actor || null;
}

export function ensureTeam(tenant) {
  if (!Array.isArray(tenant.team)) tenant.team = [];
  return tenant.team;
}

/** Taklif yaratadi. Qaytaradi: { member, link } yoki { error }. */
export function inviteMember(tenant, { email, role }, baseUrl = "") {
  const team = ensureTeam(tenant);
  const cleanEmail = String(email || "").trim().toLowerCase().slice(0, 120);
  if (!ROLES[role]) return { error: "Rol noto'g'ri" };
  if (!cleanEmail.includes("@")) return { error: "Email noto'g'ri" };
  if (cleanEmail === String(tenant.email || "").toLowerCase()) return { error: "Bu sizning emailingiz" };
  if (team.length >= MAX_MEMBERS) return { error: `Jamoada ${MAX_MEMBERS} tadan ortiq a'zo bo'lmaydi` };
  if (team.some((m) => m.email === cleanEmail)) return { error: "Bu email allaqachon jamoada" };
  const member = {
    id: `tm_${crypto.randomBytes(6).toString("hex")}`,
    email: cleanEmail,
    role,
    token: crypto.randomBytes(24).toString("hex"),
    tokenExpires: Date.now() + INVITE_TTL_MS,
    userId: "",
    invitedAt: new Date().toISOString(),
    joinedAt: "",
  };
  team.push(member);
  persist(tenant);
  return { member, link: `${baseUrl}/team/join/${member.token}` };
}

/** Taklif havolasini yangilaydi (muddati o'tgan yoki yo'qolgan bo'lsa). */
export function renewInvite(tenant, memberId, baseUrl = "") {
  const m = ensureTeam(tenant).find((x) => x.id === memberId);
  if (!m || m.userId) return null;
  m.token = crypto.randomBytes(24).toString("hex");
  m.tokenExpires = Date.now() + INVITE_TTL_MS;
  persist(tenant);
  return `${baseUrl}/team/join/${m.token}`;
}

export function removeMember(tenant, memberId) {
  const team = ensureTeam(tenant);
  const before = team.length;
  tenant.team = team.filter((m) => m.id !== memberId);
  if (tenant.team.length !== before) persist(tenant);
  return tenant.team.length !== before;
}

export function setMemberRole(tenant, memberId, role) {
  const m = ensureTeam(tenant).find((x) => x.id === memberId);
  if (!m || !ROLES[role]) return false;
  m.role = role;
  persist(tenant);
  return true;
}

/** Token bo'yicha taklifni topadi: { owner, member } yoki null. */
export async function findInvite(token) {
  const t = String(token || "");
  if (!/^[a-f0-9]{48}$/.test(t)) return null;
  for (const owner of await listUsers()) {
    const member = (owner.team || []).find((m) => m.token && m.token === t);
    if (member) return { owner, member };
  }
  return null;
}

/** Kirgan foydalanuvchi taklifni qabul qiladi. */
export async function acceptInvite(token, user) {
  const found = await findInvite(token);
  if (!found) return { error: "Taklif topilmadi yoki allaqachon ishlatilgan." };
  const { owner, member } = found;
  if (member.tokenExpires < Date.now()) return { error: "Taklif muddati tugagan. Egasidan yangi havola so'rang." };
  if (owner.id === user.id) return { error: "O'z jamoangizga qo'shila olmaysiz." };
  if ((owner.team || []).some((m) => m.userId === user.id)) return { error: "Siz allaqachon bu jamoadasiz." };
  member.userId = user.id;
  member.joinedEmail = user.email;
  member.joinedAt = new Date().toISOString();
  member.token = "";
  member.tokenExpires = 0;
  persist(owner);
  return { owner, member };
}

/** Foydalanuvchi a'zo bo'lgan ish maydonlari. */
export async function workspacesFor(user) {
  if (!user) return [];
  const out = [];
  for (const owner of await listUsers()) {
    const m = (owner.team || []).find((x) => x.userId === user.id);
    if (m) out.push({ owner, role: m.role });
  }
  return out;
}

function parseCookie(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
}

/**
 * attachUser'dan keyin ishlaydi: "ws" cookie bo'lsa va foydalanuvchi o'sha
 * biznes jamoasida bo'lsa — ish maydonini almashtiradi va rolni tekshiradi.
 */
export async function teamContext(req, res, next) {
  let actor = null;
  const ws = parseCookie(req, "ws");
  if (req.user && ws && ws !== req.user.id) {
    const owner = await findUserById(ws);
    const member = owner?.team?.find((m) => m.userId && m.userId === req.user.id);
    if (owner && member) {
      actor = { user: req.user, role: member.role, owner };
      req.actor = actor;
      req.user = owner;
    } else {
      res.append("Set-Cookie", "ws=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
    }
  }

  if (actor && !canAccess(actor.role, req.method, req.path)) {
    if (req.method === "GET" && req.accepts("html")) {
      return res.redirect(actor.role === "viewer" ? "/dashboard" : "/inbox");
    }
    return res.status(403).json({ ok: false, error: "Rolingiz bu amalga ruxsat bermaydi" });
  }

  als.run({ actor }, next);
}
