/**
 * Do'kon: mahsulot katalogi, chatdagi buyurtmalar va to'lov havolalari.
 *
 *  - Katalog chatda karusel bo'lib chiqadi (flow'dagi "🛍️ Katalog" bloki yoki AI biladi)
 *  - "🛒 Buyurtma" bosilsa — buyurtma yaratiladi, mijozga Payme / Click to'lov havolasi,
 *    egasiga Telegram bildirishnoma, CRM'ga bitim (sozlangan bo'lsa)
 *  - To'lanmagan buyurtma (tashlab ketilgan savat) — N daqiqadan so'ng bitta eslatma
 *  - Buyurtma holati o'zgarsa (to'landi / yo'lga chiqdi / yetkazildi) — mijozga xabar
 *
 * To'lov: biznesning O'Z Payme / Click kassasi. Havola Payme/Click'ning ochiq checkout
 * formatida tuziladi; to'lov tasdig'i kassa kabinetida ko'rinadi va buyurtma panelda
 * "To'landi" deb belgilanadi (Payme/Click merchant API ulanmaguncha avtomatik emas).
 *
 * tenant.shop = { settings, products: [...], orders: [...], seq }
 */
import crypto from "node:crypto";
import { listUsers, persist } from "./db.js";
import { sendReply, sendCarousel, splitKey } from "./outbound.js";
import { windowStatus, setFields, addTags, getContactMeta } from "./contacts.js";
import { absoluteMediaUrl } from "./mediaStore.js";

export const ORDER_STATUSES = {
  new: "🆕 Yangi",
  awaiting_payment: "⏳ To'lov kutilmoqda",
  paid: "✅ To'landi",
  shipped: "🚚 Yo'lda",
  done: "📦 Yetkazildi",
  cancelled: "❌ Bekor qilindi",
};

const STATUS_MESSAGES = {
  paid: "✅ To'lov qabul qilindi! Buyurtma №{num} tayyorlanmoqda. Rahmat, {name|do'stim}!",
  shipped: "🚚 Buyurtma №{num} yo'lga chiqdi. Tez orada yetib boradi!",
  done: "📦 Buyurtma №{num} yetkazildi. Xaridingiz uchun rahmat! Fikringizni yozib qoldirsangiz xursand bo'lamiz 🙏",
  cancelled: "Buyurtma №{num} bekor qilindi. Savollar bo'lsa, shu yerga yozing.",
};

const MAX_PRODUCTS = 300;
const MAX_ORDERS = 3000;

export function ensureShop(tenant) {
  const s = (tenant.shop && typeof tenant.shop === "object" ? tenant.shop : (tenant.shop = {}));
  s.settings = {
    currency: "so'm",
    cartReminderMin: 60,
    cartReminderText: "{name|Do'stim}, buyurtmangiz №{num} to'lovni kutyapti 🛒 Hali ham kerak bo'lsa, shu yerdan to'lashingiz mumkin 👇",
    payme: { merchantId: "", account: "order_id" },
    click: { serviceId: "", merchantId: "" },
    notifyOwner: true,
    ...(s.settings || {}),
  };
  s.settings.payme = { merchantId: "", account: "order_id", ...(s.settings.payme || {}) };
  s.settings.click = { serviceId: "", merchantId: "", ...(s.settings.click || {}) };
  if (!Array.isArray(s.products)) s.products = [];
  if (!Array.isArray(s.orders)) s.orders = [];
  s.seq ||= 1000;
  return s;
}

const money = (tenant, n) => `${String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ${ensureShop(tenant).settings.currency}`;
export const formatMoney = money;

export function sanitizeProduct(input = {}, existing = {}) {
  const url = String(input.url || "").trim();
  const image = String(input.image || "").trim();
  return {
    id: existing.id || `p_${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`,
    name: String(input.name || "").trim().slice(0, 80),
    price: Math.max(0, Math.round(Number(String(input.price || 0).replace(/\s/g, "")) || 0)),
    oldPrice: Math.max(0, Math.round(Number(String(input.oldPrice || 0).replace(/\s/g, "")) || 0)),
    description: String(input.description || "").trim().slice(0, 500),
    image: /^https?:\/\/\S+$/i.test(image) || image.startsWith("/u/") ? image.slice(0, 1000) : "",
    url: /^https?:\/\/\S+$/i.test(url) ? url.slice(0, 1000) : "",
    category: String(input.category || "").trim().slice(0, 40),
    active: input.active === undefined ? existing.active ?? true : input.active === true || input.active === "on",
    createdAt: existing.createdAt || new Date().toISOString(),
  };
}

export const activeProducts = (tenant) => ensureShop(tenant).products.filter((p) => p.active && p.name);
export const findProduct = (tenant, id) => ensureShop(tenant).products.find((p) => p.id === id) || null;
export const findOrder = (tenant, id) => ensureShop(tenant).orders.find((o) => o.id === id || String(o.num) === String(id)) || null;

/** AI tizim ko'rsatmasiga katalog (AI narxlarni shu yerdan biladi). */
export function shopPrompt(tenant) {
  const list = activeProducts(tenant).slice(0, 60);
  if (!list.length) return "";
  const lines = list.map((p) => `- ${p.name}: ${money(tenant, p.price)}${p.oldPrice > p.price ? ` (avval ${money(tenant, p.oldPrice)})` : ""}${p.description ? ` — ${p.description.slice(0, 140)}` : ""}`);
  return `\n\n# MAHSULOTLAR KATALOGI (narxlar aniq — faqat shularni ayt)\n${lines.join("\n")}\nMijoz buyurtma bermoqchi bo'lsa, "katalog" yoki mahsulot nomini yozishini, yoki kerakli mahsulot va miqdorni aytishini so'ra.`;
}

/** Biznesning Payme / Click kassasi uchun to'lov havolalari. */
export function paymentLinks(tenant, order) {
  const { settings } = ensureShop(tenant);
  const out = [];
  const amount = Math.round(Number(order.total) || 0);
  if (!amount) return out;
  if (/^[a-f0-9]{24}$/i.test(settings.payme.merchantId)) {
    const account = /^[a-z_]{1,30}$/i.test(settings.payme.account) ? settings.payme.account : "order_id";
    const params = `m=${settings.payme.merchantId};ac.${account}=${order.num};a=${amount * 100}`;
    out.push({ title: "💳 Payme", url: `https://checkout.paycom.uz/${Buffer.from(params).toString("base64")}` });
  }
  if (/^\d{1,12}$/.test(settings.click.serviceId) && /^\d{1,12}$/.test(settings.click.merchantId)) {
    const q = new URLSearchParams({ service_id: settings.click.serviceId, merchant_id: settings.click.merchantId, amount: String(amount), transaction_param: String(order.num) });
    out.push({ title: "💳 Click", url: `https://my.click.uz/services/pay?${q}` });
  }
  return out;
}

/** Buyurtma yaratadi (chat, flow "to'lov havolasi" amali yoki panel). */
export function createOrder(tenant, key, items, { source = "chat", note = "" } = {}) {
  const shop = ensureShop(tenant);
  const clean = (items || [])
    .map((it) => ({ productId: it.productId || "", name: String(it.name || "").slice(0, 120), price: Math.max(0, Math.round(Number(it.price) || 0)), qty: Math.max(1, Math.min(999, Math.round(Number(it.qty) || 1))) }))
    .filter((it) => it.name);
  if (!clean.length) return null;
  const total = clean.reduce((s, it) => s + it.price * it.qty, 0);
  shop.seq += 1;
  const f = key ? getContactMeta(tenant, key).fields : {};
  const order = {
    id: `o_${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`,
    num: shop.seq,
    key,
    items: clean,
    total,
    status: total > 0 && paymentLinks(tenant, { total, num: shop.seq }).length ? "awaiting_payment" : "new",
    customer: { name: f.name || "", phone: f.phone || "", address: f.address || "" },
    note: String(note || "").slice(0, 500),
    source,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  shop.orders.unshift(order);
  if (shop.orders.length > MAX_ORDERS) shop.orders.length = MAX_ORDERS;
  if (key) {
    setFields(tenant, key, { last_order: String(order.num), last_order_total: String(total) });
    addTags(tenant, key, ["buyurtma"]);
  }
  persist(tenant);
  onOrderCreated(tenant, order);
  return order;
}

function orderSummary(tenant, order) {
  const lines = order.items.map((it) => `• ${it.name}${it.qty > 1 ? ` × ${it.qty}` : ""} — ${money(tenant, it.price * it.qty)}`);
  return `🧾 Buyurtma №${order.num}\n${lines.join("\n")}\nJami: ${money(tenant, order.total)}`;
}

function onOrderCreated(tenant, order) {
  import("./integrations.js").then(({ fireEvent }) =>
    fireEvent(tenant, "order_created", { order: order.num, contact: order.key, total: order.total, items: order.items.map((i) => `${i.name} x${i.qty}`).join(", "), ...order.customer })
  ).catch(() => {});
  import("./crm.js").then(({ autoPushCrm }) =>
    autoPushCrm(tenant, "orders", {
      key: order.key, title: `Buyurtma №${order.num}`, price: order.total, name: order.customer.name, phone: order.customer.phone,
      note: order.items.map((i) => `${i.name} × ${i.qty} = ${i.price * i.qty}`).join("\n"), tags: ["buyurtma"],
    })
  ).catch(() => {});
  import("./push.js").then(({ notifyPush }) =>
    notifyPush(tenant, { title: `🛒 Yangi buyurtma №${order.num}`, body: `${order.items.map((i) => i.name).join(", ").slice(0, 120)} — ${money(tenant, order.total)}`, url: "/shop/orders", tag: `order-${order.num}` })
  ).catch(() => {});
  const chatId = tenant.settings?.telegramChatId;
  if (chatId && ensureShop(tenant).settings.notifyOwner) {
    import("./notify.js").then(({ sendTelegram }) =>
      sendTelegram(chatId, `🛒 <b>Yangi buyurtma №${order.num}</b>\n\n${orderSummary(tenant, order).split("\n").slice(1).join("\n").replace(/[<>&]/g, "")}\n\n👤 ${order.customer.name || order.key} ${order.customer.phone || ""}`)
    ).catch(() => {});
  }
}

/** Mijozga buyurtma xabari (xulosa + to'lov havolalari). */
export function orderMessage(tenant, order) {
  const links = paymentLinks(tenant, order);
  const text = `${orderSummary(tenant, order)}\n\n${links.length ? "To'lash uchun tugmani bosing 👇" : "✅ Qabul qilindi! Menejerimiz tez orada bog'lanadi."}`;
  return { text, options: links };
}

/** Buyurtma holatini o'zgartiradi, mijozga xabar yuboradi (so'ralgan bo'lsa). */
export async function setOrderStatus(tenant, orderId, status, { notify = true, send = sendReply } = {}) {
  const order = findOrder(tenant, orderId);
  if (!order || !ORDER_STATUSES[status]) return { ok: false };
  const prev = order.status;
  order.status = status;
  order.updatedAt = new Date().toISOString();
  (order.history ||= []).push({ at: order.updatedAt, from: prev, to: status });
  persist(tenant);
  import("./integrations.js").then(({ fireEvent }) => fireEvent(tenant, "order_status", { order: order.num, contact: order.key, status, total: order.total })).catch(() => {});
  let delivered = null;
  if (notify && order.key && STATUS_MESSAGES[status] && prev !== status) {
    const { renderTemplate } = await import("./templating.js");
    const { chan, id } = splitKey(order.key);
    const text = renderTemplate(STATUS_MESSAGES[status], tenant, order.key, { num: String(order.num) });
    delivered = windowStatus(tenant, order.key).open ? Boolean(await send(tenant, chan, id, text, [])) : false;
  }
  return { ok: true, delivered };
}

/** Chatdagi tugmalar: SHOP:CATALOG, SHOP:BUY:<productId>. Qaytaradi: { reply, options } | null */
export async function handleShopPayload(tenant, key, payload, { deliverCatalog = sendCatalog } = {}) {
  if (!String(payload || "").startsWith("SHOP:")) return null;
  const [, cmd, arg] = payload.split(":");
  if (cmd === "CATALOG") {
    await deliverCatalog(tenant, key, []);
    return { reply: null };
  }
  if (cmd === "BUY") {
    const p = findProduct(tenant, arg);
    if (!p || !p.active) return { reply: "Kechirasiz, bu mahsulot hozir mavjud emas 🙏", options: [{ title: "🛍️ Katalog", payload: "SHOP:CATALOG" }] };
    const order = createOrder(tenant, key, [{ productId: p.id, name: p.name, price: p.price, qty: 1 }], { source: "chat" });
    const msg = orderMessage(tenant, order);
    return { reply: msg.text, options: [...msg.options, { title: "🛍️ Yana tanlash", payload: "SHOP:CATALOG" }] };
  }
  return null;
}

/** Katalogni mijozga karusel qilib yuboradi. productIds bo'sh — barcha faol mahsulotlar (10 tagacha). */
export async function sendCatalog(tenant, key, productIds = [], { send } = {}) {
  const ids = (productIds || []).filter(Boolean);
  const list = (ids.length ? ids.map((id) => findProduct(tenant, id)).filter((p) => p?.active) : activeProducts(tenant)).slice(0, 10);
  if (!list.length) return false;
  const items = list.map((p) => ({
    title: p.name,
    subtitle: `${money(tenant, p.price)}${p.description ? ` · ${p.description.slice(0, 50)}` : ""}`,
    image: p.image ? absoluteMediaUrl(p.image) : "",
    buttons: [{ title: "🛒 Buyurtma", payload: `SHOP:BUY:${p.id}` }, ...(p.url ? [{ title: "Batafsil", url: p.url }] : [])],
  }));
  if (send) return send({ key, carousel: items });
  const { chan, id } = splitKey(key);
  const ok = await sendCarousel(tenant, chan, id, items);
  const { rememberOptions } = await import("./automation.js");
  rememberOptions(tenant, key, list.map((p) => ({ title: p.name, payload: `SHOP:BUY:${p.id}` })));
  return ok;
}

/** Tashlab ketilgan savat: to'lanmagan buyurtmaga bitta eslatma (24 soatlik oyna ochiq bo'lsa). */
export async function runTenantCartReminders(tenant, now = Date.now(), { send = sendReply } = {}) {
  const shop = ensureShop(tenant);
  const delay = Math.max(0, Number(shop.settings.cartReminderMin) || 0) * 60000;
  if (!delay) return 0;
  let sent = 0;
  for (const o of shop.orders) {
    if (o.status !== "awaiting_payment" || o.reminderAt || !o.key) continue;
    const age = now - Date.parse(o.createdAt);
    if (age < delay || age > 23 * 3600000) continue;
    o.reminderAt = new Date(now).toISOString();
    if (!windowStatus(tenant, o.key, now).open || tenant.contactMeta?.[o.key]?.optOut) continue;
    const { renderTemplate } = await import("./templating.js");
    const { chan, id } = splitKey(o.key);
    const ok = await send(tenant, chan, id, renderTemplate(shop.settings.cartReminderText, tenant, o.key, { num: String(o.num) }), paymentLinks(tenant, o));
    if (ok) sent++;
  }
  if (sent || shop.orders.some((o) => o.reminderAt && Date.parse(o.reminderAt) === now)) persist(tenant);
  return sent;
}

let running = false;
export async function runDueShop() {
  if (running) return 0;
  running = true;
  let total = 0;
  try {
    for (const tenant of await listUsers()) {
      if (!tenant.shop?.orders?.some((o) => o.status === "awaiting_payment" && !o.reminderAt)) continue;
      total += await runTenantCartReminders(tenant);
    }
  } finally {
    running = false;
  }
  return total;
}
