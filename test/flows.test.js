import test from "node:test";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
rmSync(dataDir, { recursive: true, force: true });
process.env.GEMINI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";
process.env.FREE_MODE = "false";

const { register } = await import("../src/auth.js");
const flows = await import("../src/flows.js");
const { renderTemplate } = await import("../src/templating.js");
const { runTenantFollowUps } = await import("../src/followups.js");
const { processMessage } = await import("../src/respond.js");
const { setFields, addTags } = await import("../src/contacts.js");

async function newTenant(email) {
  const { user } = await register(email, "parol123", "Flow Do'kon");
  user.rules = [];
  return user;
}

/** Yuborilgan xabarlarni yig'uvchi kontekst. */
function capture(extra = {}) {
  const sent = [];
  return { sent, ctx: { ...extra, send: async (m) => { sent.push(m); return true; } } };
}

function addFlow(tenant, def) {
  const flow = flows.sanitizeFlow({ enabled: true, ...def });
  flows.ensureFlows(tenant).list.push(flow);
  return flow;
}

const lead = {
  name: "Lid voronka",
  triggers: [{ type: "keyword", keyword: "kurs, course", matchType: "contains" }],
  start: "m1",
  nodes: [
    { id: "m1", type: "message", text: "Salom, {name|do'stim}! Qaysi kurs?", buttons: [
      { id: "b1", title: "SMM", next: "a1" },
      { id: "b2", title: "Sayt", url: "https://example.uz" },
    ] },
    { id: "a1", type: "action", actions: [{ kind: "add_tag", value: "smm" }, { kind: "conversion", value: "tanlov" }], next: "q1" },
    { id: "q1", type: "input", text: "Telefon raqamingiz?", varName: "telefon", validate: "phone", next: "c1" },
    { id: "c1", type: "condition", match: "all", conditions: [{ kind: "tag", op: "has", value: "smm" }], yes: "m2", no: "m3" },
    { id: "m2", type: "message", text: "Rahmat! {telefon} raqamiga qo'ng'iroq qilamiz." },
    { id: "m3", type: "message", text: "Boshqa yo'l" },
  ],
};

test("to'liq voronka: trigger → tugma → amal → ma'lumot yig'ish → shart → yakun", async () => {
  const t = await newTenant("flow1@x.uz");
  const flow = addFlow(t, lead);
  const key = "ig:100";

  const hit = flows.findFlowTrigger(t, "keyword", { text: "Course haqida" });
  assert.strictEqual(hit.flow.id, flow.id);

  const { sent, ctx } = capture();
  await flows.startFlow(t, key, flow, ctx);
  assert.strictEqual(sent[0].text, "Salom, do'stim! Qaysi kurs?");
  assert.deepStrictEqual(sent[0].options, [
    { title: "SMM", payload: `FLOW:${flow.id}:a1` },
    { title: "Sayt", url: "https://example.uz" },
  ]);

  assert.ok(await flows.handleFlowInbound(t, key, { payload: `FLOW:${flow.id}:a1` }, ctx));
  assert.strictEqual(sent[1].text, "Telefon raqamingiz?");
  assert.deepStrictEqual(t.contactMeta[key].tags, ["smm"]);

  // Noto'g'ri telefon — qayta so'raladi, sessiya saqlanadi
  assert.ok(await flows.handleFlowInbound(t, key, { text: "bilmayman" }, ctx));
  assert.match(sent[2].text, /Telefon raqam noto'g'ri/);
  assert.ok(flows.activeFlowSession(t, key));

  assert.ok(await flows.handleFlowInbound(t, key, { text: "90 123 45 67" }, ctx));
  assert.strictEqual(sent[3].text, "Rahmat! +998901234567 raqamiga qo'ng'iroq qilamiz.");
  assert.strictEqual(t.contactMeta[key].fields.telefon, "+998901234567");
  assert.strictEqual(t.contactMeta[key].fields.phone, "+998901234567");
  assert.strictEqual(flows.activeFlowSession(t, key), null);

  assert.strictEqual(flow.stats.started, 1);
  assert.strictEqual(flow.stats.conversions, 1);
  assert.strictEqual(flow.stats.completed, 1);
  const today = Object.keys(flow.stats.daily)[0];
  assert.deepStrictEqual(flow.stats.daily[today], { started: 1, completed: 1, conversions: 1 });
});

test("input blokida 'bekor' so'zi flow'ni to'xtatadi", async () => {
  const t = await newTenant("cancel@x.uz");
  const flow = addFlow(t, { triggers: [], start: "q", nodes: [{ id: "q", type: "input", text: "Ismingiz?", varName: "name", validate: "name", next: null }] });
  const { sent, ctx } = capture();
  await flows.startFlow(t, "tg:1", flow, ctx);
  await flows.handleFlowInbound(t, "tg:1", { text: "Bekor" }, ctx);
  assert.strictEqual(sent.at(-1).text, "Bekor qilindi ✅");
  assert.strictEqual(flows.activeFlowSession(t, "tg:1"), null);
});

test("tugma o'rniga matn yozilsa flow sessiyasi yopiladi va xabar odatdagidek ishlanadi", async () => {
  const t = await newTenant("textbtn@x.uz");
  const flow = addFlow(t, lead);
  const { ctx } = capture();
  await flows.startFlow(t, "ig:5", flow, ctx);
  assert.strictEqual(await flows.handleFlowInbound(t, "ig:5", { text: "salom" }, ctx), false);
  assert.strictEqual(flows.activeFlowSession(t, "ig:5"), null);
});

test("kutish bloki navbatga qo'yiladi va muddati kelganda flow davom etadi", async () => {
  const t = await newTenant("delay@x.uz");
  const flow = addFlow(t, {
    triggers: [], start: "m1",
    nodes: [
      { id: "m1", type: "message", text: "Birinchi", next: "d1" },
      { id: "d1", type: "delay", minutes: 10, next: "m2" },
      { id: "m2", type: "message", text: "10 daqiqadan keyin, {name|mehmon}" },
    ],
  });
  const { sent, ctx } = capture();
  const r = await flows.startFlow(t, "ig:7", flow, ctx);
  assert.strictEqual(r.status, "delayed");
  assert.deepStrictEqual(sent.map((m) => m.text), ["Birinchi"]);
  assert.strictEqual(t.followUps.length, 1);
  assert.strictEqual(t.followUps[0].kind, "flow");

  const later = [];
  const fakeSend = async (_t, chan, id, text) => { later.push({ chan, id, text }); return true; };
  await runTenantFollowUps(t, Date.now() + 11 * 60 * 1000, fakeSend);
  assert.deepStrictEqual(later, [{ chan: "ig", id: "7", text: "10 daqiqadan keyin, mehmon" }]);
  assert.strictEqual(t.followUps.length, 0);
});

test("shartlar: hafta kuni, vaqt (tunni kesib o'tuvchi ham), sana, ball, o'zgaruvchi, kanal, obuna", async () => {
  const t = await newTenant("cond@x.uz");
  t.settings.timezone = "Asia/Tashkent";
  const key = "ig:9";
  // 2026-09-24 payshanba, Toshkent vaqti 10:30 (UTC+5)
  const now = new Date("2026-09-24T05:30:00Z");
  const ev = (c, extra = {}) => flows.evaluateCondition(t, key, c, { now, ...extra });

  assert.strictEqual(await ev({ kind: "weekday", value: "1,2,3,4,5" }), true);
  assert.strictEqual(await ev({ kind: "weekday", value: "6,7" }), false);
  assert.strictEqual(await ev({ kind: "time", value: "09:00-18:00" }), true);
  assert.strictEqual(await ev({ kind: "time", value: "22:00-08:00" }), false);
  assert.strictEqual(await ev({ kind: "time", value: "10:00-02:00" }), true);
  assert.strictEqual(await ev({ kind: "date", value: "2026-09-01", value2: "2026-09-30" }), true);
  assert.strictEqual(await ev({ kind: "date", value: "2026-10-01" }), false);

  assert.strictEqual(await ev({ kind: "points", op: "gte", value: "10" }), false);
  t.gamification = { participants: { [key]: { points: 25 } } };
  assert.strictEqual(await ev({ kind: "points", op: "gte", value: "10" }), true);
  assert.strictEqual(await ev({ kind: "points", op: "lte", value: "10" }), false);

  assert.strictEqual(await ev({ kind: "var", key: "shahar", op: "exists" }), false);
  setFields(t, key, { shahar: "Toshkent" });
  assert.strictEqual(await ev({ kind: "var", key: "shahar", op: "eq", value: "toshkent" }), true);
  assert.strictEqual(await ev({ kind: "var", key: "shahar", op: "not_exists" }), false);

  addTags(t, key, ["VIP mijoz"]);
  assert.strictEqual(await ev({ kind: "tag", op: "has", value: "vip mijoz" }), true);
  assert.strictEqual(await ev({ kind: "tag", op: "not", value: "vip mijoz" }), false);

  assert.strictEqual(await ev({ kind: "channel", value: "ig,tg" }), true);
  assert.strictEqual(await ev({ kind: "channel", value: "wa" }), false);

  assert.strictEqual(await ev({ kind: "follows" }, { checkFollow: async () => false }), false);
  assert.strictEqual(await ev({ kind: "follows" }, { checkFollow: async () => true }), true);
  assert.strictEqual(await ev({ kind: "follows" }, { checkFollow: async () => null }), true);
});

test("redirect boshqa flow'ga o'tadi, o'z-o'ziga cheksiz sikl bo'lmaydi", async () => {
  const t = await newTenant("redir@x.uz");
  const target = addFlow(t, { name: "B", triggers: [], start: "x", nodes: [{ id: "x", type: "message", text: "B flow" }] });
  const src = addFlow(t, { name: "A", triggers: [], start: "r", nodes: [{ id: "r", type: "redirect", flowId: target.id }] });
  const loop = addFlow(t, { name: "L", triggers: [], start: "r", nodes: [{ id: "r", type: "redirect", flowId: "self" }] });
  loop.nodes.r.flowId = loop.id;

  const { sent, ctx } = capture();
  await flows.startFlow(t, "ig:1", src, ctx);
  assert.deepStrictEqual(sent.map((m) => m.text), ["B flow"]);
  assert.strictEqual(target.stats.started, 1);
  assert.strictEqual((await flows.startFlow(t, "ig:1", loop, ctx)).status, "completed");
});

test("sanitizeFlow: noma'lum bloklar, yo'q havolalar va xavfli URL tozalanadi", () => {
  const f = flows.sanitizeFlow({
    name: "  Test  ",
    start: "nope",
    triggers: [{ type: "hack", keyword: "x", matchType: "evil" }],
    nodes: [
      { id: "a", type: "message", text: "Hi", buttons: [{ title: "JS", url: "javascript:alert(1)" }, { title: "Go", next: "missing" }], next: "b" },
      { id: "b", type: "delay", minutes: 99999, next: "a" },
      { id: "c", type: "evil" },
      { id: "bad id!", type: "message", text: "x" },
    ],
  });
  assert.strictEqual(f.name, "Test");
  assert.deepStrictEqual(Object.keys(f.nodes), ["a", "b"]);
  assert.strictEqual(f.start, "a");
  assert.deepStrictEqual(f.triggers[0].type, "keyword");
  assert.deepStrictEqual(f.triggers[0].matchType, "contains");
  assert.strictEqual(f.nodes.a.buttons[0].url, "");
  assert.strictEqual(f.nodes.a.buttons[1].next, null);
  assert.strictEqual(f.nodes.b.minutes, 1380);
  assert.strictEqual(f.enabled, false);
});

test("DM'da 'hamma matn' flow triggeri AI suhbatni to'smaydi, komment uchun esa ishlaydi", async () => {
  const t = await newTenant("catch@x.uz");
  addFlow(t, { triggers: [{ type: "keyword", keyword: "*", matchType: "any" }, { type: "comment", keyword: "*", matchType: "any" }], start: "m", nodes: [{ id: "m", type: "message", text: "x" }] });
  assert.strictEqual(flows.findFlowTrigger(t, "keyword", { text: "salom" }), null);
  assert.ok(flows.findFlowTrigger(t, "comment", { text: "salom" }));
});

test("o'chirilgan flow ishga tushmaydi va uning tugmalari javob bermaydi", async () => {
  const t = await newTenant("off@x.uz");
  const flow = addFlow(t, { ...lead, enabled: false });
  assert.strictEqual(flows.findFlowTrigger(t, "keyword", { text: "kurs" }), null);
  assert.strictEqual(await flows.handleFlowInbound(t, "ig:1", { payload: `FLOW:${flow.id}:a1` }), false);
});

test("o'zgaruvchilar: zaxira qiymat, noma'lum o'zgaruvchi bo'sh qoladi", async () => {
  const t = await newTenant("tpl@x.uz");
  t.contactProfiles = { 55: { username: "ali", name: "Ali Valiyev" } };
  assert.strictEqual(renderTemplate("Salom {first_name}! @{username} {nomalum}", t, "ig:55"), "Salom Ali! @ali ");
  assert.strictEqual(renderTemplate("{name|Mehmon}", t, "ig:77"), "Mehmon");
  assert.strictEqual(renderTemplate("{business}", t, "ig:77"), "Flow Do'kon");
});

test("processMessage: kalit so'z flow'ni ishga tushiradi, javob flow orqali ketadi va Inbox'ga yoziladi", async () => {
  const t = await newTenant("pm@x.uz");
  addFlow(t, lead);
  const res = await processMessage(t, "telegram", "321", { text: "Kurs narxi?" });
  assert.strictEqual(res.reply, null);
  const log = t.chats["tg:321"].map((m) => `${m.role}:${m.text}`);
  assert.deepStrictEqual(log, ["user:Kurs narxi?", "assistant:Salom, do'stim! Qaysi kurs?"]);
  assert.ok(flows.activeFlowSession(t, "tg:321"));
});

test("ice breaker tugmasi (IB:n) savol matni sifatida ishlanadi va kalit so'z flow'ini ishga tushiradi", async () => {
  const t = await newTenant("ib@x.uz");
  t.settings.icebreakers = [{ question: "Kurslar narxi qancha?", flowId: "" }];
  addFlow(t, lead);
  const res = await processMessage(t, "instagram", "900", { payload: "IB:0" });
  assert.strictEqual(res.reply, null);
  assert.deepStrictEqual(t.chats["ig:900"].map((m) => m.role), ["user", "assistant"]);
  assert.strictEqual(t.chats["ig:900"][0].text, "Kurslar narxi qancha?");
});

test("flow'ni boshidan ochgan tugma (ice breaker / broadcast) 'boshlandi' deb hisoblanadi", async () => {
  const t = await newTenant("ibflow@x.uz");
  const flow = addFlow(t, lead);
  const { ctx } = capture();
  await flows.handleFlowInbound(t, "ig:901", { payload: `FLOW:${flow.id}:${flow.start}` }, ctx);
  assert.strictEqual(flow.stats.started, 1);
});
