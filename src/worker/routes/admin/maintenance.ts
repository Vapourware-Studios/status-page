import { Hono } from "hono";
import { eq, ne, desc, and, gte, lte } from "drizzle-orm";
import type { Env } from "../../types";
import { getDb } from "../../db";
import { maintenanceWindows } from "../../schema";

const r = new Hono<{ Bindings: Env }>();

function parseMonitorIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

r.get("/", async (c) => {
  const db = getDb(c.env);
  const rows = await db
    .select()
    .from(maintenanceWindows)
    .where(ne(maintenanceWindows.status, "cancelled"))
    .orderBy(desc(maintenanceWindows.startTime))
    .limit(50)
    .all();

  return c.json({
    maintenance: rows.map((w) => ({ ...w, monitorIds: parseMonitorIds(w.monitorIds) })),
  });
});

r.post("/", async (c) => {
  const body = await c.req.json<{
    title?: string;
    description?: string;
    startTime?: number;
    endTime?: number;
    monitorIds?: string[];
  }>();

  if (!body.title?.trim()) return c.json({ error: "title required" }, 400);
  if (!body.startTime || !body.endTime) return c.json({ error: "startTime and endTime required" }, 400);
  if (body.startTime >= body.endTime) return c.json({ error: "startTime must be before endTime" }, 400);

  const db = getDb(c.env);
  const now = Date.now();

  const status: "scheduled" | "active" =
    body.startTime <= now && body.endTime > now ? "active" : "scheduled";

  const [row] = await db
    .insert(maintenanceWindows)
    .values({
      title: body.title.trim(),
      description: body.description?.trim() ?? null,
      startTime: body.startTime,
      endTime: body.endTime,
      monitorIds: body.monitorIds?.length ? JSON.stringify(body.monitorIds) : null,
      status,
      createdAt: now,
    })
    .returning();

  return c.json({ ok: true, id: row!.id });
});

r.patch("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json<{
    title?: string;
    description?: string;
    startTime?: number;
    endTime?: number;
    monitorIds?: string[];
    status?: "scheduled" | "active" | "completed" | "cancelled";
  }>();

  const db = getDb(c.env);
  const [existing] = await db
    .select()
    .from(maintenanceWindows)
    .where(eq(maintenanceWindows.id, id))
    .limit(1);
  if (!existing) return c.json({ error: "Not found" }, 404);

  type Patch = {
    title?: string;
    description?: string | null;
    startTime?: number;
    endTime?: number;
    monitorIds?: string | null;
    status?: "scheduled" | "active" | "completed" | "cancelled";
  };
  const patch: Patch = {};
  if (body.title != null) patch.title = body.title.trim();
  if ("description" in body) patch.description = body.description?.trim() ?? null;
  if (body.startTime != null) patch.startTime = body.startTime;
  if (body.endTime != null) patch.endTime = body.endTime;
  if (body.monitorIds != null)
    patch.monitorIds = body.monitorIds.length ? JSON.stringify(body.monitorIds) : null;
  if (body.status != null) patch.status = body.status;

  await db.update(maintenanceWindows).set(patch).where(eq(maintenanceWindows.id, id));
  return c.json({ ok: true });
});

r.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = getDb(c.env);
  await db.delete(maintenanceWindows).where(eq(maintenanceWindows.id, id));
  return c.json({ ok: true });
});

export const maintenanceAdminRouter = r;

// Check if a monitor is in an active maintenance window
export async function isMonitorInMaintenance(db: ReturnType<typeof getDb>, monitorId: string, now: number): Promise<boolean> {
  const active = await db
    .select({ monitorIds: maintenanceWindows.monitorIds })
    .from(maintenanceWindows)
    .where(
      and(
        eq(maintenanceWindows.status, "active"),
        lte(maintenanceWindows.startTime, now),
        gte(maintenanceWindows.endTime, now)
      )
    )
    .all();

  return active.some((w) => {
    const ids = parseMonitorIds(w.monitorIds);
    return ids.length === 0 || ids.includes(monitorId);
  });
}
