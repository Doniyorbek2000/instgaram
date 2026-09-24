/**
 * Do'kon to'lovlarini AVTOMATIK tasdiqlash — har bir biznesning o'z kassasi uchun:
 *
 *  Payme Merchant API:  POST /pay/payme/<biznesId>
 *    Kassa kabinetida Endpoint = shu URL, kalit = biznes panelida kiritilgan "Merchant kaliti".
 *    account.<hisob maydoni> = buyurtma raqami (№), summa — tiyinda.
 *  Click SHOP API:      POST /pay/click/<biznesId>   (Prepare va Complete bitta URL)
 *    Imzo: md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id [+ merchant_prepare_id] + amount + action + sign_time)
 *
 * To'lov tasdiqlansa buyurtma "✅ To'landi" bo'ladi va mijozga xabar ketadi (setOrderStatus).
 * Tranzaksiyalar tenant.shop.payments ichida saqlanadi.
 */
import crypto from "node:crypto";
import { Router } from "express";
import { findUserById, persist } from "./db.js";
import { ensureShop, setOrderStatus } from "./shop.js";

export const shopPaymentsRouter = Router();

const TIMEOUT_MS = 12 * 60 * 60 * 1000;
const MAX_TX = 5000;
const STATE = { CREATED: 1, PERFORMED: 2, CANCELLED: -1, CANCELLED_AFTER: -2 };
const msg = (uz, ru, en) => ({ uz, ru, en });
const rpcErr = (id, code, message, data) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } });
const rpcOk = (id, result) => ({ jsonrpc: "2.0", id: id ?? null, result });

function payments(tenant) {
  const shop = ensureShop(tenant);
  shop.payments ||= { payme: {}, click: {} };
  shop.payments.payme ||= {};
  shop.payments.click ||= {};
  return shop.payments;
}

function trim(map) {
  const keys = Object.keys(map);
  if (keys.length > MAX_TX) for (const k of keys.slice(0, keys.length - MAX_TX)) delete map[k];
}

const orderByNum = (tenant, num) => ensureShop(tenant).orders.find((o) => String(o.num) === String(num ?? "")) || null;
const payable = (o) => o && o.status !== "cancelled" && o.status !== "paid" && o.status !== "shipped" && o.status !== "done";

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// ======================= PAYME =======================

export function checkShopPaymeAuth(tenant, authHeader) {
  const key = ensureShop(tenant).settings.payme.key;
  if (!key) return false;
  const m = /^Basic\s+(.+)$/i.exec(authHeader || "");
  if (!m) return false;
  const decoded = Buffer.from(m[1], "base64").toString("utf8");
  return safeEqual(decoded.slice(decoded.indexOf(":") + 1), key);
}

function paymeOrder(tenant, account) {
  const field = ensureShop(tenant).settings.payme.account || "order_id";
  return orderByNum(tenant, account?.[field]);
}

function paymeCheck(tenant, id, params) {
  const field = ensureShop(tenant).settings.payme.account || "order_id";
  const order = paymeOrder(tenant, params.account);
  if (!order || order.status === "cancelled") return rpcErr(id, -31050, msg("Buyurtma topilmadi", "Заказ не найден", "Order not found"), field);
  if (!payable(order)) return rpcErr(id, -31051, msg("Buyurtma allaqachon to'langan", "Заказ уже оплачен", "Order already paid"), field);
  if (Number(params.amount) !== Math.round(order.total * 100)) return rpcErr(id, -31001, msg("Summa noto'g'ri", "Неверная сумма", "Invalid amount"));
  return null;
}

function txView(tx, keys) {
  return Object.fromEntries(keys.map((k) => [k, k === "reason" ? tx.reason ?? null : tx[k] ?? 0]));
}

/** Payme JSON-RPC so'rovini bitta biznes kassasi uchun bajaradi. */
export async function handleShopPayme(tenant, body, now = Date.now()) {
  const { method, params = {}, id } = body || {};
  const store = payments(tenant).payme;
  const expire = (tx) => {
    tx.state = STATE.CANCELLED;
    tx.cancel_time = now;
    tx.reason = 4;
  };

  if (method === "CheckPerformTransaction") {
    const e = paymeCheck(tenant, id, params);
    if (e) return e;
    const order = paymeOrder(tenant, params.account);
    return rpcOk(id, {
      allow: true,
      detail: { receipt_type: 0, items: order.items.map((it) => ({ title: it.name.slice(0, 120), price: it.price * 100, count: it.qty, code: "", package_code: "", vat_percent: 0 })) },
    });
  }

  if (method === "CreateTransaction") {
    const existing = store[params.id];
    if (existing) {
      if (existing.state !== STATE.CREATED) return rpcErr(id, -31008, msg("Tranzaksiya holati noto'g'ri", "Неверное состояние транзакции", "Invalid transaction state"));
      if (now - existing.create_time > TIMEOUT_MS) {
        expire(existing);
        persist(tenant);
        return rpcErr(id, -31008, msg("Vaqt tugadi", "Время истекло", "Timeout"));
      }
      return rpcOk(id, { create_time: existing.create_time, transaction: existing.transaction, state: existing.state });
    }
    const e = paymeCheck(tenant, id, params);
    if (e) return e;
    const order = paymeOrder(tenant, params.account);
    const busy = Object.values(store).find((t) => t.orderId === order.id && t.state === STATE.CREATED && now - t.create_time <= TIMEOUT_MS);
    if (busy) return rpcErr(id, -31099, msg("Buyurtma to'lov jarayonida", "Заказ в процессе оплаты", "Order is being paid"));
    const tx = { id: String(params.id), orderId: order.id, num: order.num, transaction: `s${order.num}_${crypto.randomBytes(3).toString("hex")}`, amount: Number(params.amount), state: STATE.CREATED, time: Number(params.time) || now, create_time: now, perform_time: 0, cancel_time: 0, reason: null };
    store[tx.id] = tx;
    trim(store);
    persist(tenant);
    return rpcOk(id, { create_time: tx.create_time, transaction: tx.transaction, state: tx.state });
  }

  if (method === "PerformTransaction") {
    const tx = store[params.id];
    if (!tx) return rpcErr(id, -31003, msg("Tranzaksiya topilmadi", "Транзакция не найдена", "Transaction not found"));
    if (tx.state === STATE.PERFORMED) return rpcOk(id, { transaction: tx.transaction, perform_time: tx.perform_time, state: tx.state });
    if (tx.state !== STATE.CREATED) return rpcErr(id, -31008, msg("Bajarib bo'lmaydi", "Невозможно выполнить", "Unable to perform"));
    if (now - tx.create_time > TIMEOUT_MS) {
      expire(tx);
      persist(tenant);
      return rpcErr(id, -31008, msg("Vaqt tugadi", "Время истекло", "Timeout"));
    }
    tx.state = STATE.PERFORMED;
    tx.perform_time = now;
    await markPaid(tenant, tx.orderId, "Payme");
    return rpcOk(id, { transaction: tx.transaction, perform_time: tx.perform_time, state: tx.state });
  }

  if (method === "CancelTransaction") {
    const tx = store[params.id];
    if (!tx) return rpcErr(id, -31003, msg("Tranzaksiya topilmadi", "Транзакция не найдена", "Transaction not found"));
    if (tx.state < 0) return rpcOk(id, { transaction: tx.transaction, cancel_time: tx.cancel_time, state: tx.state });
    const wasPerformed = tx.state === STATE.PERFORMED;
    tx.state = wasPerformed ? STATE.CANCELLED_AFTER : STATE.CANCELLED;
    tx.cancel_time = now;
    tx.reason = params.reason ?? null;
    if (wasPerformed) await setOrderStatus(tenant, tx.orderId, "cancelled");
    else persist(tenant);
    return rpcOk(id, { transaction: tx.transaction, cancel_time: tx.cancel_time, state: tx.state });
  }

  if (method === "CheckTransaction") {
    const tx = store[params.id];
    if (!tx) return rpcErr(id, -31003, msg("Tranzaksiya topilmadi", "Транзакция не найдена", "Transaction not found"));
    return rpcOk(id, txView(tx, ["create_time", "perform_time", "cancel_time", "transaction", "state", "reason"]));
  }

  if (method === "GetStatement") {
    const field = ensureShop(tenant).settings.payme.account || "order_id";
    const from = Number(params.from) || 0;
    const to = Number(params.to) || now;
    const transactions = Object.values(store)
      .filter((t) => t.create_time >= from && t.create_time <= to)
      .map((t) => ({ id: t.id, time: t.time, amount: t.amount, account: { [field]: String(t.num) }, ...txView(t, ["create_time", "perform_time", "cancel_time", "transaction", "state", "reason"]) }));
    return rpcOk(id, { transactions });
  }

  return rpcErr(id, -32601, msg("Metod topilmadi", "Метод не найден", "Method not found"));
}

async function markPaid(tenant, orderId, provider) {
  const shop = ensureShop(tenant);
  const order = shop.orders.find((o) => o.id === orderId);
  if (!order) return;
  order.paidVia = provider;
  order.paidAt = new Date().toISOString();
  if (order.status !== "paid") await setOrderStatus(tenant, orderId, "paid");
  else persist(tenant);
}

// ======================= CLICK =======================

const CLICK = {
  OK: [0, "Success"],
  SIGN: [-1, "SIGN CHECK FAILED!"],
  AMOUNT: [-2, "Incorrect parameter amount"],
  ACTION: [-3, "Action not found"],
  PAID: [-4, "Already paid"],
  ORDER: [-5, "Order not found"],
  TX: [-6, "Transaction does not exist"],
  REQUEST: [-8, "Error in request from click"],
  CANCELLED: [-9, "Transaction cancelled"],
};

export function clickSign(p, secret, action) {
  const parts = [p.click_trans_id, p.service_id, secret, p.merchant_trans_id];
  if (Number(action) === 1) parts.push(p.merchant_prepare_id);
  parts.push(p.amount, p.action, p.sign_time);
  return crypto.createHash("md5").update(parts.map((x) => String(x ?? "")).join("")).digest("hex");
}

/** Click Prepare (action=0) / Complete (action=1). Qaytaradi: Click kutgan JSON. */
export async function handleShopClick(tenant, p = {}) {
  const st = ensureShop(tenant).settings.click;
  const store = payments(tenant).click;
  const action = Number(p.action);
  const base = { click_trans_id: p.click_trans_id, merchant_trans_id: p.merchant_trans_id };
  const reply = ([code, note], extra = {}) => ({ ...base, ...extra, error: code, error_note: note });

  if (!st.secretKey || String(p.service_id) !== String(st.serviceId)) return reply(CLICK.REQUEST);
  if (![0, 1].includes(action)) return reply(CLICK.ACTION);
  if (!p.sign_string || !safeEqual(String(p.sign_string).toLowerCase(), clickSign(p, st.secretKey, action))) return reply(CLICK.SIGN);

  const order = orderByNum(tenant, p.merchant_trans_id);
  if (!order) return reply(CLICK.ORDER);
  if (Math.abs(Number(p.amount) - order.total) > 0.01) return reply(CLICK.AMOUNT);

  if (action === 0) {
    if (!payable(order)) return reply(order.status === "cancelled" ? CLICK.CANCELLED : CLICK.PAID);
    const prepareId = Date.now() * 10 + Math.floor(Math.random() * 10);
    store[String(p.click_trans_id)] = { orderId: order.id, num: order.num, prepareId, amount: Number(p.amount), state: "prepared", at: Date.now() };
    trim(store);
    persist(tenant);
    return reply(CLICK.OK, { merchant_prepare_id: prepareId });
  }

  const tx = store[String(p.click_trans_id)];
  if (!tx || String(tx.prepareId) !== String(p.merchant_prepare_id) || tx.orderId !== order.id) return reply(CLICK.TX);
  if (tx.state === "paid") return reply(CLICK.PAID, { merchant_confirm_id: tx.prepareId });
  if (tx.state === "cancelled") return reply(CLICK.CANCELLED);
  if (Number(p.error) < 0) {
    // Click tomonida to'lov amalga oshmadi — tranzaksiya bekor, buyurtma kutishda qoladi
    tx.state = "cancelled";
    persist(tenant);
    return reply(CLICK.CANCELLED);
  }
  if (!payable(order)) return reply(order.status === "cancelled" ? CLICK.CANCELLED : CLICK.PAID);
  tx.state = "paid";
  tx.paidAt = Date.now();
  await markPaid(tenant, order.id, "Click");
  return reply(CLICK.OK, { merchant_confirm_id: tx.prepareId });
}

// ======================= HTTP =======================

shopPaymentsRouter.post("/pay/payme/:tenantId", async (req, res) => {
  const tenant = await findUserById(String(req.params.tenantId));
  const id = req.body?.id ?? null;
  if (!tenant || !checkShopPaymeAuth(tenant, req.get("authorization"))) {
    return res.json(rpcErr(id, -32504, msg("Ruxsat yo'q", "Недостаточно привилегий", "Insufficient privileges")));
  }
  try {
    const result = await handleShopPayme(tenant, req.body);
    console.log(`[Do'kon Payme] ${tenant.businessName}: ${req.body?.method}${result.error ? ` | XATO ${result.error.code}` : " | OK"}`);
    res.json(result);
  } catch (err) {
    console.error("[Do'kon Payme] xato:", err);
    res.json(rpcErr(id, -32400, msg("Tizim xatosi", "Системная ошибка", "System error")));
  }
});

shopPaymentsRouter.post("/pay/click/:tenantId", async (req, res) => {
  const tenant = await findUserById(String(req.params.tenantId));
  const p = req.body || {};
  if (!tenant) return res.json({ click_trans_id: p.click_trans_id, merchant_trans_id: p.merchant_trans_id, error: -5, error_note: "Order not found" });
  try {
    const result = await handleShopClick(tenant, p);
    console.log(`[Do'kon Click] ${tenant.businessName}: action=${p.action} buyurtma=${p.merchant_trans_id} | ${result.error}`);
    res.json(result);
  } catch (err) {
    console.error("[Do'kon Click] xato:", err);
    res.json({ click_trans_id: p.click_trans_id, merchant_trans_id: p.merchant_trans_id, error: -8, error_note: "Error in request from click" });
  }
});
