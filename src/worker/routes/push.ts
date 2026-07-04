// Push notification routes.
// Public: vapid-public-key, subscribe (anyone visiting can subscribe — public status page PWA)
// Admin: subscriptions list, delete, test, vapid-subject config

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Env } from "../types";
import { getDb } from "../db";
import { pushSubscriptions, settings } from "../schema";
import { ensureVapidKeys, resolveVapidSubject } from "../notify";
import { sendWebPush } from "../vapid";
import { requireAdmin } from "../auth";

const r = new Hono<{ Bindings: Env }>();

// ── Public ────────────────────────────────────────────────────────────────────

r.get("/vapid-public-key", async (c) => {
  const db = getDb(c.env);
  const publicKey = await ensureVapidKeys(db);
  return c.json({ publicKey });
});

// Anyone visiting the public status page can subscribe.
// On the public page an unsubscribe is done by clearing the local subscription.
r.post("/subscribe", async (c) => {
  const body = await c.req.json<{
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
    deviceName?: string;
  }>();

  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return c.json({ error: "endpoint, keys.p256dh, keys.auth required" }, 400);
  }

  const db = getDb(c.env);
  const deviceName = body.deviceName?.trim() || "Unknown device";
  const now = Date.now();

  const existing = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, body.endpoint))
    .limit(1);

  if (existing[0]) {
    await db
      .update(pushSubscriptions)
      .set({ p256dh: body.keys.p256dh, auth: body.keys.auth, deviceName })
      .where(eq(pushSubscriptions.endpoint, body.endpoint));
    return c.json({ ok: true, id: existing[0].id });
  }

  const [row] = await db
    .insert(pushSubscriptions)
    .values({
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      deviceName,
      createdAt: now,
    })
    .returning();

  return c.json({ ok: true, id: row!.id });
});

// Unsubscribe by endpoint (client sends its own endpoint to remove)
r.post("/unsubscribe", async (c) => {
  const { endpoint } = await c.req.json<{ endpoint?: string }>();
  if (!endpoint) return c.json({ error: "endpoint required" }, 400);
  const db = getDb(c.env);
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  return c.json({ ok: true });
});

// ── Admin-only ────────────────────────────────────────────────────────────────

r.get("/subscriptions", requireAdmin, async (c) => {
  const db = getDb(c.env);
  const rows = await db
    .select({
      id: pushSubscriptions.id,
      deviceName: pushSubscriptions.deviceName,
      createdAt: pushSubscriptions.createdAt,
    })
    .from(pushSubscriptions)
    .all();
  return c.json({ subscriptions: rows });
});

r.delete("/subscriptions/:id", requireAdmin, async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = getDb(c.env);
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
  return c.json({ ok: true });
});

r.post("/test", requireAdmin, async (c) => {
  const db = getDb(c.env);
  const [cfg] = await db.select().from(settings).limit(1);

  if (!cfg?.vapidPrivateJwk || !cfg?.vapidPublicKey) {
    return c.json({ error: "VAPID keys not configured" }, 400);
  }

  const subs = await db.select().from(pushSubscriptions).all();
  if (!subs.length) return c.json({ error: "No subscriptions registered" }, 400);

  const jwk = JSON.parse(cfg.vapidPrivateJwk) as JsonWebKey;
  const subject = resolveVapidSubject(cfg.vapidSubject, c.env);

  const deadIds: number[] = [];
  await Promise.all(
    subs.map(async (sub) => {
      const alive = await sendWebPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        {
          title: "Statch test",
          body: "Push notifications are working!",
          icon: "/favicon.svg",
          tag: "test",
          url: "/",
        },
        jwk,
        cfg.vapidPublicKey!,
        subject
      );
      if (!alive) deadIds.push(sub.id);
    })
  );

  for (const id of deadIds) {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
  }

  return c.json({ ok: true, sent: subs.length - deadIds.length, removed: deadIds.length });
});

r.patch("/vapid-subject", requireAdmin, async (c) => {
  const { subject } = await c.req.json<{ subject?: string }>();
  if (!subject?.trim()) return c.json({ error: "subject required" }, 400);
  const db = getDb(c.env);
  await db.update(settings).set({ vapidSubject: subject.trim() }).where(eq(settings.id, 1));
  return c.json({ ok: true });
});

export const pushRouter = r;
