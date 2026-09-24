import test from "node:test";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
rmSync(dataDir, { recursive: true, force: true });
process.env.ADMIN_EMAILS = "owner-admin@x.uz";
process.env.FREE_MODE = "false";

const { register, requireAdmin } = await import("../src/auth.js");
const team = await import("../src/team.js");

/** Express'siz teamContext'ni chaqirish uchun minimal req/res. */
function fakeReq(user, { ws = "", method = "GET", path: p = "/dashboard" } = {}) {
  return {
    user,
    method,
    path: p,
    headers: { cookie: ws ? `sid=abc; ws=${ws}` : "sid=abc" },
    accepts: () => "html",
  };
}
function fakeRes() {
  return {
    headers: [],
    redirected: null,
    statusCode: 200,
    append(k, v) { this.headers.push([k, v]); },
    redirect(u) { this.redirected = u; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
  };
}
async function run(req) {
  const res = fakeRes();
  let nextCalled = false;
  await team.teamContext(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

test("rol ruxsatlari: operator faqat Inbox/kontakt, kuzatuvchi faqat GET, egasiga xos yo'llar yopiq", () => {
  assert.strictEqual(team.canAccess("operator", "POST", "/inbox/send"), true);
  assert.strictEqual(team.canAccess("operator", "GET", "/flows"), false);
  assert.strictEqual(team.canAccess("viewer", "GET", "/flows"), true);
  assert.strictEqual(team.canAccess("viewer", "POST", "/flows/x/save"), false);
  assert.strictEqual(team.canAccess("admin", "POST", "/flows/x/save"), true);
  for (const role of ["admin", "operator", "viewer"]) {
    assert.strictEqual(team.canAccess(role, "POST", "/account/password"), false, role);
    assert.strictEqual(team.canAccess(role, "GET", "/team"), false, role);
    assert.strictEqual(team.canAccess(role, "GET", "/admin"), false, role);
    assert.strictEqual(team.canAccess(role, "POST", "/workspace/switch"), true, role);
  }
  // Prefiks aldovi: "/inboxx" "/inbox" emas
  assert.strictEqual(team.canAccess("operator", "GET", "/inboxevil"), false);
});

test("taklif → qabul qilish → ish maydoniga o'tish → rol tekshiruvi", async () => {
  const { user: owner } = await register("owner@x.uz", "parol123", "Egasi");
  const { user: staff } = await register("staff@x.uz", "parol123", "Xodim");
  const { user: stranger } = await register("stranger@x.uz", "parol123", "Begona");

  const inv = team.inviteMember(owner, { email: "staff@x.uz", role: "operator" }, "https://app.uz");
  assert.match(inv.link, /^https:\/\/app\.uz\/team\/join\/[a-f0-9]{48}$/);
  assert.ok(team.inviteMember(owner, { email: "staff@x.uz", role: "viewer" }).error, "takroriy email");
  const token = inv.link.split("/").pop();

  // Begona odam token'siz o'ta olmaydi — ws cookie yolg'on bo'lsa tozalanadi
  const denied = await run(fakeReq(stranger, { ws: owner.id }));
  assert.strictEqual(denied.req?.user, undefined);
  assert.ok(denied.nextCalled);
  assert.ok(denied.res.headers.some(([k, v]) => k === "Set-Cookie" && v.startsWith("ws=;")));

  const acc = await team.acceptInvite(token, staff);
  assert.strictEqual(acc.owner.id, owner.id);
  assert.ok((await team.acceptInvite(token, stranger)).error, "token bir martalik");

  const req = fakeReq(staff, { ws: owner.id, path: "/inbox" });
  const ok = await run(req);
  assert.ok(ok.nextCalled);
  assert.strictEqual(req.user.id, owner.id, "ish maydoni almashdi");
  assert.strictEqual(req.actor.user.id, staff.id);
  assert.strictEqual(req.actor.role, "operator");

  const blocked = await run(fakeReq(staff, { ws: owner.id, path: "/flows" }));
  assert.strictEqual(blocked.nextCalled, false);
  assert.strictEqual(blocked.res.redirected, "/inbox");

  const post = await run(fakeReq(staff, { ws: owner.id, method: "POST", path: "/account/password" }));
  assert.strictEqual(post.nextCalled, false);
  assert.strictEqual(post.res.statusCode, 403);

  assert.deepStrictEqual((await team.workspacesFor(staff)).map((w) => w.owner.id), [owner.id]);

  // Chiqarilgach — kirish yopiladi
  team.removeMember(owner, acc.member.id);
  const after = fakeReq(staff, { ws: owner.id, path: "/inbox" });
  await run(after);
  assert.strictEqual(after.user.id, staff.id);
});

test("muddati o'tgan taklif qabul qilinmaydi", async () => {
  const { user: owner } = await register("o2@x.uz", "parol123", "E");
  const { user: staff } = await register("s2@x.uz", "parol123", "X");
  const inv = team.inviteMember(owner, { email: "s2@x.uz", role: "viewer" });
  inv.member.tokenExpires = Date.now() - 1;
  assert.match((await team.acceptInvite(inv.member.token, staff)).error, /muddati/);
});

test("admin egasining ish maydonidagi xodim admin panelga kira olmaydi", async () => {
  const { user: adminOwner } = await register("owner-admin@x.uz", "parol123", "Platforma");
  const { user: staff } = await register("s3@x.uz", "parol123", "X");
  const inv = team.inviteMember(adminOwner, { email: "s3@x.uz", role: "admin" });
  await team.acceptInvite(inv.member.token, staff);

  const req = fakeReq(staff, { ws: adminOwner.id, path: "/admin" });
  const r = await run(req);
  assert.strictEqual(r.nextCalled, false, "teamContext /admin ni bloklaydi");

  // Qo'shimcha himoya: requireAdmin ham haqiqiy shaxsni tekshiradi
  const res = fakeRes();
  let passed = false;
  requireAdmin({ user: adminOwner, actor: { user: staff, role: "admin" } }, res, () => { passed = true; });
  assert.strictEqual(passed, false);
  assert.strictEqual(res.statusCode, 403);
});
