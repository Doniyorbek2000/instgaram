import test from "node:test";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
rmSync(dataDir, { recursive: true, force: true });
process.env.GEMINI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";

const { register } = await import("../src/auth.js");
const { sanitizeFlow, ensureFlows, validateFlow, findFlow } = await import("../src/flows.js");
const { flowsRouter } = await import("../src/web/flows_ui.js");
const { TOOLS } = await import("../src/mcp.js");

const { user: tenant } = await register("builder@test.uz", "parol123", "Builder");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use((req, _res, next) => { req.user = tenant; next(); });
app.use(flowsRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const post = (url, body) =>
  fetch(base + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "manual" });

const good = {
  name: "Narx",
  triggers: [{ type: "keyword", keyword: "narx", matchType: "contains" }],
  start: "a",
  nodes: [
    { id: "a", type: "message", text: "Salom {name}", buttons: [{ id: "b1", title: "Ha", next: "b" }] },
    { id: "b", type: "input", text: "Telefon?", varName: "phone", validate: "phone", next: "c" },
    { id: "c", type: "action", actions: [{ kind: "add_tag", value: "lid" }] },
  ],
};

test("validateFlow: to'g'ri flow'da xato yo'q", () => {
  const v = validateFlow(sanitizeFlow(good), []);
  assert.deepStrictEqual(v.errors, []);
});

test("validateFlow: xatolar va ogohlantirishlar topiladi", () => {
  const f = sanitizeFlow({
    triggers: [{ type: "keyword", keyword: "", matchType: "contains" }, { type: "comment", matchType: "ai", aiIntent: "" }],
    start: "a",
    nodes: [
      { id: "a", type: "message", text: "", buttons: [{ id: "x", title: "Bos" }] },
      { id: "b", type: "input", text: "" },
      { id: "c", type: "condition", conditions: [{ kind: "tag", op: "has", value: "" }] },
      { id: "d", type: "redirect", flowId: "yoq" },
      { id: "e", type: "action", actions: [{ kind: "run_flow", key: "yoq" }, { kind: "set_var", key: "", value: "1" }] },
      { id: "n", type: "note", text: "izoh" },
    ],
  });
  const { errors, warnings } = validateFlow(f, []);
  const msgs = errors.map((e) => e.msg).join("\n");
  assert.match(msgs, /1-trigger: kalit so'z/);
  assert.match(msgs, /2-trigger: AI trigger/);
  assert.match(msgs, /savol matni yo'q/);
  assert.match(msgs, /teg shartida/);
  assert.match(msgs, /o'tiladigan flow/);
  assert.match(msgs, /ishga tushiriladigan flow/);
  assert.match(msgs, /o'zgaruvchi nomi/);
  assert.ok(warnings.some((w) => w.nodeId === "a" && /ulanmagan/.test(w.msg)));
  assert.ok(warnings.some((w) => w.nodeId === "b" && /yo'l yo'q/.test(w.msg)));
  assert.ok(!warnings.some((w) => w.nodeId === "n"), "izoh bloki tekshirilmaydi");
  assert.deepStrictEqual(validateFlow(sanitizeFlow({}), []).errors.map((e) => e.msg), ["Flow bo'sh — kamida bitta blok qo'shing"]);
});

test("save: xatoli flow saqlanadi, lekin yoqilmaydi; versiya yoziladi", async () => {
  const flow = sanitizeFlow(good);
  ensureFlows(tenant).list.push(flow);

  let r = await post(`/flows/${flow.id}/save`, { ...good, enabled: true, nodes: good.nodes.map((n) => (n.id === "b" ? { ...n, text: "" } : n)) });
  let d = await r.json();
  assert.strictEqual(d.ok, true);
  assert.strictEqual(d.flow.enabled, false);
  assert.match(d.error, /yoqilmaydi/);
  assert.ok(d.validation.errors.length >= 1);
  assert.strictEqual(d.flow.versions, undefined, "versiyalar brauzerga yuborilmaydi");
  assert.strictEqual(d.flow.versionCount, 1);

  r = await post(`/flows/${flow.id}/save`, { ...good, enabled: true });
  d = await r.json();
  assert.strictEqual(d.flow.enabled, true);
  assert.strictEqual(d.error, "");
  assert.strictEqual(d.flow.versionCount, 2);

  // O'zgarishsiz saqlash versiya qo'shmaydi
  d = await (await post(`/flows/${flow.id}/save`, { ...good, enabled: true })).json();
  assert.strictEqual(d.flow.versionCount, 2);

  const versions = await (await fetch(`${base}/flows/${flow.id}/versions`)).json();
  assert.strictEqual(versions.versions.length, 2);
  assert.strictEqual(versions.versions[0].nodes, 3);

  // Eng yangi versiyani (savol matni bo'sh holat) tiklash
  d = await (await post(`/flows/${flow.id}/restore/0`, {})).json();
  assert.strictEqual(d.ok, true);
  assert.strictEqual(d.flow.enabled, false, "tiklangan versiya o'chiq ochiladi");
  assert.strictEqual(d.flow.nodes.b.text, "");
  assert.strictEqual(d.flow.versionCount, 3, "joriy holat ham tarixga tushadi");
  assert.ok(d.validation.errors.length);

  // Xatoli flow ro'yxatdan ham yoqilmaydi
  r = await post(`/flows/${flow.id}/toggle`, {});
  assert.strictEqual(r.status, 302);
  assert.match(decodeURIComponent(r.headers.get("location")), /yoqilmadi/);
  assert.strictEqual(findFlow(tenant, flow.id).enabled, false);

  const bad = await (await post(`/flows/${flow.id}/restore/99`, {})).json();
  assert.strictEqual(bad.ok, false);
});

test("validate: saqlamasdan tekshiradi", async () => {
  const flow = ensureFlows(tenant).list[0];
  const d = await (await post(`/flows/${flow.id}/validate`, { ...good, nodes: [] })).json();
  assert.strictEqual(d.ok, true);
  assert.ok(d.validation.errors.length);
  assert.strictEqual(Object.keys(findFlow(tenant, flow.id).nodes).length, 3, "saqlanmadi");
});

test("export → import: yangi, o'chiq flow; boshqa flow havolalari tozalanadi", async () => {
  const flow = ensureFlows(tenant).list[0];
  const res = await fetch(`${base}/flows/${flow.id}/export`);
  assert.match(res.headers.get("content-disposition"), /attachment/);
  const file = await res.json();
  assert.strictEqual(file.format, "adm-flow");
  assert.strictEqual(file.flow.stats, undefined);

  file.flow.nodes.r = { id: "r", type: "redirect", flowId: "flow_boshqa_akkaunt", x: 0, y: 0 };
  const before = ensureFlows(tenant).list.length;
  const d = await (await post("/flows/import", file)).json();
  assert.strictEqual(d.ok, true);
  const imported = findFlow(tenant, d.id);
  assert.notStrictEqual(imported.id, flow.id);
  assert.strictEqual(imported.enabled, false);
  assert.strictEqual(imported.nodes.r.flowId, "");
  assert.strictEqual(ensureFlows(tenant).list.length, before + 1);

  // Forma orqali (fayl matni) import
  const r = await fetch(`${base}/flows/import`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ json: JSON.stringify(file) }),
    redirect: "manual",
  });
  assert.match(r.headers.get("location"), /^\/flows\/flow_.*imported=1/);

  const broken = await fetch(`${base}/flows/import`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ json: "{buzuq" }),
    redirect: "manual",
  });
  assert.match(decodeURIComponent(broken.headers.get("location")), /JSON fayl buzilgan/);
  const notFlow = await (await post("/flows/import", { hello: 1 })).json();
  assert.strictEqual(notFlow.ok, false);
});

test("muharrir sahifasi versiyalarni yubormaydi va tekshiruv natijasini beradi", async () => {
  const flow = ensureFlows(tenant).list.find((f) => (f.versions || []).length);
  const html = await (await fetch(`${base}/flows/${flow.id}`)).text();
  const data = JSON.parse(html.match(/<script type="application\/json" id="fbData">([\s\S]*?)<\/script>/)[1]);
  const meta = JSON.parse(html.match(/<script type="application\/json" id="fbMeta">([\s\S]*?)<\/script>/)[1]);
  assert.strictEqual(data.versions, undefined);
  assert.ok(data.versionCount > 0);
  assert.ok(Array.isArray(meta.validation.errors));
  assert.match(html, /data-act="undo"/);
  const list = await (await fetch(`${base}/flows`)).text();
  assert.match(list, /ta xato/);
  assert.match(list, /\/flows\/import/);
});

test("MCP: xatoli flow yoqilmaydi, get_flow versiyasiz", async () => {
  const tool = (name) => TOOLS.find((t) => t.name === name);
  const created = await tool("create_flow").run(tenant, { flow: { name: "MCP", enabled: true, start: "a", nodes: [{ id: "a", type: "input", text: "" }] } });
  assert.ok(created.validation.errors.length);
  const id = created.editorPath.split("/").pop();
  assert.strictEqual(findFlow(tenant, id).enabled, false);
  await assert.rejects(async () => tool("set_flow_enabled").run(tenant, { flowId: id, enabled: true }), /errors/);
  const upd = await tool("update_flow").run(tenant, { flowId: id, flow: { name: "MCP", start: "a", nodes: [{ id: "a", type: "input", text: "Ismingiz?" }] } });
  assert.deepStrictEqual(upd.validation.errors, []);
  const got = await tool("get_flow").run(tenant, { flowId: id });
  assert.strictEqual(got.versions, undefined);
  assert.strictEqual(findFlow(tenant, id).versions.length, 1);
  await tool("set_flow_enabled").run(tenant, { flowId: id, enabled: true });
  assert.strictEqual(findFlow(tenant, id).enabled, true);
});
