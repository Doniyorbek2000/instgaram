import "./_setup.js";
import test from "node:test";
import assert from "node:assert";
import express from "express";

const { csrfGuard } = await import("../src/csrf.js");

const app = express();
app.use(csrfGuard);
app.all("/x", (req, res) => res.send("ok"));
const server = app.listen(0);
const port = server.address().port;
test.after(() => server.close());

const call = (method, headers = {}) =>
  fetch(`http://127.0.0.1:${port}/x`, { method, headers }).then((r) => r.status);

test("o'z saytidan kelgan POST o'tadi", async () => {
  assert.strictEqual(await call("POST", { cookie: "sid=abc", origin: `http://127.0.0.1:${port}` }), 200);
});

test("boshqa (sub)domendan sessiya bilan kelgan POST rad etiladi", async () => {
  assert.strictEqual(await call("POST", { cookie: "sid=abc", origin: "https://evil.example" }), 403);
  assert.strictEqual(await call("POST", { cookie: "lang=uz; sid=abc", referer: "https://adm.obunext.uz/x" }), 403);
});

test("sessiyasiz server-server chaqiruvlari va GET ta'sirlanmaydi", async () => {
  assert.strictEqual(await call("POST", { origin: "https://graph.facebook.com" }), 200, "webhook");
  assert.strictEqual(await call("GET", { cookie: "sid=abc", origin: "https://evil.example" }), 200);
});
