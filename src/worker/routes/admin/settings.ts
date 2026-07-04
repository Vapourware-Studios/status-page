import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Env } from "../../types";
import { getDb, type Db } from "../../db";
import { settings } from "../../schema";

const r = new Hono<{ Bindings: Env }>();

r.get("/", async (c) => {
  const db = getDb(c.env);
  const cfg = await getSettings(db);
  return c.json({ settings: cfg });
});

r.patch("/", async (c) => {
  const body = await c.req.json<{
    pageTitle?: string;
    headline?: string;
    discordWebhookUrl?: string | null;
    autoIncidents?: boolean;
  }>();

  const db = getDb(c.env);

  type SettingsUpdate = {
    pageTitle?: string;
    headline?: string;
    discordWebhookUrl?: string | null;
    autoIncidents?: boolean;
  };
  const update: SettingsUpdate = {};
  if (body.pageTitle != null) update.pageTitle = body.pageTitle;
  if (body.headline != null) update.headline = body.headline;
  if ("discordWebhookUrl" in body) update.discordWebhookUrl = body.discordWebhookUrl;
  if (typeof body.autoIncidents === "boolean") update.autoIncidents = body.autoIncidents;

  await db.update(settings).set(update).where(eq(settings.id, 1));
  return c.json({ ok: true });
});

export const settingsAdminRouter = r;

export async function getSettings(db: Db) {
  const [row] = await db.select().from(settings).limit(1);
  return row ?? null;
}
