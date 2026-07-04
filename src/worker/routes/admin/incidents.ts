import { Hono } from "hono";
import { eq, desc, inArray } from "drizzle-orm";
import type { Env } from "../../types";
import { getDb } from "../../db";
import { incidents, incidentUpdates, incidentMonitors } from "../../schema";
import { notifyIncident } from "../../notify";

const r = new Hono<{ Bindings: Env }>();

function parseImageUrls(raw: string | null): string[] {
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
    .from(incidents)
    .orderBy(desc(incidents.createdAt))
    .limit(50);

  const ids = rows.map((r) => r.id);
  const [updates, affected] =
    ids.length > 0
      ? await Promise.all([
          db
            .select()
            .from(incidentUpdates)
            .where(inArray(incidentUpdates.incidentId, ids))
            .orderBy(desc(incidentUpdates.createdAt))
            .all(),
          db
            .select()
            .from(incidentMonitors)
            .where(inArray(incidentMonitors.incidentId, ids))
            .all(),
        ])
      : [[], []];

  const result = rows.map((inc) => ({
    ...inc,
    updates: updates
      .filter((u) => u.incidentId === inc.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((u) => ({ ...u, imageUrls: parseImageUrls(u.imageUrls) })),
    affectedMonitors: affected
      .filter((r) => r.incidentId === inc.id)
      .map((r) => r.monitorId),
  }));

  return c.json({ incidents: result });
});

r.post("/", async (c) => {
  const body = await c.req.json<{
    title?: string;
    impact?: "none" | "minor" | "major" | "critical";
    initialUpdate?: string;
    monitorIds?: string[];
  }>();

  if (!body.title?.trim()) return c.json({ error: "title required" }, 400);
  if (!body.initialUpdate?.trim()) return c.json({ error: "initialUpdate required" }, 400);

  const db = getDb(c.env);
  const now = Date.now();

  const [inc] = await db
    .insert(incidents)
    .values({
      title: body.title.trim(),
      status: "investigating",
      impact: body.impact ?? "minor",
      createdAt: now,
    })
    .returning();

  if (!inc) return c.json({ error: "Insert failed" }, 500);

  await db.insert(incidentUpdates).values({
    incidentId: inc.id,
    status: "investigating",
    body: body.initialUpdate.trim(),
    createdAt: now,
  });

  if (body.monitorIds?.length) {
    await db.insert(incidentMonitors).values(
      body.monitorIds.map((mid) => ({ incidentId: inc.id, monitorId: mid }))
    );
  }

  await notifyIncident(
    db,
    c.env,
    inc.id,
    inc.title,
    "created",
    inc.impact,
    "investigating",
    body.initialUpdate?.trim()
  );

  return c.json({ ok: true, incidentId: inc.id });
});

r.patch("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json<{
    title?: string;
    status?: "investigating" | "identified" | "monitoring" | "resolved";
    impact?: "none" | "minor" | "major" | "critical";
  }>();

  const db = getDb(c.env);
  const [inc] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, id))
    .limit(1);
  if (!inc) return c.json({ error: "Not found" }, 404);

  type IncidentPatch = {
    title?: string;
    status?: "investigating" | "identified" | "monitoring" | "resolved";
    impact?: "none" | "minor" | "major" | "critical";
    resolvedAt?: number | null;
  };
  const patch: IncidentPatch = {};
  if (body.title != null) patch.title = body.title.trim();
  if (body.status != null) patch.status = body.status;
  if (body.impact != null) patch.impact = body.impact;
  if (body.status === "resolved" && !inc.resolvedAt) patch.resolvedAt = Date.now();

  await db.update(incidents).set(patch).where(eq(incidents.id, id));

  if (body.status === "resolved" && inc.status !== "resolved") {
    await notifyIncident(
      db,
      c.env,
      inc.id,
      inc.title,
      "resolved",
      body.impact ?? inc.impact,
      "resolved"
    );
  }

  return c.json({ ok: true });
});

r.post("/:id/updates", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json<{
    status?: "investigating" | "identified" | "monitoring" | "resolved";
    body?: string;
    imageUrls?: string[];
  }>();

  if (!body.status || !body.body?.trim()) {
    return c.json({ error: "status and body required" }, 400);
  }

  const db = getDb(c.env);
  const [inc] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, id))
    .limit(1);
  if (!inc) return c.json({ error: "Not found" }, 404);

  const imageUrls = Array.isArray(body.imageUrls)
    ? body.imageUrls.filter((u) => typeof u === "string" && u.trim())
    : [];
  const updateBody = body.body!.trim();
  const updateStatus = body.status!;
  const now = Date.now();

  await db.insert(incidentUpdates).values({
    incidentId: id,
    status: updateStatus,
    body: updateBody,
    imageUrls: imageUrls.length > 0 ? JSON.stringify(imageUrls) : null,
    createdAt: now,
  });

  await db
    .update(incidents)
    .set({
      status: updateStatus,
      ...(updateStatus === "resolved" && !inc.resolvedAt ? { resolvedAt: now } : {}),
    })
    .where(eq(incidents.id, id));

  await notifyIncident(
    db,
    c.env,
    inc.id,
    inc.title,
    updateStatus === "resolved" ? "resolved" : "updated",
    inc.impact,
    updateStatus,
    updateBody
  );

  return c.json({ ok: true });
});

r.put("/:id/monitors", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const { monitorIds } = await c.req.json<{ monitorIds?: string[] }>();
  if (!Array.isArray(monitorIds)) return c.json({ error: "monitorIds array required" }, 400);
  const db = getDb(c.env);
  await db.delete(incidentMonitors).where(eq(incidentMonitors.incidentId, id));
  if (monitorIds.length > 0) {
    await db.insert(incidentMonitors).values(
      monitorIds.map((mid) => ({ incidentId: id, monitorId: mid }))
    );
  }
  return c.json({ ok: true });
});

r.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = getDb(c.env);
  await db.delete(incidents).where(eq(incidents.id, id));
  return c.json({ ok: true });
});

export const incidentsAdminRouter = r;
