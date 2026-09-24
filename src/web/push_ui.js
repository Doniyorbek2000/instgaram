/**
 * PWA va Web Push marshrutlari: manifest, service worker, obuna.
 */
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { MANIFEST, SERVICE_WORKER, vapidKeys, addSubscription, removeSubscription, pushToTenant } from "../push.js";
import { currentActor } from "../team.js";

export const pushRouter = Router();

pushRouter.get("/manifest.webmanifest", (_req, res) => {
  res.type("application/manifest+json").setHeader("Cache-Control", "public, max-age=86400");
  res.send(JSON.stringify(MANIFEST));
});

pushRouter.get("/sw.js", (_req, res) => {
  res.type("application/javascript");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Service-Worker-Allowed", "/");
  res.send(SERVICE_WORKER);
});

pushRouter.get("/push/key", requireAuth, async (_req, res) => {
  res.json({ publicKey: (await vapidKeys()).publicKey });
});

pushRouter.post("/push/subscribe", requireAuth, (req, res) => {
  const by = currentActor()?.user?.email || req.user.email || "";
  const ok = addSubscription(req.user, req.body, { by, ua: req.get("user-agent") || "" });
  res.status(ok ? 200 : 400).json({ ok });
});

pushRouter.post("/push/unsubscribe", requireAuth, (req, res) => {
  removeSubscription(req.user, String(req.body?.endpoint || ""));
  res.json({ ok: true });
});

pushRouter.post("/push/test", requireAuth, async (req, res) => {
  const n = await pushToTenant(req.user, { title: "Obunext ✅", body: "Bildirishnomalar ishlayapti — operator chaqirilsa, lid yoki buyurtma tushsa xabar olasiz.", url: "/inbox", tag: "test" });
  res.json({ ok: n > 0, sent: n });
});
