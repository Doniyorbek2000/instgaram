import test from "node:test";
import assert from "node:assert";

// data/ papkasi allaqachon features.test.js/auth.test.js tomonidan tozalangan bo'lishi
// mumkin — bu yerda qayta tozalamaymiz, chunki node --test barcha *.test.js fayllarni
// bitta jarayonda ishga tushiradi va data/db.json umumiy holat sifatida ishlatiladi.

// Local .env'dagi FREE_MODE holatidan qat'i nazar testlar deterministik bo'lishi kerak
process.env.FREE_MODE = "false";

const { register } = await import("../src/auth.js");
const { createOrder } = await import("../src/db.js");
const { handlePayme } = await import("../src/payme.js");
const sub = await import("../src/subscription.js");
const { buildOrderSetClause } = await import("../src/pgdb.js");

// Real production bug: pgdb.js#updateOrder ilgari Object.keys(patch)ni TO'G'RIDAN-TO'G'RI
// SQL ustun nomi sifatida ishlatardi. payme.js muvaffaqiyatli to'lovdan keyin
// { status: "paid", paymeId: tx.id } yuborardi — "orders" jadvalida "paymeid" ustuni
// yo'qligi sabab Postgres rejimida bu SO'ROV XATO bilan yiqilardi, ya'ni Payme'dan pul
// haqiqatan yechilgan bo'lsa ham, activate() hech qachon chaqirilmasdi. Endi
// buildOrderSetClause faqat ORDER_COL_MAP'dagi (haqiqiy ustunlarga mos) kalitlarni oladi.
test("buildOrderSetClause: noma'lum maydonlar (masalan eski 'paymeId') xom SQL ustuni sifatida ishlatilmaydi", () => {
  const { setClauses, vals } = buildOrderSetClause({ status: "paid", paymeId: "tx_abc123" });
  assert.strictEqual(setClauses.length, 1, "faqat 'status' ustuni SET qilinishi kerak, paymeId e'tiborsiz qoldirilishi kerak");
  assert.strictEqual(setClauses[0], "status = $1");
  assert.deepStrictEqual(vals, ["paid"]);
  assert.ok(!setClauses.some((c) => /paymeid/i.test(c)), "SQL hech qachon 'paymeid' ustunini o'z ichiga olmasligi kerak");
});

test("buildOrderSetClause: bir nechta haqiqiy ustun to'g'ri indekslanadi", () => {
  const { setClauses, vals, nextIndex } = buildOrderSetClause({ status: "cancelled", days: 30, unknownField: "x" });
  assert.strictEqual(setClauses.length, 2);
  assert.deepStrictEqual(setClauses, ["status = $1", "days = $2"]);
  assert.deepStrictEqual(vals, ["cancelled", 30]);
  assert.strictEqual(nextIndex, 3);
});

async function newUser(email) {
  const res = await register(email, "parol123", "Test Biznes");
  return res.user;
}

// Bu testlar aynan payme.js'dagi "async db.js funksiyalari await'siz chaqirilgan"
// bug'ini ushlab turadi — bug bo'lganida CheckPerformTransaction/CreateTransaction
// har doim Promise obyekti ustida solishtirib, noto'g'ri xato qaytargan bo'lardi.

test("Payme: to'liq muvaffaqiyatli to'lov oqimi obunani faollashtiradi", async () => {
  const user = await newUser("payme-ok@x.uz");
  const order = await createOrder({ userId: user.id, plan: "start", days: 30, amount: 99000 });
  const amountTiyin = Math.round(order.amount * 100);

  const check = await handlePayme({
    method: "CheckPerformTransaction",
    id: 1,
    params: { amount: amountTiyin, account: { order_id: order.id } },
  });
  assert.strictEqual(check.error, undefined, "CheckPerformTransaction xato qaytardi: " + JSON.stringify(check));
  assert.strictEqual(check.result.allow, true);

  const paymeTxId = "tx_" + order.id;
  const create = await handlePayme({
    method: "CreateTransaction",
    id: 2,
    params: { id: paymeTxId, time: Date.now(), amount: amountTiyin, account: { order_id: order.id } },
  });
  assert.strictEqual(create.error, undefined, "CreateTransaction xato qaytardi: " + JSON.stringify(create));
  assert.strictEqual(create.result.state, 1);

  const perform = await handlePayme({
    method: "PerformTransaction",
    id: 3,
    params: { id: paymeTxId },
  });
  assert.strictEqual(perform.error, undefined, "PerformTransaction xato qaytardi: " + JSON.stringify(perform));
  assert.strictEqual(perform.result.state, 2);

  assert.strictEqual(user.subscription.status, "active", "To'lovdan keyin obuna 'active' bo'lishi kerak");
  assert.strictEqual(sub.isActive(user), true);

  const checkTx = await handlePayme({ method: "CheckTransaction", id: 4, params: { id: paymeTxId } });
  assert.strictEqual(checkTx.result.state, 2);
});

test("Payme: bekor qilingan tranzaksiya to'langan obunani ham bekor qiladi", async () => {
  const user = await newUser("payme-cancel@x.uz");
  const order = await createOrder({ userId: user.id, plan: "start", days: 30, amount: 99000 });
  const amountTiyin = Math.round(order.amount * 100);
  const txId = "tx_cancel_" + order.id;

  await handlePayme({
    method: "CreateTransaction",
    id: 1,
    params: { id: txId, time: Date.now(), amount: amountTiyin, account: { order_id: order.id } },
  });
  await handlePayme({ method: "PerformTransaction", id: 2, params: { id: txId } });
  assert.strictEqual(user.subscription.status, "active");

  const cancel = await handlePayme({ method: "CancelTransaction", id: 3, params: { id: txId, reason: 5 } });
  assert.strictEqual(cancel.error, undefined, "CancelTransaction xato qaytardi: " + JSON.stringify(cancel));
  assert.strictEqual(cancel.result.state, -2); // CANCELLED_AFTER

  assert.strictEqual(user.subscription.status, "expired");
  assert.strictEqual(sub.isActive(user), false);
});

test("Payme: noto'g'ri summa bilan CheckPerformTransaction rad etiladi", async () => {
  const user = await newUser("payme-badamount@x.uz");
  const order = await createOrder({ userId: user.id, plan: "start", days: 30, amount: 99000 });

  const check = await handlePayme({
    method: "CheckPerformTransaction",
    id: 1,
    params: { amount: 1, account: { order_id: order.id } },
  });
  assert.ok(check.error, "Noto'g'ri summada xato qaytishi kerak edi");
  assert.strictEqual(check.error.code, -31001);
});

test("Payme: mavjud bo'lmagan buyurtma uchun CheckPerformTransaction rad etiladi", async () => {
  const check = await handlePayme({
    method: "CheckPerformTransaction",
    id: 1,
    params: { amount: 9900000, account: { order_id: "yoq-buyurtma-id" } },
  });
  assert.ok(check.error, "Mavjud bo'lmagan buyurtmada xato qaytishi kerak edi");
  assert.strictEqual(check.error.code, -31050);
});
