/**
 * Jamoa boshqaruvi (/team), taklifni qabul qilish (/team/join/:token)
 * va ish maydonini almashtirish (/workspace).
 */
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { config } from "../config.js";
import {
  ROLES, ensureTeam, inviteMember, renewInvite, removeMember, setMemberRole,
  findInvite, acceptInvite, workspacesFor,
} from "../team.js";

export const teamRouter = Router();

const secure = () => (config.baseUrl.startsWith("https") ? "; Secure" : "");
const wsCookie = (id) => `ws=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure()}`;
const baseUrl = (req) => config.baseUrl || `${req.protocol}://${req.get("host")}`;

teamRouter.get("/team", requireAuth, (req, res) => {
  const u = req.user;
  const team = ensureTeam(u);
  const link = String(req.query.link || "");
  const error = String(req.query.error || "");

  const rows = team.length
    ? team
        .map((m) => {
          const pending = !m.userId;
          const expired = pending && m.tokenExpires < Date.now();
          return `<tr>
            <td><b>${esc(m.email)}</b>${m.joinedEmail && m.joinedEmail !== m.email ? `<div class="hint" style="font-size:12px">akkaunt: ${esc(m.joinedEmail)}</div>` : ""}</td>
            <td>
              <form method="post" action="/team/${esc(m.id)}/role" style="margin:0; display:flex; gap:6px">
                <select name="role" onchange="this.form.submit()" style="margin:0">
                  ${Object.entries(ROLES).map(([k, label]) => `<option value="${k}" ${m.role === k ? "selected" : ""}>${esc(label.split(" — ")[0])}</option>`).join("")}
                </select>
              </form>
            </td>
            <td>${pending ? (expired ? `<span style="color:#f87171">Muddati o'tgan</span>` : `<span style="color:#fbbf24">Kutilmoqda</span>`) : `<span style="color:#34d399">✓ Qo'shilgan</span>`}</td>
            <td style="white-space:nowrap">
              ${pending ? `<form method="post" action="/team/${esc(m.id)}/renew" style="display:inline; margin:0"><button class="secondary" style="padding:5px 10px; font-size:12px; margin:0">🔗 Havola</button></form>` : ""}
              <form method="post" action="/team/${esc(m.id)}/remove" style="display:inline; margin:0" onsubmit="return confirm('A\\'zo jamoadan chiqarilsinmi?')"><button class="secondary" style="padding:5px 10px; font-size:12px; margin:0; color:#f87171">🗑️</button></form>
            </td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="4" class="hint" style="text-align:center; padding:24px">Hali jamoa a'zosi yo'q</td></tr>`;

  res.send(
    page(
      "Jamoa",
      `
      ${error ? `<div class="error">${esc(error)}</div>` : ""}
      ${link ? `<div class="ok">
          Taklif havolasi tayyor ✅ Uni xodimga yuboring (7 kun amal qiladi, bir marta ishlatiladi):
          <div style="display:flex; gap:8px; margin-top:8px">
            <input id="inviteLink" readonly value="${esc(link)}" style="margin:0; font-family:monospace; font-size:12.5px">
            <button type="button" class="btn" style="margin:0" onclick="navigator.clipboard.writeText(document.getElementById('inviteLink').value); this.textContent='✓ Nusxa olindi'">📋 Nusxa</button>
          </div>
        </div>` : ""}
      <div class="grid split-form">
        <div class="card">
          <h3 style="margin-top:0">👥 Jamoa a'zolari</h3>
          <div style="overflow-x:auto">
            <table style="width:100%; border-collapse:collapse; font-size:14px">
              <thead><tr style="text-align:left; color:var(--text-muted); font-size:12px"><th>Email</th><th>Rol</th><th>Holat</th><th></th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
        <div>
          <div class="card" style="border:1px solid #7c3aed">
            <h3 style="margin-top:0">➕ Xodim taklif qilish</h3>
            <form method="post" action="/team/invite">
              <label>Email</label>
              <input type="email" name="email" required placeholder="operator@biznes.uz">
              <label>Rol</label>
              <select name="role">${Object.entries(ROLES).map(([k, label]) => `<option value="${k}" ${k === "operator" ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>
              <button class="btn" style="width:100%; margin-top:12px">Taklif havolasini yaratish</button>
            </form>
          </div>
          <div class="card">
            <h3 style="margin-top:0">🔐 Qanday ishlaydi</h3>
            <ol class="hint" style="margin:0; padding-left:18px; font-size:13px; line-height:1.7">
              <li>Havolani yaratib, xodimga yuborasiz.</li>
              <li>Xodim o'z akkaunti bilan kiradi (yoki ro'yxatdan o'tadi) va havolani ochadi.</li>
              <li>U menyudagi "⇄ Ish maydoni" orqali biznesingizga o'tadi — o'z paroli bilan, sizning parolingizsiz.</li>
              <li>Operator faqat Inbox va kontaktlarni ko'radi; parol, to'lov va jamoa boshqaruvi faqat sizda.</li>
            </ol>
          </div>
        </div>
      </div>`,
      { user: u, active: "team" }
    )
  );
});

teamRouter.post("/team/invite", requireAuth, (req, res) => {
  const r = inviteMember(req.user, { email: req.body?.email, role: req.body?.role }, baseUrl(req));
  if (r.error) return res.redirect(`/team?error=${encodeURIComponent(r.error)}`);
  res.redirect(`/team?link=${encodeURIComponent(r.link)}`);
});

teamRouter.post("/team/:id/renew", requireAuth, (req, res) => {
  const link = renewInvite(req.user, req.params.id, baseUrl(req));
  res.redirect(link ? `/team?link=${encodeURIComponent(link)}` : "/team");
});

teamRouter.post("/team/:id/role", requireAuth, (req, res) => {
  setMemberRole(req.user, req.params.id, String(req.body?.role || ""));
  res.redirect("/team");
});

teamRouter.post("/team/:id/remove", requireAuth, (req, res) => {
  removeMember(req.user, req.params.id);
  res.redirect("/team");
});

// ==== Taklifni qabul qilish ====

teamRouter.get("/team/join/:token", async (req, res) => {
  const found = await findInvite(req.params.token);
  const valid = found && found.member.tokenExpires > Date.now();
  const body = !valid
    ? `<div class="card center"><h2>Taklif topilmadi</h2><p class="hint">Havola noto'g'ri, ishlatilgan yoki muddati tugagan. Biznes egasidan yangi havola so'rang.</p><p><a href="/dashboard">← Bosh sahifa</a></p></div>`
    : !req.user
      ? `<div class="card center">
          <h2>🤝 ${esc(found.owner.businessName || "Biznes")} jamoasiga taklif</h2>
          <p class="hint">Qabul qilish uchun avval o'z akkauntingiz bilan kiring yoki ro'yxatdan o'ting, so'ng shu havolani qayta oching.</p>
          <p><a class="btn" href="/login">Kirish</a> &nbsp; <a class="btn secondary" href="/register">Ro'yxatdan o'tish</a></p>
        </div>`
      : `<div class="card center">
          <h2>🤝 ${esc(found.owner.businessName || "Biznes")} jamoasiga taklif</h2>
          <p>Rol: <b>${esc(ROLES[found.member.role] || found.member.role)}</b></p>
          <p class="hint">Siz <b>${esc(req.actor ? req.actor.user.email : req.user.email)}</b> sifatida qo'shilasiz.</p>
          <form method="post" action="/team/join/${esc(req.params.token)}"><button class="btn" style="width:100%">✅ Qabul qilish</button></form>
        </div>`;
  res.send(page("Jamoaga taklif", body, { user: req.user }));
});

teamRouter.post("/team/join/:token", requireAuth, async (req, res) => {
  const me = req.actor ? req.actor.user : req.user;
  const r = await acceptInvite(req.params.token, me);
  if (r.error) return res.send(page("Jamoaga taklif", `<div class="card center"><h2>⚠️</h2><p>${esc(r.error)}</p><p><a href="/workspace">Ish maydonlari</a></p></div>`, { user: req.user }));
  res.setHeader("Set-Cookie", wsCookie(r.owner.id));
  res.redirect(r.member.role === "operator" ? "/inbox" : "/dashboard");
});

// ==== Ish maydonini almashtirish ====

teamRouter.get("/workspace", requireAuth, async (req, res) => {
  const me = req.actor ? req.actor.user : req.user;
  const spaces = await workspacesFor(me);
  const currentId = req.user.id;
  const card = (id, name, sub, active) => `
    <form method="post" action="/workspace/switch" style="margin:0 0 10px">
      <input type="hidden" name="id" value="${esc(id)}">
      <button class="${active ? "" : "secondary"}" style="width:100%; text-align:left; margin:0; padding:14px 16px">
        <b>${esc(name)}</b><div style="font-size:12px; opacity:.8">${esc(sub)}${active ? " · hozir shu yerdasiz" : ""}</div>
      </button>
    </form>`;
  res.send(
    page(
      "Ish maydoni",
      `<div class="card" style="max-width:560px">
        <h3 style="margin-top:0">⇄ Ish maydonini tanlang</h3>
        ${card(me.id, me.businessName || "Mening biznesim", "Egasi", currentId === me.id)}
        ${spaces.map((s) => card(s.owner.id, s.owner.businessName || s.owner.email, ROLES[s.role] || s.role, currentId === s.owner.id)).join("") || `<p class="hint">Siz hali boshqa bizneslar jamoasida emassiz.</p>`}
      </div>`,
      { user: req.user }
    )
  );
});

teamRouter.post("/workspace/switch", requireAuth, async (req, res) => {
  const me = req.actor ? req.actor.user : req.user;
  const id = String(req.body?.id || "");
  if (!id || id === me.id) {
    res.setHeader("Set-Cookie", "ws=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
    return res.redirect("/dashboard");
  }
  const space = (await workspacesFor(me)).find((s) => s.owner.id === id);
  if (!space) return res.redirect("/workspace");
  res.setHeader("Set-Cookie", wsCookie(id));
  res.redirect(space.role === "operator" ? "/inbox" : "/dashboard");
});
