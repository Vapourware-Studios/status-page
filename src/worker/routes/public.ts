import { Hono } from "hono";
import { eq, ne, gte, desc, inArray, and, lte, asc } from "drizzle-orm";
import type { Env } from "../types";
import { getDb } from "../db";
import {
  monitors,
  events,
  incidents,
  incidentUpdates,
  incidentMonitors,
  settings,
  maintenanceWindows,
  monitorGroups,
} from "../schema";
import {
  computeUptime,
  computeDailyBuckets,
  WINDOW_24H,
  WINDOW_7D,
  WINDOW_90D,
  groupEventsByMonitor,
} from "../uptime";

export const publicRouter = new Hono<{ Bindings: Env }>();

function parseMonitorIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseImageUrls(raw: string | null): string[] {
  return parseMonitorIds(raw);
}

function computeLiveStatus(
  m: { type: string; status: string; lastSeenAt: number | null; graceSeconds: number },
  now: number
): "up" | "down" | "paused" {
  if (m.status === "paused") return "paused";
  if (m.type === "push") {
    if (!m.lastSeenAt) return "down";
    return now - m.lastSeenAt > m.graceSeconds * 1000 ? "down" : "up";
  }
  return (m.status as "up" | "down") ?? "down";
}

publicRouter.get("/status", async (c) => {
  const db = getDb(c.env);
  const now = Date.now();

  const [cfg, allMonitors, activeIncidentRows, maintenanceResult, groupsResult] = await Promise.all([
    db.select().from(settings).limit(1),
    db
      .select()
      .from(monitors)
      .where(eq(monitors.claimed, true))
      .orderBy(monitors.sortOrder, monitors.createdAt),
    db
      .select()
      .from(incidents)
      .where(ne(incidents.status, "resolved"))
      .orderBy(desc(incidents.createdAt)),
    // active + scheduled within next 24h — guarded: table may not exist before migration
    db
      .select()
      .from(maintenanceWindows)
      .where(
        and(
          ne(maintenanceWindows.status, "completed"),
          ne(maintenanceWindows.status, "cancelled"),
          gte(maintenanceWindows.endTime, now),
          lte(maintenanceWindows.startTime, now + 24 * 60 * 60 * 1000)
        )
      )
      .orderBy(asc(maintenanceWindows.startTime))
      .all()
      .catch(() => []),
    db.select().from(monitorGroups).orderBy(asc(monitorGroups.sortOrder)).all().catch(() => []),
  ]);

  const activeMaintenanceRows = maintenanceResult;
  const allGroups = groupsResult;

  const page = cfg[0] ?? { pageTitle: "System Status", headline: "" };

  const cutoff = now - WINDOW_90D;
  const allEvents =
    allMonitors.length > 0
      ? await db
          .select()
          .from(events)
          .where(gte(events.createdAt, cutoff))
          .orderBy(events.monitorId, events.createdAt)
          .all()
      : [];

  // Latency is rendered live in the browser from lastLatencyMs — no longer stored.

  // Build active maintenance monitor set
  const activeMaintenanceMonitorIds = new Set<string>();
  for (const w of activeMaintenanceRows) {
    if (w.status !== "active") continue;
    const ids = parseMonitorIds(w.monitorIds);
    if (ids.length === 0) {
      // affects all monitors
      allMonitors.forEach((m) => activeMaintenanceMonitorIds.add(m.id));
    } else {
      ids.forEach((id) => activeMaintenanceMonitorIds.add(id));
    }
  }

  const eventsByMonitor = groupEventsByMonitor(allEvents);

  const monitorList = allMonitors.map((m) => ({
    id: m.id,
    name: m.name,
    type: m.type,
    groupId: (m as { groupId?: number | null }).groupId ?? null,
    status: computeLiveStatus(m, now),
    inMaintenance: activeMaintenanceMonitorIds.has(m.id),
    lastLatencyMs: m.lastLatencyMs,
    uptime24h: computeUptime(eventsByMonitor.get(m.id) ?? [], m.createdAt, WINDOW_24H, now),
    uptime7d: computeUptime(eventsByMonitor.get(m.id) ?? [], m.createdAt, WINDOW_7D, now),
    uptime90d: computeUptime(eventsByMonitor.get(m.id) ?? [], m.createdAt, WINDOW_90D, now),
    dailyBuckets: computeDailyBuckets(eventsByMonitor.get(m.id) ?? [], m.createdAt, 90, now),
    externalStatusLabel: (m as { externalStatusLabel?: string | null }).externalStatusLabel ?? null,
    externalStatusUrl: (m as { externalStatusUrl?: string | null }).externalStatusUrl ?? null,
  }));

  const effectiveStatuses = monitorList.map((m) =>
    m.inMaintenance ? "maintenance" : m.status
  );
  const downCount = effectiveStatuses.filter((s) => s === "down").length;
  const overall =
    downCount === 0
      ? "operational"
      : downCount < monitorList.length / 2
      ? "partial_outage"
      : "major_outage";

  const incidentIds = activeIncidentRows.map((i) => i.id);
  const [updateRows, affectedRows] =
    incidentIds.length > 0
      ? await Promise.all([
          db
            .select()
            .from(incidentUpdates)
            .where(inArray(incidentUpdates.incidentId, incidentIds))
            .orderBy(desc(incidentUpdates.createdAt))
            .all(),
          db
            .select()
            .from(incidentMonitors)
            .where(inArray(incidentMonitors.incidentId, incidentIds))
            .all(),
        ])
      : [[], []];

  const updatesByIncident = new Map<number, typeof updateRows>();
  for (const u of updateRows) {
    const arr = updatesByIncident.get(u.incidentId) ?? [];
    arr.push(u);
    updatesByIncident.set(u.incidentId, arr);
  }

  const activeIncidents = activeIncidentRows.map((inc) => ({
    id: inc.id,
    title: inc.title,
    status: inc.status,
    impact: inc.impact,
    createdAt: inc.createdAt,
    resolvedAt: inc.resolvedAt,
    updates: (updatesByIncident.get(inc.id) ?? [])
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((u) => ({ ...u, imageUrls: parseImageUrls(u.imageUrls) })),
    affectedMonitors: affectedRows
      .filter((r) => r.incidentId === inc.id)
      .map((r) => r.monitorId),
  }));

  const maintenance = activeMaintenanceRows.map((w) => ({
    id: w.id,
    title: w.title,
    description: w.description,
    startTime: w.startTime,
    endTime: w.endTime,
    monitorIds: parseMonitorIds(w.monitorIds),
    status: w.status,
  }));

  const groups = allGroups.map((g) => ({
    id: g.id,
    name: g.name,
    sortOrder: g.sortOrder,
  }));

  return c.json({
    page: { title: page.pageTitle, headline: page.headline },
    overall,
    monitors: monitorList,
    activeIncidents,
    maintenance,
    groups,
  });
});

interface OutageSpell {
  start: number;
  end: number | null;
  durationMs: number;
  message: string | null;
  ongoing: boolean;
}

// Derive down spells from a monitor's chronological event log. A "down" event
// opens a spell; the next non-down event (or now, if still down) closes it.
function computeOutages(
  evAsc: { status: string; createdAt: number; message: string | null }[],
  now: number
): OutageSpell[] {
  const out: OutageSpell[] = [];
  let openStart: number | null = null;
  let openMsg: string | null = null;
  for (const e of evAsc) {
    if (e.status === "down") {
      if (openStart === null) {
        openStart = e.createdAt;
        openMsg = e.message;
      }
    } else if (openStart !== null) {
      out.push({
        start: openStart,
        end: e.createdAt,
        durationMs: e.createdAt - openStart,
        message: openMsg,
        ongoing: false,
      });
      openStart = null;
      openMsg = null;
    }
  }
  if (openStart !== null) {
    out.push({ start: openStart, end: null, durationMs: now - openStart, message: openMsg, ongoing: true });
  }
  return out.reverse(); // newest first
}

// Per-monitor detail: uptime, full outage history, and incidents that touched it.
publicRouter.get("/monitors/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c.env);
  const now = Date.now();

  const [m] = await db
    .select()
    .from(monitors)
    .where(and(eq(monitors.id, id), eq(monitors.claimed, true)))
    .limit(1);
  if (!m) return c.json({ error: "Not found" }, 404);

  const allEvents = await db
    .select()
    .from(events)
    .where(eq(events.monitorId, id))
    .orderBy(asc(events.createdAt))
    .all();
  const ev90 = allEvents.filter((e) => e.createdAt >= now - WINDOW_90D);

  const incidentRows = await db
    .select({
      id: incidents.id,
      title: incidents.title,
      impact: incidents.impact,
      status: incidents.status,
      createdAt: incidents.createdAt,
      resolvedAt: incidents.resolvedAt,
    })
    .from(incidentMonitors)
    .innerJoin(incidents, eq(incidentMonitors.incidentId, incidents.id))
    .where(eq(incidentMonitors.monitorId, id))
    .orderBy(desc(incidents.createdAt))
    .all();

  return c.json({
    monitor: {
      id: m.id,
      name: m.name,
      type: m.type,
      status: computeLiveStatus(m, now),
      targetUrl: m.targetUrl,
      externalStatusLabel: (m as { externalStatusLabel?: string | null }).externalStatusLabel ?? null,
      externalStatusUrl: (m as { externalStatusUrl?: string | null }).externalStatusUrl ?? null,
      createdAt: m.createdAt,
      uptime24h: computeUptime(ev90, m.createdAt, WINDOW_24H, now),
      uptime7d: computeUptime(ev90, m.createdAt, WINDOW_7D, now),
      uptime90d: computeUptime(ev90, m.createdAt, WINDOW_90D, now),
      dailyBuckets: computeDailyBuckets(ev90, m.createdAt, 90, now),
      outages: computeOutages(allEvents, now).slice(0, 50),
      incidents: incidentRows,
    },
  });
});

publicRouter.get("/incidents", async (c) => {
  const db = getDb(c.env);
  const page = parseInt(c.req.query("page") ?? "1", 10);
  const limit = 20;
  const offset = (page - 1) * limit;

  const rows = await db
    .select()
    .from(incidents)
    .orderBy(desc(incidents.createdAt))
    .limit(limit)
    .offset(offset);

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

  return c.json({ incidents: result, page, hasMore: rows.length === limit });
});

publicRouter.get("/incidents/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const db = getDb(c.env);
  const [inc] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, id))
    .limit(1);
  if (!inc) return c.json({ error: "Not found" }, 404);

  const [updateRows, affectedRows] = await Promise.all([
    db
      .select()
      .from(incidentUpdates)
      .where(eq(incidentUpdates.incidentId, id))
      .orderBy(desc(incidentUpdates.createdAt))
      .all(),
    db
      .select()
      .from(incidentMonitors)
      .where(eq(incidentMonitors.incidentId, id))
      .all(),
  ]);

  const monitorIds = affectedRows.map((r) => r.monitorId);
  const monitorRows =
    monitorIds.length > 0
      ? await db
          .select({ id: monitors.id, name: monitors.name })
          .from(monitors)
          .where(inArray(monitors.id, monitorIds))
          .all()
      : [];

  return c.json({
    incident: {
      ...inc,
      updates: updateRows.map((u) => ({ ...u, imageUrls: parseImageUrls(u.imageUrls) })),
      affectedMonitors: affectedRows.map((r) => r.monitorId),
      affectedMonitorNames: monitorRows,
    },
  });
});
