import test from "node:test";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
rmSync(dataDir, { recursive: true, force: true });
process.env.FREE_MODE = "false";

const { register } = await import("../src/auth.js");
const mcp = await import("../src/mcp.js");
const { canAccess } = await import("../src/team.js");

const call = (t, rec, method, params, id = 1) => mcp.handleRpc(t, rec, { jsonrpc: "2.0", id, method, params });

test("token: faqat xeshi saqlanadi, topiladi, bekor qilingach ishlamaydi", async () => {
  const { user: t } = await register("mcp1@x.uz", "parol123", "Biznes");
  const { token, rec } = mcp.createApiToken(t, { name: "Claude" });
  assert.match(token, /^obx_[a-f0-9]{48}$/);
  assert.ok(!JSON.stringify(t.apiTokens).includes(token), "token ochiq saqlanmaydi");
  assert.strictEqual((await mcp.findByToken(token)).tenant.id, t.id);
  assert.strictEqual(await mcp.findByToken("adm_" + "0".repeat(48)), null);
  mcp.revokeApiToken(t, rec.id);
  assert.strictEqual(await mcp.findByToken(token), null);
});

test("initialize → tools/list → create_flow → list_flows", async () => {
  const { user: t } = await register("mcp2@x.uz", "parol123", "Kurslar");
  const { rec } = mcp.createApiToken(t, {});
  const init = await call(t, rec, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude" } });
  assert.strictEqual(init.result.protocolVersion, "2025-06-18");
  assert.ok(init.result.capabilities.tools);
  assert.strictEqual(await mcp.handleRpc(t, rec, { jsonrpc: "2.0", method: "notifications/initialized" }), null);

  const list = await call(t, rec, "tools/list", {});
  const names = list.result.tools.map((x) => x.name);
  for (const n of ["get_business_info", "create_flow", "update_flow", "send_broadcast", "get_analytics"]) assert.ok(names.includes(n), n);

  const created = await call(t, rec, "tools/call", {
    name: "create_flow",
    arguments: { flow: { name: "KURS voronka", triggers: [{ type: "comment", keyword: "KURS", matchType: "contains" }], start: "m1", nodes: [
      { id: "m1", type: "message", text: "Salom {name|do'stim}!", next: "a1" },
      { id: "a1", type: "action", actions: [{ kind: "conversion", value: "Lid" }] },
    ] } },
  });
  assert.strictEqual(created.result.isError, undefined);
  const out = JSON.parse(created.result.content[0].text);
  assert.strictEqual(out.created.name, "KURS voronka");
  assert.strictEqual(out.created.enabled, false, "Claude yaratgan flow sukut bo'yicha o'chiq");
  const flow = t.flows.list[0];
  assert.ok(flow.nodes.m1.x > 0 || flow.nodes.a1.x > 0, "avtomatik joylashtirildi");

  const flows = JSON.parse((await call(t, rec, "tools/call", { name: "list_flows", arguments: {} })).result.content[0].text);
  assert.strictEqual(flows.length, 1);

  const bad = await call(t, rec, "tools/call", { name: "create_flow", arguments: { flow: { nodes: [{ id: "x", type: "evil" }] } } });
  assert.strictEqual(bad.result.isError, true);
  assert.strictEqual((await call(t, rec, "nope", {})).error.code, -32601);
});

test("faqat o'qish tokeni yozuvchi tool'larni ko'rmaydi va chaqira olmaydi", async () => {
  const { user: t } = await register("mcp3@x.uz", "parol123", "B");
  const { rec } = mcp.createApiToken(t, { scope: "read" });
  const names = (await call(t, rec, "tools/list", {})).result.tools.map((x) => x.name);
  assert.ok(!names.includes("create_flow") && !names.includes("send_broadcast"));
  const r = await call(t, rec, "tools/call", { name: "delete_flow", arguments: { flowId: "x" } });
  assert.strictEqual(r.result.isError, true);
  assert.match(r.result.content[0].text, /read-only/);
});

test("send_broadcast dryRun faqat auditoriyani hisoblaydi", async () => {
  const { user: t } = await register("mcp4@x.uz", "parol123", "B");
  t.chats = { "tg:1": [{ role: "user", text: "x", at: new Date().toISOString() }] };
  const { rec } = mcp.createApiToken(t, {});
  const r = await call(t, rec, "tools/call", { name: "send_broadcast", arguments: { name: "Test", message: "Salom", dryRun: true } });
  assert.deepStrictEqual(JSON.parse(r.result.content[0].text), { audience: 1 });
  assert.strictEqual((t.broadcasts || []).length, 0);
});

test("jamoa a'zosi tokenlarni boshqara olmaydi", () => {
  assert.strictEqual(canAccess("admin", "POST", "/integrations/tokens"), false);
  assert.strictEqual(canAccess("admin", "POST", "/integrations"), true);
});
