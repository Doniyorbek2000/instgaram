/**
 * Tayyor flow shablonlari (bir bosishda o'rnatiladi) va avtomatik joylashtirish.
 */
import { sanitizeFlow } from "./flows.js";

/** Bloklarni daraxt bo'yicha ustun-qator qilib joylashtiradi (x/y berilmagan bo'lsa). */
export function autoLayout(flow) {
  const nodes = flow.nodes || {};
  const ids = Object.keys(nodes);
  if (!ids.length) return flow;
  const level = {};
  const queue = [];
  const startId = flow.start && nodes[flow.start] ? flow.start : ids[0];
  level[startId] = 0;
  queue.push(startId);
  const children = (n) => [
    n.next, n.yes, n.no, ...(n.buttons || []).map((b) => b.next),
  ].filter((id) => id && nodes[id]);
  while (queue.length) {
    const id = queue.shift();
    for (const c of children(nodes[id])) {
      if (level[c] === undefined) {
        level[c] = level[id] + 1;
        queue.push(c);
      }
    }
  }
  let orphanLevel = Math.max(0, ...Object.values(level)) + 1;
  for (const id of ids) if (level[id] === undefined) level[id] = orphanLevel++;
  const rows = {};
  for (const id of ids) {
    const l = level[id];
    const row = (rows[l] = (rows[l] || 0) + 1) - 1;
    nodes[id].x = 60 + l * 330;
    nodes[id].y = 60 + row * 230;
  }
  return flow;
}

const T = {
  giveaway: {
    name: "🎁 Komment → obuna → sovg'a",
    triggers: [{ type: "comment", keyword: "sovg'a, gift, подарок", matchType: "contains", publicReplies: ["Direct'ni tekshiring 📩", "Sovg'a Direct'da! 🎁", "Yubordik, Direct'ga qarang ✨"] }],
    start: "m1",
    nodes: [
      { id: "m1", type: "message", text: "Salom, {name|do'stim}! 🎁 Sovg'ani olish uchun pastdagi tugmani bosing 👇", buttons: [{ id: "b1", title: "Sovg'ani olish 🎁", next: "c1" }] },
      { id: "c1", type: "condition", match: "all", conditions: [{ kind: "follows" }], yes: "a1", no: "m3" },
      { id: "a1", type: "action", actions: [{ kind: "add_tag", value: "sovga-oldi" }, { kind: "conversion", value: "Sovg'a berildi" }], next: "m2" },
      { id: "m2", type: "message", text: "Mana sovg'angiz 🎉 Foydali bo'lsin!", buttons: [{ id: "b2", title: "Ochish", url: "https://example.uz/sovga" }], next: "d1" },
      { id: "d1", type: "delay", minutes: 60, next: "m4" },
      { id: "m4", type: "message", text: "{first_name|Do'stim}, sovg'a yoqdimi? 😊 Savollaringiz bo'lsa shu yerga yozing." },
      { id: "m3", type: "message", text: "Sovg'a faqat obunachilarimiz uchun 🙏 Sahifamizga obuna bo'ling va tugmani qayta bosing:", buttons: [{ id: "b3", title: "Obuna bo'ldim ✅", next: "c1" }] },
    ],
  },
  leads: {
    name: "📝 Lid yig'ish (ism + telefon)",
    triggers: [{ type: "keyword", keyword: "narx, zakaz, buyurtma, цена", matchType: "contains" }],
    start: "m1",
    nodes: [
      { id: "m1", type: "message", text: "Assalomu alaykum! Menejerimiz sizga aniq narx va shartlarni aytib beradi 😊", next: "q1" },
      { id: "q1", type: "input", text: "Ismingiz nima?", varName: "name", validate: "name", next: "q2" },
      { id: "q2", type: "input", text: "Rahmat, {name}! Telefon raqamingizni yozing (masalan +998 90 123 45 67):", varName: "phone", validate: "phone", next: "a1" },
      { id: "a1", type: "action", actions: [{ kind: "add_tag", value: "lid" }, { kind: "conversion", value: "Lid" }, { kind: "notify", value: "Yangi lid: {name}, {phone}" }, { kind: "webhook", value: "lid" }], next: "m2" },
      { id: "m2", type: "message", text: "Qabul qilindi ✅ {name}, menejerimiz tez orada {phone} raqamiga qo'ng'iroq qiladi." },
    ],
  },
  hours: {
    name: "🕘 Ish vaqti bo'yicha javob",
    triggers: [{ type: "new_contact" }],
    start: "c1",
    nodes: [
      { id: "c1", type: "condition", match: "all", conditions: [{ kind: "weekday", value: "1,2,3,4,5,6" }, { kind: "time", value: "09:00-19:00" }], yes: "ai1", no: "m1" },
      { id: "ai1", type: "ai", prompt: "Mijozni iliq kutib ol va savoliga qisqa javob ber." },
      { id: "m1", type: "message", text: "Assalomu alaykum! Hozir ish vaqtidan tashqari 🌙 Ertaga 09:00 dan javob beramiz.", next: "q1" },
      { id: "q1", type: "input", text: "Qo'ng'iroq qilishimiz uchun telefon raqamingizni qoldiring:", varName: "phone", validate: "phone", next: "a1" },
      { id: "a1", type: "action", actions: [{ kind: "add_tag", value: "qayta-qongiroq" }, { kind: "notify", value: "Ish vaqtidan tashqari murojaat: {phone}" }], next: "m2" },
      { id: "m2", type: "message", text: "Rahmat! Ertalab birinchi bo'lib sizga qo'ng'iroq qilamiz ☀️" },
    ],
  },
  quiz: {
    name: "🎯 Mahsulot tanlash testi",
    triggers: [{ type: "keyword", keyword: "test, tanlash, maslahat", matchType: "contains" }],
    start: "m1",
    nodes: [
      { id: "m1", type: "message", text: "Sizga mos variantni topamiz! Byudjetingiz qancha?", buttons: [{ id: "b1", title: "1 mln gacha", next: "a1" }, { id: "b2", title: "1-3 mln", next: "a2" }, { id: "b3", title: "3 mln+", next: "a3" }] },
      { id: "a1", type: "action", actions: [{ kind: "set_var", key: "byudjet", value: "arzon" }, { kind: "add_tag", value: "byudjet-arzon" }], next: "m2" },
      { id: "a2", type: "action", actions: [{ kind: "set_var", key: "byudjet", value: "orta" }, { kind: "add_tag", value: "byudjet-orta" }], next: "m2" },
      { id: "a3", type: "action", actions: [{ kind: "set_var", key: "byudjet", value: "premium" }, { kind: "add_tag", value: "byudjet-premium" }], next: "m2" },
      { id: "m2", type: "message", text: "Ajoyib! Siz uchun eng mos to'plamni tayyorladik — menejer tavsiya yuboradi 🙌", next: "a4" },
      { id: "a4", type: "action", actions: [{ kind: "conversion", value: "Test yakunlandi" }, { kind: "notify", value: "Test: {name} — byudjet {byudjet}" }] },
    ],
  },
  empty: {
    name: "Yangi flow",
    triggers: [{ type: "keyword", keyword: "", matchType: "contains" }],
    start: "m1",
    nodes: [{ id: "m1", type: "message", text: "Salom, {name|do'stim}! 👋" }],
  },
};

export const FLOW_TEMPLATES = Object.fromEntries(Object.entries(T).map(([k, v]) => [k, v.name]));

export function buildTemplate(key) {
  const def = T[key] || T.empty;
  return autoLayout(sanitizeFlow(JSON.parse(JSON.stringify(def))));
}

/** AI'ga flow yaratish uchun beriladigan ko'rsatma (JSON sxema tavsifi). */
export const AI_FLOW_PROMPT = `You design chatbot automation flows for Instagram/Telegram businesses in Uzbekistan.
Return ONLY JSON: {"name": string, "triggers": [Trigger], "start": nodeId, "nodes": [Node]}.
Trigger: {"type": "keyword"|"comment"|"live_comment"|"story_reply"|"story_mention"|"new_contact"|"ref", "keyword": "comma separated words", "matchType": "contains"|"exact"|"any"|"ai", "aiIntent": "meaning description when matchType=ai", "publicReplies": ["short public comment replies (comment triggers only)"]}
Node ids: short latin like "m1","q1","c1","a1". Node types:
- {"id","type":"message","text","buttons":[{"id","title"(<=20 chars),"next":nodeId}|{"id","title","url":"https://..."}],"next":nodeId}
- {"id","type":"input","text":"question","varName":"name|phone|email|any_snake_case","validate":"text"|"name"|"phone"|"email"|"number","next"}
- {"id","type":"condition","match":"all"|"any","conditions":[{"kind":"tag","op":"has"|"not","value"}|{"kind":"weekday","value":"1,2,3,4,5"}|{"kind":"time","value":"09:00-18:00"}|{"kind":"points","op":"gte"|"lte","value":"10"}|{"kind":"var","key","op":"exists"|"eq","value"}|{"kind":"follows"}],"yes":nodeId,"no":nodeId}
- {"id","type":"action","actions":[{"kind":"add_tag"|"remove_tag"|"conversion"|"notify"|"handoff"|"webhook","value"}|{"kind":"set_var","key","value"}|{"kind":"add_points","value":"10"}],"next"}
- {"id","type":"delay","minutes":number,"next"}
- {"id","type":"ai","prompt":"instruction for AI answer","next"}
Message texts may use variables {name|fallback}, {first_name}, {phone}, {points}, {business} and any collected varName.
Write all customer-facing texts in the language the business owner used (default Uzbek, Latin script), friendly, short, with a few emojis.
Always include a "conversion" action at the goal step. Keep 3-12 nodes.`;
