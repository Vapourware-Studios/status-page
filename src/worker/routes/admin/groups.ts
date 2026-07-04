import { Hono } from "hono";
import { eq, asc } from "drizzle-orm";
import type { Env } from "../../types";
import { getDb } from "../../db";
import { monitorGroups, monitors } from "../../schema";

const r = new Hono<{ Bindings: Env }>();

r.get("/", async (c) => {
  const db = getDb(c.env);
  const rows = await db
    .select()
    .from(monitorGroups)
    .orderBy(asc(monitorGroups.sortOrder), asc(monitorGroups.createdAt))
    .all();
  return c.json({ groups: rows });
});

r.post("/", async (c) => {
  const { name } = await c.req.json<{ name?: string }>();
  if (!name?.trim()) return c.json({ error: "name required" }, 400);

  const db = getDb(c.env);
  const existing = await db.select({ sortOrder: monitorGroups.sortOrder }).from(monitorGroups).all();
  const maxOrder = existing.length > 0
    ? Math.max(...existing.map((g) => g.sortOrder)) + 1
    : 0;

  const [row] = await db
    .insert(monitorGroups)
    .values({ name: name.trim(), sortOrder: maxOrder, createdAt: Date.now() })
    .returning();

  return c.json({ ok: true, group: row });
});

r.patch("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json<{ name?: string; sortOrder?: number }>();

  const db = getDb(c.env);
  type Patch = { name?: string; sortOrder?: number };
  const patch: Patch = {};
  if (body.name != null) patch.name = body.name.trim();
  if (body.sortOrder != null) patch.sortOrder = body.sortOrder;

  await db.update(monitorGroups).set(patch).where(eq(monitorGroups.id, id));
  return c.json({ ok: true });
});

r.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = getDb(c.env);
  // Un-assign monitors from this group before deleting
  await db
    .update(monitors)
    .set({ groupId: null })
    .where(eq(monitors.groupId, id));
  await db.delete(monitorGroups).where(eq(monitorGroups.id, id));
  return c.json({ ok: true });
});

// Assign a monitor to a group (or null to ungroup)
r.post("/assign", async (c) => {
  const { monitorId, groupId } = await c.req.json<{
    monitorId?: string;
    groupId?: number | null;
  }>();
  if (!monitorId) return c.json({ error: "monitorId required" }, 400);

  const db = getDb(c.env);
  await db
    .update(monitors)
    .set({ groupId: groupId ?? null })
    .where(eq(monitors.id, monitorId));
  return c.json({ ok: true });
});

export const groupsAdminRouter = r;
