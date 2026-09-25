import "./_setup.js";
import test from "node:test";
import assert from "node:assert";

process.env.FREE_MODE = "false";

const { register } = await import("../src/auth.js");
const { giftPlan, giftMany, segmentUsers, giftHistory } = await import("../src/gifts.js");
const { currentPlan } = await import("../src/credits.js");

const DAY = 86400000;
async function user(email, sub) {
  const { user: u } = await register(email, "parol123", "B");
  if (sub) u.subscription = sub;
  return u;
}

test("sovg'a: tugagan obunaga tarif darhol faollashadi, banner va tarix yoziladi", async () => {
  const u = await user("g1@x.uz", { plan: "mini", status: "expired", expiresAt: null });
  const g = giftPlan(u, { plan: "pro", days: 30, note: "Rahmat!" });
  assert.strictEqual(currentPlan(u), "pro");
  const left = (Date.parse(u.subscription.expiresAt) - Date.now()) / DAY;
  assert.ok(left > 29.9 && left <= 30);
  assert.strictEqual(u.meta.giftNotice.plan, "pro");
  assert.strictEqual(u.subscription.gifts[0].id, g.id);
  assert.strictEqual(u.subscription.gifts[0].note, "Rahmat!");
});

test("sovg'a: kunlar faol obuna / sinov tugashidan keyin qo'shiladi", async () => {
  const u = await user("g2@x.uz", { plan: "start", status: "active", expiresAt: new Date(Date.now() + 10 * DAY).toISOString() });
  giftPlan(u, { plan: "start", days: 30 });
  const left = (Date.parse(u.subscription.expiresAt) - Date.now()) / DAY;
  assert.ok(left > 39.9 && left <= 40);

  const t = await user("g3@x.uz", { plan: "start", status: "trial", trialEndsAt: new Date(Date.now() + 2 * DAY).toISOString() });
  giftPlan(t, { plan: "business", days: 7 });
  assert.strictEqual(currentPlan(t), "business");
  const tl = (Date.parse(t.subscription.expiresAt) - Date.now()) / DAY;
  assert.ok(tl > 8.9 && tl <= 9);
});

test("sovg'a: faol qimmatroq tarif pasaytirilmaydi", async () => {
  const u = await user("g4@x.uz", { plan: "business", status: "active", expiresAt: new Date(Date.now() + 5 * DAY).toISOString() });
  const g = giftPlan(u, { plan: "mini", days: 30 });
  assert.strictEqual(currentPlan(u), "business");
  assert.strictEqual(g.kept, true);
});

test("sovg'a: noto'g'ri tarif yoki muddat rad etiladi", async () => {
  const u = await user("g5@x.uz");
  assert.throws(() => giftPlan(u, { plan: "gold", days: 30 }));
  assert.throws(() => giftPlan(u, { plan: "pro", days: 0 }));
  assert.throws(() => giftPlan(u, { plan: "pro", days: 99999 }));
});

test("ommaviy sovg'a: segment bo'yicha, bloklanganlarga berilmaydi", async () => {
  const past = new Date(Date.now() - DAY).toISOString();
  const a = await user("g6@x.uz", { plan: "start", status: "trial", trialEndsAt: past });
  const b = await user("g7@x.uz", { plan: "start", status: "trial", trialEndsAt: past });
  b.meta = { ...(b.meta || {}), blocked: true };
  const inSeg = (list) => list.map((x) => x.id);
  const { listUsers } = await import("../src/db.js");
  const expired = inSeg(segmentUsers(await listUsers(), "expired"));
  assert.ok(expired.includes(a.id));
  assert.ok(!expired.includes(b.id));

  const r = await giftMany({ ids: [a.id, b.id], plan: "start", days: 14, notify: false });
  assert.strictEqual(r.count, 1);
  assert.strictEqual(currentPlan(a), "start");
  assert.strictEqual(currentPlan(b), "free");
  assert.ok((await giftHistory()).some((g) => g.userId === a.id && g.days === 14));
});
