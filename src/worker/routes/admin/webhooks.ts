import { Hono } from "hono";
import { eq, asc } from "drizzle-orm";
import type { Env } from "../../types";
import { getDb, type Db } from "../../db";
import { webhooks } from "../../schema";
import { testWebhook, notifyTest } from "../../notify";

const r = new Hono<{ Bindings: Env }>();

r.get("/", async (c) => {
  const db = getDb(c.env);
  const rows = await db.select().from(webhooks).orderBy(asc(webhooks.createdAt));
  return c.json({ webhooks: rows });
});

r.post("/", async (c) => {
  const { label, url } = await c.req.json<{ label?: string; url?: string }>();
  if (!label?.trim() || !url?.trim()) {
    return c.json({ error: "label and url required" }, 400);
  }
  try {
    new URL(url);
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }
  const db = getDb(c.env);
  const [row] = await db
    .insert(webhooks)
    .values({ label: label.trim(), url: url.trim(), createdAt: Date.now() })
    .returning();
  return c.json({ ok: true, webhook: row });
});

r.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = getDb(c.env);
  await db.delete(webhooks).where(eq(webhooks.id, id));
  return c.json({ ok: true });
});

// Fire a grouped sample announcement to every webhook + every push device.
r.post("/test-all", async (c) => {
  const db = getDb(c.env);
  const result = await notifyTest(db, c.env);
  return c.json({ ok: true, ...result });
});

// Send sample embeds to one specific webhook.
r.post("/:id/test", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = getDb(c.env);
  const [wh] = await db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1);
  if (!wh) return c.json({ error: "Not found" }, 404);
  await testWebhook(c.env, wh.url);
  return c.json({ ok: true });
});

export const webhooksAdminRouter = r;

export async function getWebhookUrls(db: Db): Promise<string[]> {
  const rows = await db.select({ url: webhooks.url }).from(webhooks);
  return rows.map((r) => r.url);
}
