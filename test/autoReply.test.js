import test from "node:test";
import assert from "node:assert";
import { findReply, commentReplyText } from "../src/autoReply.js";

test("kalit so'z bo'yicha javob topadi", () => {
  const reply = findReply("Salom, bu mahsulot narxi qancha?");
  assert.match(reply, /Narxlar/);
});

test("katta-kichik harfni farqlamaydi", () => {
  const reply = findReply("MANZIL qayerda?");
  assert.match(reply, /Manzilimiz/);
});

test("mos qoida topilmasa default javob qaytadi", () => {
  const reply = findReply("qwertyuiop");
  assert.match(reply, /operatorlarimiz/);
});

test("bo'sh matnga ham default javob qaytadi", () => {
  const reply = findReply("");
  assert.ok(reply.length > 0);
});

test("komment javobi mavjud", () => {
  assert.ok(commentReplyText().length > 0);
});
