/**
 * MCP server (Model Context Protocol, Streamable HTTP) — Claude (claude.ai,
 * Claude Desktop, Claude Code) yoki boshqa MCP mijozini biznes paneliga ulaydi:
 * "Reels ostida KURS deb yozganlarga bepul dars yuboradigan flow qil" deb
 * yozasiz — Claude create_flow chaqiradi va flow panelda paydo bo'ladi.
 *
 * Kirish: POST /mcp/<token> (yoki POST /mcp + "Authorization: Bearer <token>").
 * Token biznes egasi tomonidan /integrations sahifasida yaratiladi, bazada faqat
 * sha256 xeshi saqlanadi. "read" tokeni faqat o'qiydigan tool'larni chaqira oladi.
 */
import crypto from "node:crypto";
import { listUsers, persist, updateUser } from "./db.js";
import { ensureFlows, findFlow, sanitizeFlow, dailySeries, TRIGGER_TYPES } from "./flows.js";
import { autoLayout, AI_FLOW_PROMPT } from "./flowTemplates.js";
import { allTags, displayName, windowStatus, getContactMeta } from "./contacts.js";
import { allContacts, sanitizeBroadcast, createBroadcast, runBroadcast, resolveAudience } from "./broadcasts.js";
import { splitKey } from "./outbound.js";
import { isActive } from "./subscription.js";

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "adm-ai", title: "ADM AI — Instagram/Telegram avtomatlashtirish", version: "1.0.0" };
const MAX_TOKENS = 10;
const RATE_PER_MIN = 60;

// ==== Tokenlar ====

const hashToken = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");

export function createApiToken(tenant, { name = "Claude", scope = "full" } = {}) {
  tenant.apiTokens ||= [];
  if (tenant.apiTokens.length >= MAX_TOKENS) return { error: `Ko'pi bilan ${MAX_TOKENS} ta token` };
  const token = `adm_${crypto.randomBytes(24).toString("hex")}`;
  const rec = {
    id: crypto.randomBytes(6).toString("hex"),
    name: String(name || "Claude").trim().slice(0, 60) || "Claude",
    scope: scope === "read" ? "read" : "full",
    hash: hashToken(token),
    prefix: token.slice(0, 10),
    createdAt: new Date().toISOString(),
    lastUsedAt: "",
  };
  tenant.apiTokens.push(rec);
  persist(tenant);
  return { token, rec };
}

export function revokeApiToken(tenant, id) {
  const before = (tenant.apiTokens || []).length;
  tenant.apiTokens = (tenant.apiTokens || []).filter((t) => t.id !== id);
  persist(tenant);
  return tenant.apiTokens.length !== before;
}

/** Token bo'yicha biznes va token yozuvini topadi (doimiy vaqtda solishtirish). */
export async function findByToken(token) {
  const t = String(token || "");
  if (!/^adm_[a-f0-9]{48}$/.test(t)) return null;
  const h = Buffer.from(hashToken(t));
  for (const tenant of await listUsers()) {
    for (const rec of tenant.apiTokens || []) {
      const other = Buffer.from(rec.hash || "");
      if (other.length === h.length && crypto.timingSafeEqual(other, h)) return { tenant, rec };
    }
  }
  return null;
}

const hits = new Map();
function rateLimited(id) {
  const now = Date.now();
  const rec = hits.get(id);
  if (!rec || now > rec.reset) {
    hits.set(id, { n: 1, reset: now + 60000 });
    return false;
  }
  rec.n++;
  return rec.n > RATE_PER_MIN;
}

// ==== Tool'lar ====

const flowShape = `Flow JSON shape (same as the in-app AI generator):\n${AI_FLOW_PROMPT}`;

function flowSummary(f) {
  const s = f.stats || {};
  return {
    id: f.id,
    name: f.name,
    enabled: f.enabled,
    triggers: (f.triggers || []).map((t) => ({ type: t.type, label: TRIGGER_TYPES[t.type], keyword: t.keyword, matchType: t.matchType })),
    blocks: Object.keys(f.nodes || {}).length,
    stats: { started: s.started || 0, completed: s.completed || 0, conversions: s.conversions || 0 },
  };
}

function prepareFlow(input, existing) {
  const raw = typeof input === "string" ? JSON.parse(input) : input;
  if (!raw || typeof raw !== "object") throw new Error("flow must be a JSON object");
  const flow = sanitizeFlow({ ...raw, enabled: raw.enabled ?? existing?.enabled ?? false }, existing || {});
  if (!Object.keys(flow.nodes).length) throw new Error("flow has no valid nodes");
  const needsLayout = Object.values(flow.nodes).every((n) => !n.x && !n.y);
  return needsLayout ? autoLayout(flow) : flow;
}

export const TOOLS = [
  {
    name: "get_business_info",
    description: "Business name, knowledge base excerpt, connected channels and headline stats. Call this first to learn the business before designing automations.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: (t) => ({
      name: t.businessName,
      knowledgeBase: String(t.businessInfo || "").slice(0, 6000),
      toneOfVoice: t.settings?.aiStyle || "",
      channels: {
        instagram: Boolean(t.meta?.igAccessToken || t.meta?.pageAccessToken),
        telegram: Boolean(t.settings?.telegramBotToken),
        telegramBusiness: Boolean(t.tgBusiness?.enabled),
        whatsapp: Boolean(t.meta?.whatsappToken),
        messenger: Boolean(t.meta?.pageAccessToken && t.meta?.pageId),
      },
      contacts: allContacts(t).length,
      flows: ensureFlows(t).list.length,
    }),
  },
  {
    name: "list_flows",
    description: "List automation flows with triggers and stats.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: (t) => ensureFlows(t).list.map(flowSummary),
  },
  {
    name: "get_flow",
    description: "Full JSON of one flow (triggers and blocks).",
    inputSchema: { type: "object", properties: { flowId: { type: "string" } }, required: ["flowId"], additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: (t, a) => {
      const f = findFlow(t, a.flowId);
      if (!f) throw new Error("flow not found");
      return { ...f, nodes: Object.values(f.nodes) };
    },
  },
  {
    name: "create_flow",
    description: `Create a new automation flow (disabled by default so the owner can review it; pass enabled:true inside flow to activate). ${flowShape}`,
    inputSchema: {
      type: "object",
      properties: { flow: { type: "object", description: "Flow JSON: {name, triggers, start, nodes, enabled?}" } },
      required: ["flow"],
      additionalProperties: false,
    },
    write: true,
    run: (t, a) => {
      const flow = prepareFlow(a.flow);
      ensureFlows(t).list.unshift(flow);
      persist(t);
      return { created: flowSummary(flow), editorPath: `/flows/${flow.id}` };
    },
  },
  {
    name: "update_flow",
    description: `Replace a flow's name/triggers/blocks (stats are kept). ${flowShape}`,
    inputSchema: {
      type: "object",
      properties: { flowId: { type: "string" }, flow: { type: "object" } },
      required: ["flowId", "flow"],
      additionalProperties: false,
    },
    write: true,
    run: (t, a) => {
      const list = ensureFlows(t).list;
      const idx = list.findIndex((f) => f.id === a.flowId);
      if (idx < 0) throw new Error("flow not found");
      list[idx] = prepareFlow(a.flow, list[idx]);
      persist(t);
      return { updated: flowSummary(list[idx]) };
    },
  },
  {
    name: "set_flow_enabled",
    description: "Turn a flow on or off.",
    inputSchema: { type: "object", properties: { flowId: { type: "string" }, enabled: { type: "boolean" } }, required: ["flowId", "enabled"], additionalProperties: false },
    write: true,
    run: (t, a) => {
      const f = findFlow(t, a.flowId);
      if (!f) throw new Error("flow not found");
      f.enabled = Boolean(a.enabled);
      persist(t);
      return flowSummary(f);
    },
  },
  {
    name: "delete_flow",
    description: "Delete a flow permanently.",
    inputSchema: { type: "object", properties: { flowId: { type: "string" } }, required: ["flowId"], additionalProperties: false },
    write: true,
    annotations: { destructiveHint: true },
    run: (t, a) => {
      const fl = ensureFlows(t);
      const before = fl.list.length;
      fl.list = fl.list.filter((f) => f.id !== a.flowId);
      if (fl.list.length === before) throw new Error("flow not found");
      persist(t);
      return { deleted: a.flowId };
    },
  },
  {
    name: "list_tags",
    description: "Contact tags with counts (for segmentation and flow conditions).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: (t) => allTags(t).map(([tag, count]) => ({ tag, count })),
  },
  {
    name: "list_contacts",
    description: "Contacts, newest first. Optional filter by tag and channel (ig, tg, wa, fb).",
    inputSchema: {
      type: "object",
      properties: { tag: { type: "string" }, channel: { type: "string", enum: ["ig", "tg", "wa", "fb"] }, limit: { type: "integer", minimum: 1, maximum: 200 } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: (t, a) => {
      const tag = String(a.tag || "").toLowerCase();
      return allContacts(t)
        .filter((k) => !a.channel || splitKey(k).chan === a.channel)
        .filter((k) => !tag || getContactMeta(t, k).tags.includes(tag))
        .slice(0, a.limit || 50)
        .map((k) => ({ key: k, name: displayName(t, k), tags: getContactMeta(t, k).tags, fields: getContactMeta(t, k).fields, windowOpen: windowStatus(t, k).open }));
    },
  },
  {
    name: "get_analytics",
    description: "Messages, flow starts and conversions for the last N days (7-90).",
    inputSchema: { type: "object", properties: { days: { type: "integer", minimum: 7, maximum: 90 } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: (t, a) => {
      const days = Math.min(90, Math.max(7, a.days || 30));
      const flows = ensureFlows(t).list;
      const series = dailySeries(t, flows, days).map((r) => ({ ...r, messages: t.stats?.days?.[r.date] || 0 }));
      const sum = (k) => series.reduce((x, r) => x + (r[k] || 0), 0);
      return { days, totals: { messages: sum("messages"), started: sum("started"), conversions: sum("conversions") }, flows: flows.map(flowSummary), daily: series };
    },
  },
  {
    name: "send_broadcast",
    description: "Send (or schedule) a message to a contact segment. Meta channels only reach contacts who wrote in the last 24h. Supports {name|fallback} variables. Use dryRun:true first to see the audience size.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        message: { type: "string" },
        channel: { type: "string", enum: ["all", "ig", "tg", "wa", "fb"] },
        tags: { type: "string", description: "comma separated; contacts having any of them" },
        excludeTags: { type: "string" },
        scheduledAt: { type: "string", description: "ISO datetime in the future; omit to send now" },
        dryRun: { type: "boolean" },
      },
      required: ["name", "message"],
      additionalProperties: false,
    },
    write: true,
    run: async (t, a) => {
      const data = sanitizeBroadcast({ ...a, only24h: "true" });
      const audience = resolveAudience(t, data.filter).length;
      if (a.dryRun) return { audience };
      if (!isActive(t)) throw new Error("Broadcasts require a paid plan");
      if (!data.message) throw new Error("message is empty");
      const b = createBroadcast(t, data);
      if (!data.scheduledAt) runBroadcast(t, b.id).catch((err) => console.error("[MCP broadcast]", err.message));
      return { broadcastId: b.id, audience, status: data.scheduledAt ? "scheduled" : "sending" };
    },
  },
];

// ==== JSON-RPC ====

const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });

/** Bitta JSON-RPC xabarini qayta ishlaydi. Notification uchun null qaytaradi. */
export async function handleRpc(tenant, rec, msg) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id, -32600, "Invalid Request");
  const isNotification = msg.id === undefined || msg.id === null;
  const { method, params = {} } = msg;

  if (method === "initialize") {
    const requested = params.protocolVersion;
    return rpcResult(msg.id, {
      protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: `You are connected to the ADM AI automation panel of "${tenant.businessName || "a business"}". Call get_business_info first. New flows are created disabled; tell the owner to review them in the panel before enabling.`,
    });
  }
  if (isNotification) return null; // notifications/initialized va boshqalar — javob kerak emas
  if (method === "ping") return rpcResult(msg.id, {});
  if (method === "tools/list") {
    return rpcResult(msg.id, {
      tools: TOOLS.filter((t) => rec.scope === "full" || !t.write).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        ...(t.annotations ? { annotations: t.annotations } : {}),
      })),
    });
  }
  if (method === "tools/call") {
    const tool = TOOLS.find((t) => t.name === params.name);
    if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${params.name}`);
    if (tool.write && rec.scope !== "full") {
      return rpcResult(msg.id, { isError: true, content: [{ type: "text", text: "This token is read-only." }] });
    }
    try {
      const out = await tool.run(tenant, params.arguments || {});
      return rpcResult(msg.id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: Array.isArray(out) ? { items: out } : out });
    } catch (err) {
      return rpcResult(msg.id, { isError: true, content: [{ type: "text", text: `Error: ${err.message}` }] });
    }
  }
  return rpcError(msg.id, -32601, `Method not found: ${method}`);
}

/** Express handler: POST /mcp/:token va POST /mcp (Bearer). */
export async function mcpHandler(req, res) {
  const bearer = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const found = await findByToken(req.params.token || bearer);
  if (!found) return res.status(401).json(rpcError(null, -32001, "Invalid or revoked token"));
  if (rateLimited(found.rec.id)) return res.status(429).json(rpcError(null, -32002, "Rate limit: 60 requests per minute"));

  const prev = Date.parse(found.rec.lastUsedAt || 0) || 0;
  found.rec.lastUsedAt = new Date().toISOString();
  // "Oxirgi ishlatilgan" vaqtini 5 daqiqada bir marta saqlaymiz (faqat token maydoni)
  if (Date.now() - prev > 5 * 60 * 1000) updateUser(found.tenant.id, { apiTokens: found.tenant.apiTokens }).catch(() => {});
  const body = req.body;
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleRpc(found.tenant, found.rec, m)))).filter(Boolean);
    return out.length ? res.json(out) : res.status(202).end();
  }
  const out = await handleRpc(found.tenant, found.rec, body);
  if (!out) return res.status(202).end();
  res.json(out);
}
