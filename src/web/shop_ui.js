/**
 * Do'kon va buyurtmalar (/shop): buyurtmalar ro'yxati va holati, mahsulot katalogi,
 * Payme / Click kassasi va tashlab ketilgan savat eslatmasi sozlamalari.
 */
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { persist } from "../db.js";
import { ensureShop, sanitizeProduct, findProduct, findOrder, setOrderStatus, ORDER_STATUSES, formatMoney, paymentLinks } from "../shop.js";
import { displayName } from "../contacts.js";

export const shopRouter = Router();

const tabs = (active) => `<div style="display:flex; gap:6px; margin-bottom:16px; flex-wrap:wrap">
  ${[["orders", "🧾 Buyurtmalar"], ["products", "🛍️ Mahsulotlar"], ["settings", "💳 To'lov va sozlamalar"]]
    .map(([k, l]) => `<a class="btn ${k === active ? "" : "secondary"}" href="/shop${k === "orders" ? "" : `?tab=${k}`}" style="margin:0">${l}</a>`).join("")}
</div>`;

const statusColor = { new: "#38bdf8", awaiting_payment: "#fbbf24", paid: "#34d399", shipped: "#a78bfa", done: "#10b981", cancelled: "#f87171" };

shopRouter.get(["/shop", "/shop/orders"], requireAuth, (req, res) => {
  const u = req.user;
  const shop = ensureShop(u);
  const tab = ["products", "settings"].includes(req.query.tab) ? req.query.tab : "orders";
  const flash = req.query.saved ? `<div class="ok">Saqlandi ✅</div>` : req.query.msg ? `<div class="ok">${esc(req.query.msg)}</div>` : req.query.error ? `<div class="error">${esc(req.query.error)}</div>` : "";
  let body = "";

  if (tab === "orders") {
    const filter = ORDER_STATUSES[req.query.status] ? req.query.status : "";
    const list = shop.orders.filter((o) => !filter || o.status === filter).slice(0, 200);
    const paidSum = shop.orders.filter((o) => ["paid", "shipped", "done"].includes(o.status)).reduce((s, o) => s + o.total, 0);
    const counts = Object.fromEntries(Object.keys(ORDER_STATUSES).map((k) => [k, shop.orders.filter((o) => o.status === k).length]));
    body = `
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin-bottom:14px">
        <div class="card" style="margin:0"><span class="hint">Jami buyurtmalar</span><div style="font-size:24px; font-weight:800">${shop.orders.length}</div></div>
        <div class="card" style="margin:0"><span class="hint">To'lov kutilmoqda</span><div style="font-size:24px; font-weight:800; color:#fbbf24">${counts.awaiting_payment}</div></div>
        <div class="card" style="margin:0"><span class="hint">To'langan summa</span><div style="font-size:24px; font-weight:800; color:#34d399">${esc(formatMoney(u, paidSum))}</div></div>
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px">
        <a class="status-tag" href="/shop" style="${filter ? "" : "border-color:#a78bfa; color:#fff"}">Barchasi</a>
        ${Object.entries(ORDER_STATUSES).map(([k, l]) => `<a class="status-tag" href="/shop?status=${k}" style="${filter === k ? "border-color:#a78bfa; color:#fff" : ""}">${l} · ${counts[k]}</a>`).join("")}
      </div>
      ${list.length ? list.map((o) => `<div class="card" style="border-left:4px solid ${statusColor[o.status]}">
          <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap">
            <div style="min-width:0">
              <b style="font-size:16px">№${o.num}</b> · <span class="hint">${esc(new Date(o.createdAt).toLocaleString("uz-UZ", { timeZone: u.settings?.timezone || "Asia/Tashkent" }).slice(0, 17))}</span>
              ${o.key ? ` · <a href="/clients/c/${encodeURIComponent(o.key)}">${esc(displayName(u, o.key))}</a>` : ""} ${o.customer?.phone ? `· ${esc(o.customer.phone)}` : ""}
              <div style="margin-top:6px; font-size:13.5px">${o.items.map((i) => `${esc(i.name)}${i.qty > 1 ? ` × ${i.qty}` : ""}`).join(", ")}</div>
              <div style="margin-top:4px; font-weight:800">${esc(formatMoney(u, o.total))} ${o.reminderAt ? `<span class="hint" style="font-weight:400">· eslatma yuborildi</span>` : ""}</div>
            </div>
            <form method="post" action="/shop/orders/${esc(o.id)}/status" style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin:0">
              <select name="status" style="margin:0; width:auto">${Object.entries(ORDER_STATUSES).map(([k, l]) => `<option value="${k}" ${o.status === k ? "selected" : ""}>${l}</option>`).join("")}</select>
              <label style="display:flex; gap:4px; align-items:center; margin:0; text-transform:none; letter-spacing:0; font-size:12.5px"><input type="checkbox" name="notify" checked style="width:auto; margin:0"> mijozga xabar</label>
              <button class="secondary" style="margin:0">Saqlash</button>
            </form>
          </div>
        </div>`).join("") : `<div class="card" style="text-align:center; padding:36px"><div style="font-size:36px">🧾</div><h3>Buyurtma yo'q</h3><p class="hint">Mahsulot qo'shing va flow'ga "🛍️ Katalog" blokini qo'ying, yoki mijoz chatda "katalog" deb yozadi.</p></div>`}`;
  }

  if (tab === "products") {
    const edit = req.query.edit ? findProduct(u, req.query.edit) : null;
    const p = edit || {};
    body = `
      <div class="grid split-form">
        <div>
          ${shop.products.length ? shop.products.map((x) => `<div class="card" style="display:flex; gap:12px; align-items:center; ${x.active ? "" : "opacity:.55"}">
              ${x.image ? `<img src="${esc(x.image)}" alt="" style="width:56px; height:56px; object-fit:cover; border-radius:10px; flex:none" referrerpolicy="no-referrer">` : `<div style="width:56px; height:56px; border-radius:10px; background:#1e293b; display:grid; place-items:center; font-size:22px; flex:none">🛍️</div>`}
              <div style="flex:1; min-width:0">
                <b>${esc(x.name)}</b> ${x.active ? "" : `<span class="hint">(yashirin)</span>`}
                <div style="font-size:13.5px"><b style="color:#34d399">${esc(formatMoney(u, x.price))}</b> ${x.oldPrice > x.price ? `<s class="hint">${esc(formatMoney(u, x.oldPrice))}</s>` : ""}</div>
                ${x.description ? `<div class="hint" style="font-size:12.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${esc(x.description)}</div>` : ""}
              </div>
              <a class="btn secondary" href="/shop?tab=products&edit=${esc(x.id)}" style="margin:0; padding:6px 12px">✏️</a>
              <form method="post" action="/shop/products/${esc(x.id)}/delete" style="margin:0" onsubmit="return confirm('Mahsulot o\\'chirilsinmi?')"><button class="secondary" style="margin:0; padding:6px 10px; color:#f87171">🗑️</button></form>
            </div>`).join("") : `<div class="card" style="text-align:center; padding:30px"><h3 style="margin-top:0">Katalog bo'sh</h3><p class="hint">O'ngdagi forma orqali birinchi mahsulotni qo'shing.</p></div>`}
        </div>
        <div>
          <form method="post" action="/shop/products${edit ? `/${esc(p.id)}` : ""}" class="card">
            <h3 style="margin-top:0">${edit ? "✏️ Mahsulotni tahrirlash" : "+ Yangi mahsulot"}</h3>
            <label>Nomi</label><input name="name" value="${esc(p.name || "")}" maxlength="80" required>
            <div style="display:flex; gap:10px">
              <div style="flex:1"><label>Narxi (${esc(shop.settings.currency)})</label><input name="price" inputmode="numeric" value="${esc(p.price ?? "")}" required></div>
              <div style="flex:1"><label>Eski narx (ixtiyoriy)</label><input name="oldPrice" inputmode="numeric" value="${esc(p.oldPrice || "")}"></div>
            </div>
            <label>Tavsif</label><textarea name="description" rows="3" maxlength="500">${esc(p.description || "")}</textarea>
            <label>Rasm havolasi (https://… yoki Media kutubxonadagi /u/…)</label><input name="image" value="${esc(p.image || "")}" placeholder="https://...">
            <label>Batafsil havola (ixtiyoriy)</label><input name="url" value="${esc(p.url || "")}" placeholder="https://...">
            <label>Kategoriya</label><input name="category" value="${esc(p.category || "")}" maxlength="40">
            <label style="display:flex; gap:8px; align-items:center; margin-top:10px; text-transform:none; letter-spacing:0; font-size:14px"><input type="checkbox" name="active" ${p.active === false ? "" : "checked"} style="width:auto; margin:0"> Katalogda ko'rinsin</label>
            <button class="btn" style="width:100%; margin-top:12px">💾 Saqlash</button>
            ${edit ? `<a href="/shop?tab=products" class="hint" style="display:block; text-align:center; margin-top:8px">Bekor qilish</a>` : ""}
          </form>
          <p class="hint" style="font-size:12.5px">AI katalogdagi narxlarni biladi. Mijoz "katalog" deb yozsa — kartochkalar chiqadi, "🛒 Buyurtma" bosilsa buyurtma va to'lov havolasi yuboriladi.</p>
        </div>
      </div>`;
  }

  if (tab === "settings") {
    const st = shop.settings;
    const demo = paymentLinks(u, { total: 1000, num: 1 });
    body = `<form method="post" action="/shop/settings" class="grid split-form">
      <div>
        <div class="card">
          <h3 style="margin-top:0">💳 Payme kassasi</h3>
          <label>Merchant ID (Payme Business → Kassa → ID)</label><input name="paymeMerchant" value="${esc(st.payme.merchantId)}" placeholder="24 belgili ID" maxlength="24">
          <label>Hisob maydoni (kassa sozlamasidagi account nomi)</label><input name="paymeAccount" value="${esc(st.payme.account)}" placeholder="order_id">
        </div>
        <div class="card">
          <h3 style="margin-top:0">💳 Click kassasi</h3>
          <div style="display:flex; gap:10px">
            <div style="flex:1"><label>Service ID</label><input name="clickService" value="${esc(st.click.serviceId)}" inputmode="numeric"></div>
            <div style="flex:1"><label>Merchant ID</label><input name="clickMerchant" value="${esc(st.click.merchantId)}" inputmode="numeric"></div>
          </div>
        </div>
        <p class="hint" style="font-size:12.5px">Mijozga sizning kassangizga to'g'ridan-to'g'ri to'lov havolasi yuboriladi (pul sizning hisobingizga tushadi). To'lov tasdig'ini Payme/Click kabinetida ko'rib, buyurtmani "✅ To'landi" deb belgilang — mijozga avtomatik xabar ketadi. ${demo.length ? `<br>Ulangan: ${demo.map((d) => esc(d.title)).join(", ")} ✓` : ""}</p>
      </div>
      <div>
        <div class="card">
          <h3 style="margin-top:0">🛒 Tashlab ketilgan savat</h3>
          <label>To'lanmagan buyurtmaga eslatma (necha daqiqadan keyin, 0 — o'chiq)</label>
          <input name="cartReminderMin" type="number" min="0" max="1380" value="${esc(st.cartReminderMin)}">
          <label>Eslatma matni</label>
          <textarea name="cartReminderText" rows="3" maxlength="1000">${esc(st.cartReminderText)}</textarea>
          <p class="hint" style="font-size:12px">Bir marta, 24 soatlik oyna ochiq bo'lsa yuboriladi. {num} — buyurtma raqami.</p>
        </div>
        <div class="card">
          <h3 style="margin-top:0">⚙️ Umumiy</h3>
          <label>Valyuta belgisi</label><input name="currency" value="${esc(st.currency)}" maxlength="10">
          <label style="display:flex; gap:8px; align-items:center; margin-top:10px; text-transform:none; letter-spacing:0; font-size:14px"><input type="checkbox" name="notifyOwner" ${st.notifyOwner ? "checked" : ""} style="width:auto; margin:0"> Yangi buyurtma haqida Telegram'da xabar berilsin</label>
        </div>
        <button class="btn" style="width:100%">💾 Saqlash</button>
      </div>
    </form>`;
  }

  res.send(page("Do'kon va buyurtmalar", `${flash}${tabs(tab)}${body}`, { user: u, active: "shop" }));
});

shopRouter.post(["/shop/products", "/shop/products/:id"], requireAuth, (req, res) => {
  const shop = ensureShop(req.user);
  const existing = req.params.id ? findProduct(req.user, req.params.id) : null;
  const p = sanitizeProduct({ ...req.body, active: req.body?.active === "on" }, existing || {});
  if (!p.name) return res.redirect(`/shop?tab=products&error=${encodeURIComponent("Mahsulot nomini kiriting")}`);
  if (existing) shop.products[shop.products.indexOf(existing)] = p;
  else if (shop.products.length >= 300) return res.redirect(`/shop?tab=products&error=${encodeURIComponent("Katalogda 300 tagacha mahsulot bo'lishi mumkin")}`);
  else shop.products.unshift(p);
  persist(req.user);
  res.redirect("/shop?tab=products&saved=1");
});

shopRouter.post("/shop/products/:id/delete", requireAuth, (req, res) => {
  const shop = ensureShop(req.user);
  shop.products = shop.products.filter((p) => p.id !== req.params.id);
  persist(req.user);
  res.redirect("/shop?tab=products");
});

shopRouter.post("/shop/orders/:id/status", requireAuth, async (req, res) => {
  const order = findOrder(req.user, req.params.id);
  if (!order) return res.redirect("/shop");
  const r = await setOrderStatus(req.user, order.id, String(req.body?.status || ""), { notify: req.body?.notify === "on" });
  const msg = r.delivered === false ? "Holat saqlandi. Mijozga xabar yetmadi (24 soatlik oyna yopiq)" : "Holat saqlandi ✅";
  res.redirect(`/shop?msg=${encodeURIComponent(msg)}`);
});

shopRouter.post("/shop/settings", requireAuth, (req, res) => {
  const st = ensureShop(req.user).settings;
  const b = req.body || {};
  const errors = [];
  const pm = String(b.paymeMerchant || "").trim();
  if (pm && !/^[a-f0-9]{24}$/i.test(pm)) errors.push("Payme Merchant ID 24 belgili bo'lishi kerak");
  else st.payme.merchantId = pm;
  st.payme.account = /^[a-z_]{1,30}$/i.test(String(b.paymeAccount || "")) ? String(b.paymeAccount) : "order_id";
  const cs = String(b.clickService || "").trim();
  const cm = String(b.clickMerchant || "").trim();
  if ((cs || cm) && !(/^\d{1,12}$/.test(cs) && /^\d{1,12}$/.test(cm))) errors.push("Click Service ID va Merchant ID raqam bo'lishi kerak");
  else { st.click.serviceId = cs; st.click.merchantId = cm; }
  st.cartReminderMin = Math.max(0, Math.min(1380, Math.round(Number(b.cartReminderMin) || 0)));
  st.cartReminderText = String(b.cartReminderText || st.cartReminderText).slice(0, 1000);
  st.currency = String(b.currency || "so'm").trim().slice(0, 10) || "so'm";
  st.notifyOwner = b.notifyOwner === "on";
  persist(req.user);
  res.redirect(errors.length ? `/shop?tab=settings&error=${encodeURIComponent(errors.join(". "))}` : "/shop?tab=settings&saved=1");
});
