import "./_setup.js";
import test from "node:test";
import assert from "node:assert";

process.env.FREE_MODE = "false";
process.env.ADMIN_EMAILS = "boss@x.uz";

const { register } = await import("../src/auth.js");
const cr = await import("../src/credits.js");
const flows = await import("../src/flows.js");

async function user(email, sub) {
  const { user: u } = await register(email, "parol123", "B");
  if (sub) u.subscription = sub;
  return u;
}
const expired = { plan: "start", status: "trial", trialEndsAt: new Date(Date.now() - 86400000).toISOString() };

test("tarif aniqlanadi: sinov, pullik, muddati o'tgan → bepul, admin → business", async () => {
  assert.strictEqual(cr.currentPlan(await user("c1@x.uz")), "trial");
  assert.strictEqual(cr.currentPlan(await user("c2@x.uz", { plan: "pro", status: "active", expiresAt: new Date(Date.now() + 86400000).toISOString() })), "pro");
  assert.strictEqual(cr.currentPlan(await user("c3@x.uz", expired)), "free");
  assert.strictEqual(cr.currentPlan(await user("boss@x.uz", expired)), "business");
});

const paid = (plan) => ({ plan, status: "active", expiresAt: new Date(Date.now() + 86400000).toISOString() });

test("kvota: avval oylik limit, keyin sotib olingan kreditlar; hammasi tugasa AI yopiladi", async () => {
  const u = await user("c4@x.uz", paid("start"));
  assert.strictEqual(cr.aiQuota(u).quota, cr.AI_QUOTA.start);
  u.aiUsage = { month: new Date().toISOString().slice(0, 7), used: cr.AI_QUOTA.start - 1, bonus: 0 };
  assert.ok(cr.canUseAi(u));
  cr.consumeAi(u);
  assert.strictEqual(cr.canUseAi(u), false);
  cr.addCredits(u, 2);
  assert.strictEqual(cr.aiQuota(u).left, 2);
  cr.consumeAi(u);
  cr.consumeAi(u);
  assert.strictEqual(u.aiUsage.bonus, 0);
  assert.strictEqual(cr.canUseAi(u), false);
});

test("yangi oy boshlanganda oylik hisob nolga tushadi, kreditlar saqlanadi", async () => {
  const u = await user("c5@x.uz");
  u.aiUsage = { month: "2000-01", used: 999, bonus: 7 };
  const q = cr.aiQuota(u);
  assert.strictEqual(q.used, 0);
  assert.strictEqual(q.bonus, 7);
});

test("bepul tarif: bot ishlaydi (admin o'chirmagan bo'lsa), faqat birinchi N flow faol", async () => {
  await cr.savePlatformSettings({ freePlan: true, freeFlowLimit: 2 });
  const u = await user("c6@x.uz", expired);
  assert.strictEqual(cr.botEnabled(u), true);
  const list = flows.ensureFlows(u).list;
  for (const kw of ["a", "b", "c"]) {
    list.push(flows.sanitizeFlow({ enabled: true, name: kw, triggers: [{ type: "keyword", keyword: kw }], start: "m", nodes: [{ id: "m", type: "message", text: kw }] }));
  }
  assert.ok(flows.findFlowTrigger(u, "keyword", { text: "a" }));
  assert.ok(flows.findFlowTrigger(u, "keyword", { text: "b" }));
  assert.strictEqual(flows.findFlowTrigger(u, "keyword", { text: "c" }), null, "3-flow bepul tarifda ishlamaydi");

  await cr.savePlatformSettings({ freePlan: false });
  assert.strictEqual(cr.botEnabled(u), false);
  assert.strictEqual(cr.aiQuota(u).quota, 0);
  await cr.savePlatformSettings({ freePlan: true });
});

test("kredit paketlari narxi admin sozlamasidan olinadi", async () => {
  const { setPlanPrices } = await import("../src/db.js");
  await setPlanPrices({ credits_c500: 35000 });
  const packs = await cr.getCreditPacks();
  assert.strictEqual(packs.find((p) => p.id === "c500").price, 35000);
  assert.strictEqual(packs.find((p) => p.id === "c2000").price, cr.CREDIT_PACKS.c2000.defaultPrice);
});

test("Mini, Lite va Bepul tariflarda AI yo'q — sotib olingan kredit ham ochmaydi; Start/Pro/Business'da bor", async () => {
  for (const plan of ["mini", "lite"]) {
    const u = await user(`np-${plan}@x.uz`, paid(plan));
    assert.strictEqual(cr.currentPlan(u), plan);
    assert.strictEqual(cr.aiQuota(u).hasAi, false);
    cr.addCredits(u, 100);
    assert.strictEqual(cr.canUseAi(u), false, `${plan}: kredit bilan ham AI yopiq`);
  }
  assert.strictEqual(cr.canUseAi(await user("np-free@x.uz", expired)), false);
  for (const plan of ["start", "pro", "business"]) {
    const u = await user(`yp-${plan}@x.uz`, paid(plan));
    assert.strictEqual(cr.aiQuota(u).hasAi, true);
    assert.strictEqual(cr.canUseAi(u), true);
  }
  assert.strictEqual(cr.canUseAi(await user("np-trial@x.uz")), true, "sinov davrida AI sinab ko'riladi");
});

test("AI'siz tarifda bot AI javob bermaydi, lekin /start'ga salomlashadi", async () => {
  const { aiAllowed } = await import("../src/aiControl.js");
  const { processMessage } = await import("../src/respond.js");
  const u = await user("np-bot@x.uz", paid("mini"));
  assert.deepStrictEqual(aiAllowed(u, "tg", "tg:1"), { allowed: false, reason: "plan" });
  const r1 = await processMessage(u, "telegram", "501", { text: "narxi qancha?" });
  assert.strictEqual(r1.reply, null);
  const r2 = await processMessage(u, "telegram", "502", { text: "/start" });
  assert.ok(r2.reply && /xush kelibsiz/i.test(r2.reply));
});
