import "./_setup.js";
import test from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import express from "express";

process.env.IG_APP_SECRET = "ig-secret";

const { register } = await import("../src/auth.js");
const { updateUser, findUserById } = await import("../src/db.js");
const { metaCallbacksRouter, parseSignedRequest } = await import("../src/metaCallbacks.js");

const b64 = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function signed(payload, secret = "ig-secret") {
  const p = b64(JSON.stringify({ algorithm: "HMAC-SHA256", issued_at: 1, ...payload }));
  return `${b64(crypto.createHmac("sha256", secret).update(p).digest())}.${p}`;
}

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(metaCallbacksRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
const post = (p, sr) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ signed_request: sr }) });

test("signed_request imzosi tekshiriladi", () => {
  assert.strictEqual(parseSignedRequest(signed({ user_id: "1" })).user_id, "1");
  assert.strictEqual(parseSignedRequest(signed({ user_id: "1" }, "boshqa")), null, "noto'g'ri kalit");
  assert.strictEqual(parseSignedRequest("buzilgan"), null);
});

test("deauthorize: Instagram ulanishi uziladi", async () => {
  const { user } = await register("deauth@x.uz", "parol1234", "D");
  await updateUser(user.id, { meta: { igUserId: "17841400000000077", igAccessToken: "TOK" } });
  assert.strictEqual((await post("/meta/deauthorize", signed({ user_id: "17841400000000077" }))).status, 200);
  const u = await findUserById(user.id);
  assert.strictEqual(u.meta.igAccessToken, "");
  assert.strictEqual(u.meta.igUserId, "");
});

test("data deletion: holat havolasi va tasdiq kodi qaytadi, soxta so'rov rad etiladi", async () => {
  const { user } = await register("del@x.uz", "parol1234", "Del");
  await updateUser(user.id, { meta: { igUserId: "17841400000000088", igAccessToken: "TOK" } });
  const r = await post("/meta/data-deletion", signed({ user_id: "17841400000000088" }));
  const j = await r.json();
  assert.match(j.confirmation_code, /^[a-f0-9]{16}$/);
  assert.match(j.url, new RegExp(`/data-deletion\\?code=${j.confirmation_code}$`));
  assert.strictEqual((await findUserById(user.id)).meta.igAccessToken, "");
  assert.strictEqual((await post("/meta/data-deletion", signed({ user_id: "1" }, "soxta"))).status, 400);
});
