/**
 * Payme (Paycom) to'lov integratsiyasi.
 *  - paymeCheckoutUrl(order): foydalanuvchini yo'naltirish uchun to'lov havolasi
 *  - handlePayme(body, authHeader): Merchant API (JSON-RPC) webhook ishlovchisi
 *
 * Sozlash: .env da PAYME_MERCHANT_ID, PAYME_KEY (merchant kaliti).
 * Merchant kabinetda "Endpoint URL" = https://<BASE_URL>/payme
 */
import { CREDIT_PACKS, CREDIT_ORDER_PREFIX, addCredits } from "./credits.js";
import { config } from "./config.js";
import {
  findOrder,
  updateOrder,
  findPaymeTx,
  findPaymeTxByOrder,
  savePaymeTx,
  listPaymeTx,
  findUserById,
} from "./db.js";
import { activate, deactivate } from "./subscription.js";

// Tranzaksiya 12 soat ichida yakunlanishi kerak
const TIMEOUT_MS = 12 * 60 * 60 * 1000;

// Payme holatlari
const STATE = { CREATED: 1, PERFORMED: 2, CANCELLED: -1, CANCELLED_AFTER: -2 };

// Payme xato kodlari
const ERR = {
  AUTH: -32504,
  METHOD: -32601,
  PARSE: -32700,
  AMOUNT: -31001,
  TX_NOT_FOUND: -31003,
  CANT_PERFORM: -31008,
  ORDER_NOT_FOUND: -31050,
  ORDER_STATE: -31099,
};

function msg(ru, uz, en) {
  return { ru, uz, en };
}

function err(id, code, message, data) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, data } };
}
function ok(id, result) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

/** Basic-auth tekshiruvi: parol = merchant kaliti. */
export function checkPaymeAuth(authHeader) {
  if (!config.payme.key) return false;
  const m = /^Basic\s+(.+)$/i.exec(authHeader || "");
  if (!m) return false;
  let decoded = "";
  try {
    decoded = Buffer.from(m[1], "base64").toString("utf8");
  } catch {
    return false;
  }
  const pass = decoded.slice(decoded.indexOf(":") + 1);
  return pass === config.payme.key;
}

/** To'lov havolasi (checkout). order — createOrder natijasi. */
export function paymeCheckoutUrl(order, { lang = "uz", returnUrl = "" } = {}) {
  const host = config.payme.test ? "checkout.test.paycom.uz" : "checkout.paycom.uz";
  const parts = [
    `m=${config.payme.merchantId}`,
    `ac.${config.payme.accountField}=${order.id}`,
    `a=${Math.round(order.amount * 100)}`, // tiyin
    `l=${lang}`,
  ];
  if (returnUrl) parts.push(`c=${returnUrl}`);
  const encoded = Buffer.from(parts.join(";"), "utf8").toString("base64");
  return `https://${host}/${encoded}`;
}

// ==================== Merchant API metodlari ====================

async function getOrderFromAccount(account) {
  const orderId = account?.[config.payme.accountField];
  if (!orderId) return null;
  return await findOrder(String(orderId));
}

async function checkPerform(id, params) {
  const order = await getOrderFromAccount(params.account);
  if (!order || order.status === "cancelled") {
    return err(id, ERR.ORDER_NOT_FOUND, msg("Заказ не найден", "Buyurtma topilmadi", "Order not found"), config.payme.accountField);
  }
  if (order.status === "paid") {
    return err(id, ERR.ORDER_STATE, msg("Заказ уже оплачен", "Buyurtma to'langan", "Order already paid"));
  }
  if (Number(params.amount) !== Math.round(order.amount * 100)) {
    return err(id, ERR.AMOUNT, msg("Неверная сумма", "Summa noto'g'ri", "Invalid amount"));
  }
  return ok(id, { allow: true });
}

async function createTransaction(id, params) {
  const existing = await findPaymeTx(params.id);
  if (existing) {
    if (existing.state !== STATE.CREATED) {
      return err(id, ERR.CANT_PERFORM, msg("Транзакция в неверном состоянии", "Tranzaksiya holati noto'g'ri", "Invalid transaction state"));
    }
    if (Date.now() - existing.create_time > TIMEOUT_MS) {
      existing.state = STATE.CANCELLED;
      existing.cancel_time = Date.now();
      existing.reason = 4;
      await savePaymeTx(existing);
      return err(id, ERR.CANT_PERFORM, msg("Время истекло", "Vaqt tugadi", "Timeout"));
    }
    return ok(id, { create_time: existing.create_time, transaction: existing.transaction, state: STATE.CREATED });
  }

  // Yangi tranzaksiya — avval buyurtmani tekshiramiz
  const check = await checkPerform(id, params);
  if (check.error) return check;

  const order = await getOrderFromAccount(params.account);
  const other = await findPaymeTxByOrder(order.id);
  if (other && other.state === STATE.CREATED) {
    return err(id, ERR.ORDER_STATE, msg("Заказ в обработке", "Buyurtma jarayonda", "Order in process"));
  }

  const tx = {
    id: params.id,
    orderId: order.id,
    transaction: "t_" + order.id,
    amount: Number(params.amount),
    state: STATE.CREATED,
    create_time: Number(params.time) || Date.now(),
    perform_time: 0,
    cancel_time: 0,
    reason: null,
  };
  await savePaymeTx(tx);
  return ok(id, { create_time: tx.create_time, transaction: tx.transaction, state: STATE.CREATED });
}

async function performTransaction(id, params) {
  const tx = await findPaymeTx(params.id);
  if (!tx) return err(id, ERR.TX_NOT_FOUND, msg("Транзакция не найдена", "Tranzaksiya topilmadi", "Transaction not found"));

  if (tx.state === STATE.PERFORMED) {
    return ok(id, { transaction: tx.transaction, perform_time: tx.perform_time, state: STATE.PERFORMED });
  }
  if (tx.state !== STATE.CREATED) {
    return err(id, ERR.CANT_PERFORM, msg("Невозможно выполнить", "Bajarib bo'lmaydi", "Unable to perform"));
  }
  if (Date.now() - tx.create_time > TIMEOUT_MS) {
    tx.state = STATE.CANCELLED;
    tx.cancel_time = Date.now();
    tx.reason = 4;
    await savePaymeTx(tx);
    return err(id, ERR.CANT_PERFORM, msg("Время истекло", "Vaqt tugadi", "Timeout"));
  }

  // To'lov muvaffaqiyatli — obunani faollashtiramiz
  tx.state = STATE.PERFORMED;
  tx.perform_time = Date.now();
  await savePaymeTx(tx);

  const order = await findOrder(tx.orderId);
  if (order && order.status !== "paid") {
    await updateOrder(order.id, { status: "paid" });
    const user = await findUserById(order.userId);
    if (user && String(order.plan || "").startsWith(CREDIT_ORDER_PREFIX)) {
      const pack = CREDIT_PACKS[order.plan.slice(CREDIT_ORDER_PREFIX.length)];
      if (pack) addCredits(user, pack.credits);
    } else if (user) activate(user, order.days, order.plan);
  }
  return ok(id, { transaction: tx.transaction, perform_time: tx.perform_time, state: STATE.PERFORMED });
}

async function cancelTransaction(id, params) {
  const tx = await findPaymeTx(params.id);
  if (!tx) return err(id, ERR.TX_NOT_FOUND, msg("Транзакция не найдена", "Tranzaksiya topilmadi", "Transaction not found"));

  if (tx.state === STATE.CANCELLED || tx.state === STATE.CANCELLED_AFTER) {
    return ok(id, { transaction: tx.transaction, cancel_time: tx.cancel_time, state: tx.state });
  }

  const wasPerformed = tx.state === STATE.PERFORMED;
  tx.state = wasPerformed ? STATE.CANCELLED_AFTER : STATE.CANCELLED;
  tx.cancel_time = Date.now();
  tx.reason = params.reason ?? null;
  await savePaymeTx(tx);

  const order = await findOrder(tx.orderId);
  if (order) {
    await updateOrder(order.id, { status: "cancelled" });
    // To'lov bekor qilinsa (qaytarilsa) — obunani ham to'xtatamiz
    if (wasPerformed) {
      const user = await findUserById(order.userId);
      if (user && String(order.plan || "").startsWith(CREDIT_ORDER_PREFIX)) {
        const pack = CREDIT_PACKS[order.plan.slice(CREDIT_ORDER_PREFIX.length)];
        if (pack) addCredits(user, -pack.credits);
      } else if (user) deactivate(user);
    }
  }
  return ok(id, { transaction: tx.transaction, cancel_time: tx.cancel_time, state: tx.state });
}

async function checkTransaction(id, params) {
  const tx = await findPaymeTx(params.id);
  if (!tx) return err(id, ERR.TX_NOT_FOUND, msg("Транзакция не найдена", "Tranzaksiya topilmadi", "Transaction not found"));
  return ok(id, {
    create_time: tx.create_time,
    perform_time: tx.perform_time || 0,
    cancel_time: tx.cancel_time || 0,
    transaction: tx.transaction,
    state: tx.state,
    reason: tx.reason ?? null,
  });
}

async function getStatement(id, params) {
  const list = await listPaymeTx({ from: params.from, to: params.to });
  const txs = list.map((t) => ({
    id: t.id,
    time: t.create_time,
    amount: t.amount,
    account: { [config.payme.accountField]: t.orderId },
    create_time: t.create_time,
    perform_time: t.perform_time || 0,
    cancel_time: t.cancel_time || 0,
    transaction: t.transaction,
    state: t.state,
    reason: t.reason ?? null,
  }));
  return ok(id, { transactions: txs });
}

/**
 * JSON-RPC so'rovni qayta ishlaydi. Auth tekshiruvi index.js da qilinadi.
 * body: { method, params, id }
 */
export async function handlePayme(body) {
  const { method, params = {}, id } = body || {};
  switch (method) {
    case "CheckPerformTransaction":
      return checkPerform(id, params);
    case "CreateTransaction":
      return createTransaction(id, params);
    case "PerformTransaction":
      return performTransaction(id, params);
    case "CancelTransaction":
      return cancelTransaction(id, params);
    case "CheckTransaction":
      return checkTransaction(id, params);
    case "GetStatement":
      return getStatement(id, params);
    default:
      return err(id, ERR.METHOD, msg("Метод не найден", "Metod topilmadi", "Method not found"));
  }
}
