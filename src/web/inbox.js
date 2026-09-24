import { Router } from "express";
import { allTags, normTag, windowStatus, getContactMeta } from "../contacts.js";
import { aiAllowed, aiSettings } from "../aiControl.js";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { persist } from "../db.js";
import { sendDirectMessage } from "../services/instagram.js";
import { sendMessengerMessage } from "../services/messenger.js";
import { sendTelegramMessage } from "../telegram.js";
import { sendWhatsAppMessage } from "../services/whatsapp.js";


export const inboxRouter = Router();

/**
 * Kontakt avatarini quradi — profil rasmi (Instagram'dan olingan) bo'lsa
 * haqiqiy <img>, aks holda ism harfidan iborat gradient doira ko'rsatiladi.
 * Rasm yuklanmasa (onerror) — avtomatik harfli doiraga qaytadi.
 */
function avatarHtml(profilePic, initial, size, radius = "50%") {
  const safeInitial = esc(initial || "?");
  const fontSize = Math.round(size * 0.4);
  const fallbackDiv = `<div style="display:none; width:${size}px; height:${size}px; border-radius:${radius}; background:var(--grad-primary); place-items:center; color:#fff; font-weight:800; font-size:${fontSize}px; position:absolute; inset:0">${safeInitial}</div>`;
  if (!profilePic) {
    return `<div style="width:${size}px; height:${size}px; border-radius:${radius}; background:var(--grad-primary); display:grid; place-items:center; color:#fff; font-weight:800; font-size:${fontSize}px; flex:none">${safeInitial}</div>`;
  }
  return `
    <div style="position:relative; width:${size}px; height:${size}px; flex:none">
      <img src="${esc(profilePic)}" onerror="this.style.display='none'; this.nextElementSibling.style.display='grid'" style="width:${size}px; height:${size}px; border-radius:${radius}; object-fit:cover; position:absolute; inset:0; background:#1e293b">
      ${fallbackDiv}
    </div>
  `;
}

/**
 * Chat ma'lumotlarini normallashtiradi.
 * ai.js: tenant.chats[key] = [{role, text, at}]  (oddiy massiv)
 * inbox.js: {messages, channel, handOff, chatId, recipientId} formatini kutgan
 *
 * Shu funksiya ikkalasini ham qo'llab-quvvatlaydi.
 */
function normalizeChatEntry(key, rawChat) {
  // Agar oddiy massiv bo'lsa (ai.js formati) — wraplash
  if (Array.isArray(rawChat)) {
    // chatKey dan kanal va ID ni ajratamiz (format: "channel:id" yoki faqat id)
    const parts = key.split(":");
    const channel = parts.length >= 2 ? parts[0] : "ig";
    const chatId = parts.length >= 2 ? parts.slice(1).join(":") : key;
    return {
      channel,
      chatId,
      recipientId: chatId,
      chatKey: key,
      messages: rawChat,
      handOff: false,
    };
  }
  // Allaqachon obyekt formatida bo'lsa — to'g'ridan ishlatish
  return rawChat;
}

/**
 * Inbox ga yozuvchi funksiya — xabarni to'g'ri formatda saqlaydi.
 * Bu funksiya ikkala formatni ham to'g'ri qiladi.
 */
function appendInboxMessage(user, chatKey, msgObj) {
  user.chats ||= {};
  const raw = user.chats[chatKey];

  if (!raw) {
    // Yangi chat — massiv formatida boshlaylik (ai.js bilan mos)
    user.chats[chatKey] = [msgObj];
    return;
  }

  if (Array.isArray(raw)) {
    raw.push(msgObj);
    return;
  }

  // Eski obyekt formati
  raw.messages ||= [];
  raw.messages.push(msgObj);
}

/**
 * Obunext style Ultra-Professional Multi-Channel Live Inbox (/inbox)
 * 3-Column Layout: Contact List | Active Chat Stream | Contact CRM Details
 */
inboxRouter.get("/inbox", requireAuth, (req, res) => {
  const user = req.user;
  user.chats ||= {};

  let activeKey = String(req.query.chat || "");
  const filterChan = req.query.channel || "all";
  const searchQ = (req.query.q || "").toLowerCase().trim();
  const filterTag = normTag(req.query.tag || "");
  const filterWin = ["open", "closed"].includes(req.query.window) ? req.query.window : "";
  const tagOptions = allTags(user);
  // Filtr parametrlarini havolalarda saqlash uchun
  const keepQs = (patch = {}) =>
    new URLSearchParams(Object.fromEntries(Object.entries({ channel: filterChan, tag: filterTag, window: filterWin, q: req.query.q || "", ...patch }).filter(([, v]) => v && v !== "all"))).toString();

  // Barcha suhbatlar ro'yxatini normallashtirish va saralash
  user.contactProfiles ||= {};
  let chatList = Object.entries(user.chats).map(([key, rawChat]) => {
    const chat = normalizeChatEntry(key, rawChat);
    const msgs = chat.messages || [];
    const lastMsg = msgs[msgs.length - 1] || {};
    const profile = user.contactProfiles[chat.chatId || chat.recipientId];
    const displayName = profile?.username ? `@${profile.username}` : profile?.name || "";
    return {
      key,
      channel: chat.channel || "ig",
      chatKey: chat.chatKey || key,
      handOff: Boolean(chat.handOff),
      messages: msgs,
      lastTime: lastMsg.at ? new Date(lastMsg.at) : new Date(0),
      lastText: lastMsg.text || "",
      displayName,
      profilePic: profile?.profilePic || "",
      tags: user.contactMeta?.[key]?.tags || [],
      win: windowStatus(user, key),
    };
  });
  // Ichki yozuvlar (komment AI tarixi "comment:..." va h.k.) Inbox'da ko'rinmasin
  chatList = chatList.filter((c) => /^(ig|fb|wa|tg):/.test(c.key));

  chatList.sort((a, b) => b.lastTime - a.lastTime);

  // Filtrlash
  if (filterChan !== "all") {
    chatList = chatList.filter((c) => c.channel.toLowerCase() === filterChan.toLowerCase());
  }
  if (filterTag) chatList = chatList.filter((c) => c.tags.includes(filterTag));
  if (filterWin) chatList = chatList.filter((c) => (filterWin === "open" ? c.win.open : !c.win.open));
  if (searchQ) {
    chatList = chatList.filter(
      (c) =>
        c.key.toLowerCase().includes(searchQ) ||
        c.displayName.toLowerCase().includes(searchQ) ||
        c.lastText.toLowerCase().includes(searchQ)
    );
  }

  if (!activeKey) activeKey = chatList[0]?.key || "";
  const rawActiveChat = activeKey ? user.chats[activeKey] : null;
  const activeChatObj = rawActiveChat ? normalizeChatEntry(activeKey, rawActiveChat) : null;
  const activeProfile = activeChatObj ? user.contactProfiles[activeChatObj.chatId || activeChatObj.recipientId] : null;
  const activeDisplayName = activeProfile?.username ? `@${activeProfile.username}` : activeProfile?.name || "";
  const activeProfilePic = activeProfile?.profilePic || "";

  // 1-Ustun: Contacts List HTML
  const contactsHtml = chatList.length
    ? chatList
        .map((c) => {
          const isActive = c.key === activeKey;
          const chanBadge =
            c.channel === "tg"
              ? `<span style="background:#229ED9; color:#fff; font-size:10px; padding:2px 6px; border-radius:4px; font-weight:800">TG</span>`
              : c.channel === "wa"
                ? `<span style="background:#25D366; color:#fff; font-size:10px; padding:2px 6px; border-radius:4px; font-weight:800">WA</span>`
                : c.channel === "fb" || c.channel === "facebook"
                  ? `<span style="background:#1877F2; color:#fff; font-size:10px; padding:2px 6px; border-radius:4px; font-weight:800">FB</span>`
                  : c.channel === "whatsapp"
                    ? `<span style="background:#25D366; color:#fff; font-size:10px; padding:2px 6px; border-radius:4px; font-weight:800">WA</span>`
                    : c.channel === "telegram"
                      ? `<span style="background:#229ED9; color:#fff; font-size:10px; padding:2px 6px; border-radius:4px; font-weight:800">TG</span>`
                      : `<span style="background:linear-gradient(45deg, #f09433, #bc1888); color:#fff; font-size:10px; padding:2px 6px; border-radius:4px; font-weight:800">IG</span>`;

          const nameLabel = c.displayName || c.key.slice(0, 16);
          const initial = nameLabel.replace(/^@/, "").charAt(0).toUpperCase();
          const timeStr = c.lastTime.getTime() > 0 ? c.lastTime.toLocaleTimeString("uz", { hour: "2-digit", minute: "2-digit" }) : "";
          const msgCount = c.messages.length;

          return `
            <a href="/inbox?${keepQs({ chat: c.key })}"
               style="display:flex; align-items:center; gap:12px; padding:12px; border-radius:10px; text-decoration:none; margin-bottom:4px; transition:0.15s; background:${isActive ? "#1e293b" : "transparent"}; border:${isActive ? "1px solid #7c3aed" : "1px solid transparent"}">
              ${avatarHtml(c.profilePic, initial, 40)}
              <div style="flex:1; min-width:0">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px">
                  <div style="font-weight:700; font-size:13.5px; color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
                    ${esc(nameLabel)}
                  </div>
                  <span style="font-size:11px; color:#64748b">${timeStr}</span>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center">
                  <div style="font-size:12px; color:#94a3b8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:140px">
                    ${c.tags.length ? `<span style="color:#fbbf24">#${esc(c.tags[0])}</span> ` : ""}${esc(c.lastText || "Suhbat yo'q")}
                  </div>
                  <div style="display:flex; gap:4px; align-items:center">
                    ${msgCount > 0 ? `<span style="background:#334155; color:#94a3b8; font-size:9px; padding:1px 5px; border-radius:3px">${msgCount}</span>` : ""}
                    <span title="${esc(c.win.label)}" style="width:8px; height:8px; border-radius:50%; background:${c.win.open ? "#34d399" : "#64748b"}; display:inline-block"></span>
                    ${c.handOff ? `<span style="background:#ef4444; color:#fff; font-size:9px; padding:1px 4px; border-radius:3px; font-weight:700">OP</span>` : ""}
                    ${chanBadge}
                  </div>
                </div>
              </div>
            </a>
          `;
        })
        .join("")
    : `<div style="text-align:center; padding:30px 10px; color:#64748b; font-size:13px">Muloqotlar topilmadi</div>`;

  // 2-Ustun: Chat Messages Stream
  let chatStreamHtml = "";
  if (activeChatObj) {
    const isHandOff = Boolean(activeChatObj.handOff);
    const messages = activeChatObj.messages || [];

    const messagesListHtml = messages
      .map((m) => {
        const isUser = m.role === "user";
        const isOperator = m.role === "operator";
        const timeStr = m.at ? new Date(m.at).toLocaleTimeString("uz", { hour: "2-digit", minute: "2-digit" }) : "";

        const alignStyle = isUser
          ? "align-self: flex-start; background: #1e293b; color: #f8fafc; border-bottom-left-radius: 2px;"
          : isOperator
            ? "align-self: flex-end; background: #0284c7; color: #fff; border-bottom-right-radius: 2px;"
            : "align-self: flex-end; background: linear-gradient(135deg, #7c3aed 0%, #c026d3 100%); color: #fff; border-bottom-right-radius: 2px;";

        const roleBadge = isUser
          ? `<span style="font-size:10px; opacity:0.7; font-weight:700">👤 MIJOZ</span>`
          : isOperator
            ? `<span style="font-size:10px; opacity:0.9; font-weight:700">👤 OPERATOR</span>`
            : `<span style="font-size:10px; opacity:0.9; font-weight:700">🤖 Obunext</span>`;

        return `
          <div style="display:flex; flex-direction:column; max-width:75%; ${alignStyle} padding:10px 14px; border-radius:12px; margin-bottom:10px; box-shadow:0 2px 8px rgba(0,0,0,0.2)">
            <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:4px">
              ${roleBadge}
              <span style="font-size:10px; opacity:0.6">${timeStr}</span>
            </div>
            <div style="font-size:14px; word-break:break-word; line-height:1.4">${esc(m.text || "")}</div>
          </div>
        `;
      })
      .join("");

    const chanLabel = (activeChatObj.channel || "ig").toUpperCase();

    chatStreamHtml = `
      <!-- Chat Topbar Header -->
      <div style="display:flex; justify-content:space-between; align-items:center; padding:14px 20px; border-bottom:1px solid var(--border); background:#0f172a; gap:10px; flex-wrap:wrap">
        <div style="display:flex; align-items:center; gap:12px; min-width:0">
          <a href="/inbox?channel=${filterChan}" class="inbox-back" aria-label="Ro'yxatga qaytish" style="text-decoration:none; color:#cbd5e1; font-size:20px; flex:none">←</a>
          ${avatarHtml(activeProfilePic, (activeDisplayName || activeKey).replace(/^@/, "").charAt(0).toUpperCase(), 42, "10px")}
          <div style="min-width:0">
            <b style="color:#fff; font-size:16px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block">${esc(activeDisplayName || activeKey)}</b>
            ${activeDisplayName ? `<div style="font-size:11px; color:#64748b; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${esc(activeKey)}</div>` : ""}
            <div style="font-size:12px; color:#94a3b8">Kanal: <span style="color:#a78bfa; font-weight:700">${esc(chanLabel)}</span></div>
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:8px; flex:none">
          <button type="button" class="secondary inbox-crm-toggle" onclick="document.querySelector('.inbox-crm').classList.add('show-mobile')" style="padding:8px 12px; font-size:13px; margin:0">👤</button>
          <!-- Shu chat uchun AI -->
          ${/^(ig|fb|wa|tg):/.test(activeKey) ? `<form method="post" action="/clients/c/${encodeURIComponent(activeKey)}/ai" style="margin:0">
            <input type="hidden" name="on" value="${user.contactMeta?.[activeKey]?.aiOff ? "1" : "0"}">
            <input type="hidden" name="back" value="/inbox?chat=${esc(encodeURIComponent(activeKey))}">
            <button class="secondary" title="${esc(aiAllowed(user, activeKey.split(":")[0], activeKey).allowed ? "AI shu chatda javob beradi" : "AI shu chatda javob bermaydi")}" style="padding:8px 12px; font-size:13px; margin:0; white-space:nowrap; ${user.contactMeta?.[activeKey]?.aiOff || !aiSettings(user).enabled ? "color:#f87171" : "color:#34d399"}">
              ${user.contactMeta?.[activeKey]?.aiOff ? "🧠 AI: o'chiq" : aiSettings(user).enabled ? "🧠 AI: yoqilgan" : "🧠 AI: umumiy o'chiq"}
            </button>
          </form>` : ""}
          <!-- Operator Mode Switch -->
          <form method="post" action="/inbox/toggle-handoff" style="margin:0">
            <input type="hidden" name="chatKey" value="${esc(activeKey)}">
            <button type="submit" class="${isHandOff ? "" : "secondary"}" style="padding:8px 16px; font-size:13px; margin:0; white-space:nowrap; ${isHandOff ? "background:#ef4444; border:0" : ""}">
              ${isHandOff ? "👤 Operator Rejimi (Yoqilgan)" : "🤖 Bot Rejimi (Avto)"}
            </button>
          </form>
        </div>
      </div>

      <!-- Messages Scroll Area -->
      <div id="chatScroll" style="flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; background:#0b0f19">
        ${messagesListHtml.length ? messagesListHtml : `<div style="text-align:center; color:#64748b; margin:auto">Xabarlar tarixi bo'sh</div>`}
      </div>

      <!-- Quick Reply Snippets Bar -->
      <div style="padding:8px 20px; background:#0b0f19; border-top:1px solid var(--border); display:flex; gap:6px; overflow-x:auto">
        <button type="button" class="secondary" onclick="quickReply('Assalomu alaykum! Narxlarimiz va joriy aksiyalar haqida ma\'lumot:')" style="padding:3px 8px; font-size:11.5px; margin:0">🛍️ Narxlar</button>
        <button type="button" class="secondary" onclick="quickReply('Manzilimiz: Toshkent sh., Chilonzor 5-daha 12-uy. Metro Chilonzor.')" style="padding:3px 8px; font-size:11.5px; margin:0">📍 Manzil</button>
        <button type="button" class="secondary" onclick="quickReply('To\'lovni Payme yoki Click orqali amalga oshirishingiz mumkin.')" style="padding:3px 8px; font-size:11.5px; margin:0">💳 To'lov</button>
        <button type="button" class="secondary" onclick="quickReply('Tirik operatorimiz sizga 5 daqiqa ichida javob beradi. Kuting.')" style="padding:3px 8px; font-size:11.5px; margin:0">👤 Operator</button>
      </div>

      <!-- Reply Box -->
      <form method="post" action="/inbox/send" style="padding:14px 20px; border-top:1px solid var(--border); background:#0f172a; display:flex; gap:10px; align-items:center; margin:0">
        <input type="hidden" name="chatKey" value="${esc(activeKey)}">
        <input type="text" id="opInput" name="text" placeholder="Operator sifatida javob yozing..." required autocomplete="off" style="flex:1; margin:0">
        <button type="submit" class="btn" style="margin:0; padding:11px 20px">Yuborish ➔</button>
      </form>

      <script>
        function quickReply(txt) {
          const inp = document.getElementById('opInput');
          if (inp) { inp.value = txt; inp.focus(); }
        }
        // Sahifa yuklanganda chat pastiga auto-scroll
        const el = document.getElementById('chatScroll');
        if (el) el.scrollTop = el.scrollHeight;
      </script>
    `;
  } else {
    chatStreamHtml = `
      <div style="flex:1; display:grid; place-items:center; color:#64748b; text-align:center">
        <div>
          <div style="font-size:48px; margin-bottom:12px">💬</div>
          <h3>Muloqotni tanlang</h3>
          <p class="hint">Chap tomondagi ro'yxatdan mijozni tanlab suhbatni ko'ring.</p>
        </div>
      </div>
    `;
  }

  // 3-Ustun: CRM Side Details
  let crmHtml = "";
  if (activeChatObj) {
    const msgs = activeChatObj.messages || [];
    const lead = (user.leads || []).find((l) => l.chatKey === activeKey);
    const activeWin = windowStatus(user, activeKey);
    const activeMeta = getContactMeta(user, activeKey);
    crmHtml = `
      <div style="padding:20px; background:#0f172a; height:100%; border-left:1px solid var(--border); overflow-y:auto">
        <div style="display:flex; justify-content:space-between; align-items:center">
          <h3 style="margin-top:0; font-size:16px; color:#fff">👤 Mijoz Profili (CRM)</h3>
          <button type="button" class="secondary inbox-crm-close" onclick="document.querySelector('.inbox-crm').classList.remove('show-mobile')" style="padding:4px 10px; font-size:15px; margin:0">✕</button>
        </div>

        <div style="text-align:center; padding:20px 0; border-bottom:1px solid var(--border)">
          <div style="margin:0 auto 12px; display:inline-block">
            ${avatarHtml(activeProfilePic, (activeDisplayName || activeKey).replace(/^@/, "").charAt(0).toUpperCase(), 64)}
          </div>
          <b style="color:#fff; font-size:15px; word-break:break-all">${esc(activeDisplayName || activeKey)}</b>
          ${activeDisplayName ? `<div style="font-size:11px; color:#64748b; margin-top:2px; word-break:break-all">${esc(activeKey)}</div>` : ""}
          <div style="font-size:12px; color:#a78bfa; margin-top:4px; font-weight:700">Kanal: ${esc((activeChatObj.channel || "ig").toUpperCase())}</div>
          <div style="margin-top:8px; font-size:12.5px; font-weight:700; color:${activeWin.open ? "#34d399" : "#f87171"}">${activeWin.open ? "✅" : "❌"} ${esc(activeWin.label)}</div>
          <a class="btn secondary" href="/clients/c/${encodeURIComponent(activeKey)}" style="margin:10px 0 0; padding:5px 12px; font-size:12px">🪪 Kartochkani ochish</a>
        </div>

        <div style="margin-top:16px">
          <div style="font-size:12px; color:#64748b; margin-bottom:6px; font-weight:700">TEGLAR</div>
          <div style="display:flex; gap:4px; flex-wrap:wrap">
            ${activeMeta.tags.map((t) => `<form method="post" action="/clients/c/${encodeURIComponent(activeKey)}/tags" style="margin:0"><input type="hidden" name="remove" value="${esc(t)}"><input type="hidden" name="back" value="/inbox?${esc(keepQs({ chat: activeKey }))}"><button class="secondary" style="margin:0; padding:2px 8px; font-size:11.5px">#${esc(t)} ✕</button></form>`).join("") || `<span style="font-size:12px; color:#64748b">Teg yo'q</span>`}
          </div>
          <form method="post" action="/clients/c/${encodeURIComponent(activeKey)}/tags" style="display:flex; gap:4px; margin:8px 0 0">
            <input type="hidden" name="back" value="/inbox?${esc(keepQs({ chat: activeKey }))}">
            <input name="add" list="inboxTags" placeholder="+ teg" required style="margin:0; padding:6px 10px; font-size:12.5px">
            <datalist id="inboxTags">${tagOptions.map(([t]) => `<option value="${esc(t)}">`).join("")}</datalist>
            <button class="secondary" style="margin:0; padding:4px 10px">+</button>
          </form>
          ${Object.keys(activeMeta.fields).length ? `<div style="margin-top:12px; font-size:12.5px">${Object.entries(activeMeta.fields).slice(0, 8).map(([k, v]) => `<div style="display:flex; justify-content:space-between; gap:6px"><span style="color:#94a3b8">${esc(k)}</span><b style="color:#fff; word-break:break-all">${esc(v)}</b></div>`).join("")}</div>` : ""}
        </div>

        <div style="margin-top:20px; font-size:13px; display:flex; flex-direction:column; gap:12px">
          <div style="display:flex; justify-content:space-between">
            <span style="color:#94a3b8">Xabarlar soni:</span>
            <b style="color:#fff">${msgs.length} ta</b>
          </div>
          <div style="display:flex; justify-content:space-between">
            <span style="color:#94a3b8">Rejim:</span>
            <b style="color:${activeChatObj.handOff ? "#f87171" : "#34d399"}">${activeChatObj.handOff ? "Operator" : "Obunext Bot"}</b>
          </div>
          <div style="display:flex; justify-content:space-between">
            <span style="color:#94a3b8">1-xabar:</span>
            <b style="color:#fff">${msgs[0]?.at ? new Date(msgs[0].at).toLocaleDateString("uz") : "-"}</b>
          </div>
          ${lead ? `
          <div style="display:flex; justify-content:space-between">
            <span style="color:#94a3b8">Jami muloqot:</span>
            <b style="color:#a78bfa">${lead.count || 1} ta</b>
          </div>
          ` : ""}
        </div>

        ${msgs.length > 0 ? `
        <div style="margin-top:20px; border-top:1px solid var(--border); padding-top:16px">
          <div style="font-size:12px; color:#64748b; margin-bottom:8px; font-weight:700">SO'NGGI XABAR</div>
          <div style="font-size:13px; color:#cbd5e1; background:#0b0f19; padding:10px; border-radius:8px; word-break:break-word">
            "${esc((msgs[msgs.length - 1]?.text || "").slice(0, 120))}"
          </div>
        </div>
        ` : ""}
      </div>
    `;
  } else {
    crmHtml = `<div style="padding:20px; color:#64748b; text-align:center">Mijoz tanlanmagan</div>`;
  }

  res.send(
    page(
      "Live Inbox",
      `
      <style>
        /* Live Inbox — mobil/planshetda 3 ustunli grid emas, bitta panel ko'rinadi:
           chat tanlanmagan bo'lsa kontaktlar ro'yxati, tanlansa suhbat oynasi.
           CRM paneli mobil'da yashirin, "👤" tugmasi orqali to'liq ekran overlay
           sifatida ochiladi. Diqqat: bu qoidalar inline style'lar bilan
           to'qnashmasligi uchun display/grid/height/flex-direction endi FAQAT shu
           yerda belgilanadi (elementlarda inline style sifatida qaytarilmaydi) —
           aks holda inline style har doim stylesheet qoidasidan ustun kelib,
           media query hech qanday amaliy ta'sir qilmay qolardi.
        */
        .inbox-shell { display:grid; grid-template-columns: 320px 1fr 260px; height: calc(100vh - 120px); border-radius:14px; overflow:hidden; border:1px solid var(--border); background:var(--bg-card); }
        /* min-height:0 shart — aks holda bu flex-ustunlar (grid katakchasi bo'lsa
           ham) ichidagi ko'p xabarli #chatScroll/kontaktlar ro'yxati o'z ichida
           aylanish o'rniga butun panelni pastga cho'zib, javob yozish maydonini
           ekrandan chiqarib yuborardi (klassik ichma-ich flexbox overflow xatosi). */
        .inbox-list { display:flex; flex-direction:column; min-height:0; }
        .inbox-chat { display:flex; flex-direction:column; min-height:0; }
        .inbox-back, .inbox-crm-toggle, .inbox-crm-close { display:none; }
        @media (max-width: 900px) {
          .inbox-shell { grid-template-columns: 1fr; height: calc(100vh - 175px); border-radius:10px; }
          .inbox-list, .inbox-chat { display: none; }
          .inbox-shell:not(.has-active) .inbox-list { display: flex; }
          .inbox-shell.has-active .inbox-chat { display: flex; }
          .inbox-back, .inbox-crm-toggle { display: inline-flex; align-items:center; justify-content:center; }
          .inbox-crm { display: none; }
          .inbox-crm.show-mobile { display: block; position: fixed; inset: 0; z-index: 60; background: var(--bg-card); }
          .inbox-crm-close { display: inline-block; }
        }
      </style>
      <div class="inbox-shell${activeChatObj ? " has-active" : ""}">

        <!-- 1-Ustun: Contacts Sidebar -->
        <div class="inbox-list" style="border-right:1px solid var(--border); background:#0f172a">
          <!-- Search & Filter Bar -->
          <div style="padding:14px; border-bottom:1px solid var(--border)">
            <form method="get" action="/inbox" style="margin:0 0 10px; display:flex; flex-direction:column; gap:6px">
              <input type="hidden" name="channel" value="${esc(filterChan)}">
              <input type="text" name="q" value="${esc(req.query.q || "")}" placeholder="🔍 Qidirish..." autocomplete="off" style="padding:8px 12px; font-size:13px; margin:0">
              <div style="display:flex; gap:6px">
                <select name="tag" onchange="this.form.submit()" style="margin:0; padding:6px 8px; font-size:12px">
                  <option value="">Barcha teglar</option>
                  ${tagOptions.map(([t, n]) => `<option value="${esc(t)}" ${filterTag === t ? "selected" : ""}>#${esc(t)} (${n})</option>`).join("")}
                </select>
                <select name="window" onchange="this.form.submit()" style="margin:0; padding:6px 8px; font-size:12px">
                  <option value="">Istalgan oyna</option>
                  <option value="open" ${filterWin === "open" ? "selected" : ""}>✅ Ochiq</option>
                  <option value="closed" ${filterWin === "closed" ? "selected" : ""}>❌ Yopiq</option>
                </select>
              </div>
            </form>

            <!-- Channel Filter Pills -->
            <div style="display:flex; gap:4px; overflow-x:auto; padding-bottom:4px">
              <a href="/inbox?${keepQs({ channel: "all" })}" style="padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; background:${filterChan === "all" ? "#7c3aed" : "#1e293b"}; color:#fff; white-space:nowrap">Barchasi</a>
              <a href="/inbox?${keepQs({ channel: "ig" })}" style="padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; background:${filterChan === "ig" ? "#7c3aed" : "#1e293b"}; color:#fff">IG</a>
              <a href="/inbox?${keepQs({ channel: "tg" })}" style="padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; background:${filterChan === "tg" ? "#229ED9" : "#1e293b"}; color:#fff">TG</a>
              <a href="/inbox?${keepQs({ channel: "wa" })}" style="padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; background:${filterChan === "wa" ? "#25D366" : "#1e293b"}; color:#fff">WA</a>
              <a href="/inbox?${keepQs({ channel: "fb" })}" style="padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; background:${filterChan === "fb" ? "#1877F2" : "#1e293b"}; color:#fff">FB</a>
            </div>
          </div>

          <!-- Contacts List -->
          <div style="flex:1; overflow-y:auto; padding:8px">
            ${contactsHtml}
          </div>
        </div>

        <!-- 2-Ustun: Chat Stream -->
        <div class="inbox-chat" style="min-width:0">
          ${chatStreamHtml}
        </div>

        <!-- 3-Ustun: CRM Side Panel -->
        <div class="inbox-crm">
          ${crmHtml}
        </div>
      </div>
      `,
      { user, active: "inbox" }
    )
  );
});

// Operator xabarini yuborish
inboxRouter.post("/inbox/send", requireAuth, async (req, res) => {
  const user = req.user;
  const { chatKey, text } = req.body || {};
  if (!chatKey || !text) return res.redirect("/inbox");

  user.chats ||= {};
  if (!user.chats[chatKey]) return res.redirect("/inbox");

  const rawChat = user.chats[chatKey];
  const msgObj = { role: "operator", text, at: new Date().toISOString() };

  // Massiv formatida saqlangan bo'lsa — to'g'ridan push
  if (Array.isArray(rawChat)) {
    rawChat.push(msgObj);
    // handOff ni alohida saqlaymiz (massiv formatida joyi yo'q, manualChats ishlatamiz)
    user.manualChats ||= {};
    user.manualChats[chatKey] = Date.now() + 2 * 60 * 60 * 1000;
  } else {
    rawChat.messages ||= [];
    rawChat.messages.push(msgObj);
  }
  persist(user);


  // Kanalga xabarni yuborish
  const chat = normalizeChatEntry(chatKey, rawChat);
  const chan = (chat.channel || "ig").toLowerCase();
  const recipient = chat.recipientId || chat.chatId || chatKey.replace(/^[a-z]+:/i, "");

  try {
    if (chan === "tg" || chan === "telegram") {
      await sendTelegramMessage(user, recipient, text);
    } else if (chan === "wa" || chan === "whatsapp") {
      await sendWhatsAppMessage(user, recipient, text);
    } else if (chan === "fb" || chan === "facebook") {
      await sendMessengerMessage(user, recipient, text);
    } else if (chan === "ig" || chan === "instagram") {
      await sendDirectMessage(user, recipient, text);
    }
  } catch (err) {
    console.error("[Inbox Send] Xabar yuborishda xato:", err.message);
  }

  res.redirect(`/inbox?chat=${encodeURIComponent(chatKey)}`);
});

// Bot / Operator rejimini almashtirish
inboxRouter.post("/inbox/toggle-handoff", requireAuth, (req, res) => {
  const user = req.user;
  const { chatKey } = req.body || {};
  if (!chatKey || !user.chats?.[chatKey]) return res.redirect("/inbox");

  const raw = user.chats[chatKey];
  if (Array.isArray(raw)) {
    // Massiv formatida: manualChats orqali boshqaramiz
    user.manualChats ||= {};
    if (user.manualChats[chatKey]) {
      delete user.manualChats[chatKey]; // Bot rejimiga qaytish
    } else {
      user.manualChats[chatKey] = Date.now() + 2 * 60 * 60 * 1000; // Operator rejimi
    }
  } else {
    raw.handOff = !raw.handOff;
  }
  persist(user);

  res.redirect(`/inbox?chat=${encodeURIComponent(chatKey)}`);
});

