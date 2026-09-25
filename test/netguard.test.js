import "./_setup.js";
import test from "node:test";
import assert from "node:assert";

const { isPrivateIp, assertPublicUrl, safeFetch } = await import("../src/netguard.js");

const lookupTo = (address) => async () => [{ address }];

test("ichki va xizmat IP'lari aniqlanadi", () => {
  for (const ip of ["127.0.0.1", "10.2.3.4", "172.20.0.5", "192.168.1.1", "169.254.169.254", "100.64.1.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.strictEqual(isPrivateIp(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "2a00:1450:4001::1"]) assert.strictEqual(isPrivateIp(ip), false, ip);
});

test("ichki IP'ga ishora qiluvchi domen rad etiladi (127.0.0.1.nip.io kabi)", async () => {
  await assert.rejects(assertPublicUrl("https://127.0.0.1.nip.io/x", { lookup: lookupTo("127.0.0.1") }), /ichki tarmoq/);
  await assert.rejects(assertPublicUrl("http://metadata.example/", { lookup: lookupTo("169.254.169.254") }), /ichki tarmoq/);
  await assert.rejects(assertPublicUrl("ftp://example.com/"), /http/);
  assert.ok(await assertPublicUrl("https://hooks.example.com/a", { lookup: lookupTo("93.184.216.34") }));
});

test("tashqi saytdan ichki manzilga redirect kuzatilmaydi", async () => {
  const lookup = async (host) => [{ address: host === "evil.example" ? "93.184.216.34" : "10.0.0.5" }];
  const fetchFn = async () => new Response("", { status: 302, headers: { location: "http://internal.example/secret" } });
  await assert.rejects(safeFetch("https://evil.example/", { method: "POST", body: "{}" }, { fetchFn, lookup }), /ichki tarmoq/);
});

test("ruxsat etilgan redirect kuzatiladi, POST → GET (Apps Script)", async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push([url, init.method, init.body]);
    return calls.length === 1 ? new Response("", { status: 302, headers: { location: "https://script.googleusercontent.com/ok" } }) : new Response("ok");
  };
  const res = await safeFetch("https://script.google.com/macros/s/x/exec", { method: "POST", body: "{}" }, { fetchFn, lookup: lookupTo("142.250.1.1") });
  assert.strictEqual(await res.text(), "ok");
  assert.deepStrictEqual(calls[1], ["https://script.googleusercontent.com/ok", "GET", undefined]);
});
