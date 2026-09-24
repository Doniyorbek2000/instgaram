import test from "node:test";
import assert from "node:assert";
import { windowStatus, addTags } from "../src/contacts.js";

const NOW = Date.parse("2026-09-24T12:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();

test("24 soatlik oyna: IG/WA/FB — oxirgi kiruvchi xabardan 24 soat, Telegram — doim ochiq (bloklanmagan bo'lsa)", () => {
  const t = {
    chats: {
      "ig:1": [{ role: "user", text: "a", at: hoursAgo(5) }, { role: "assistant", text: "b", at: hoursAgo(1) }],
      "ig:2": [{ role: "user", text: "a", at: hoursAgo(30) }],
      "wa:3": [{ role: "assistant", text: "faqat bot yozgan", at: hoursAgo(1) }],
      "tg:4": [],
    },
    contactMeta: { "tg:5": { tags: [], fields: {}, blocked: true } },
  };
  const w1 = windowStatus(t, "ig:1", NOW);
  assert.strictEqual(w1.open, true);
  assert.strictEqual(w1.label, "19 soat 0 daq qoldi");
  assert.strictEqual(windowStatus(t, "ig:1", NOW + 18.5 * 3600000).label, "30 daq qoldi");
  assert.strictEqual(windowStatus(t, "ig:2", NOW).open, false);
  assert.strictEqual(windowStatus(t, "wa:3", NOW).open, false, "bot xabari oynani ochmaydi");
  assert.strictEqual(windowStatus(t, "tg:4", NOW).open, true);
  assert.strictEqual(windowStatus(t, "tg:5", NOW).open, false);
});

test("teglar normallashtiriladi va takrorlanmaydi", () => {
  const t = {};
  addTags(t, "ig:1", ["VIP Mijoz", "vip-mijoz", " lid "]);
  assert.deepStrictEqual(t.contactMeta["ig:1"].tags, ["vip-mijoz", "lid"]);
});
