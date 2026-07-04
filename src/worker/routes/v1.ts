import { Hono } from "hono";
import { eq, ne, gte, lte, desc, inArray, and, asc } from "drizzle-orm";
import type { Env } from "../types";
import { getDb } from "../db";
import {
  monitors,
  events,
  incidents,
  incidentMonitors,
  settings,
  maintenanceWindows,
} from "../schema";
import { computeUptime, WINDOW_24H, WINDOW_7D, WINDOW_90D, groupEventsByMonitor } from "../uptime";

// ── Public, no-auth API. Anyone may call these cross-origin (CORS is open on
// /api/*). Shapes here are kept small and stable so external sites can rely on
// them — internal /api/status may change shape, /api/v1/* should not.

export const v1Router = new Hono<{ Bindings: Env }>();

function parseMonitorIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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

const statusDescription: Record<string, string> = {
  operational: "All systems operational",
  maintenance: "Maintenance in progress",
  partial_outage: "Some systems are experiencing issues",
  major_outage: "Major service outage",
};

// Shared loader: live monitor states + active incidents + active maintenance.
async function loadState(env: Env) {
  const db = getDb(env);
  const now = Date.now();

  const [cfg, allMonitors, activeIncidentRows, maintenanceRows] = await Promise.all([
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
    db
      .select()
      .from(maintenanceWindows)
      .where(
        and(
          eq(maintenanceWindows.status, "active"),
          gte(maintenanceWindows.endTime, now),
          lte(maintenanceWindows.startTime, now)
        )
      )
      .all()
      .catch(() => []),
  ]);

  // Which monitors are currently inside an active maintenance window.
  const maintenanceIds = new Set<string>();
  for (const w of maintenanceRows) {
    const ids = parseMonitorIds(w.monitorIds);
    if (ids.length === 0) allMonitors.forEach((m) => maintenanceIds.add(m.id));
    else ids.forEach((id) => maintenanceIds.add(id));
  }

  return { db, now, page: cfg[0], allMonitors, activeIncidentRows, maintenanceIds };
}

// Map an incident id -> list of affected monitor names.
async function affectedNamesByIncident(
  env: Env,
  incidentIds: number[],
  nameById: Map<string, string>
): Promise<Map<number, string[]>> {
  const result = new Map<number, string[]>();
  if (incidentIds.length === 0) return result;
  const db = getDb(env);
  const rows = await db
    .select()
    .from(incidentMonitors)
    .where(inArray(incidentMonitors.incidentId, incidentIds))
    .all();
  for (const r of rows) {
    const arr = result.get(r.incidentId) ?? [];
    arr.push(nameById.get(r.monitorId) ?? r.monitorId);
    result.set(r.incidentId, arr);
  }
  return result;
}

// ── GET /api/v1/summary ───────────────────────────────────────────────────────
// The headline endpoint: are we fully operational, and if not, what is down and
// what incidents are open. Designed to power a badge or a one-line status check.
v1Router.get("/summary", async (c) => {
  const { env } = c;
  const { now, page, allMonitors, activeIncidentRows, maintenanceIds } = await loadState(env);

  const nameById = new Map<string, string>();
  for (const m of allMonitors) nameById.set(m.id, m.name ?? m.id);

  // Effective status per monitor (maintenance overrides up/down).
  const live = allMonitors.map((m) => {
    const base = computeLiveStatus(m, now);
    const effective = maintenanceIds.has(m.id) ? "maintenance" : base;
    return { id: m.id, name: m.name ?? m.id, status: effective };
  });

  const downCount = live.filter((m) => m.status === "down").length;
  const anyMaintenance = live.some((m) => m.status === "maintenance");

  let status: string;
  if (downCount === 0) status = anyMaintenance ? "maintenance" : "operational";
  else if (downCount < allMonitors.length / 2) status = "partial_outage";
  else status = "major_outage";

  // "What is NOT operational" — anything that is not fully up.
  const affected = live
    .filter((m) => m.status !== "up" && m.status !== "paused")
    .map((m) => ({ id: m.id, name: m.name, status: m.status }));

  const incidentIds = activeIncidentRows.map((i) => i.id);
  const affNames = await affectedNamesByIncident(env, incidentIds, nameById);

  const base = env.SERVER_URL.replace(/\/$/, "");
  const activeIncidents = activeIncidentRows.map((inc) => ({
    id: inc.id,
    title: inc.title,
    impact: inc.impact,
    status: inc.status,
    startedAt: inc.createdAt,
    affected: affNames.get(inc.id) ?? [],
    url: `${base}/incidents/${inc.id}`,
  }));

  return c.json({
    page: page?.pageTitle ?? "System Status",
    status,
    operational: status === "operational",
    description: statusDescription[status] ?? "Unknown",
    affected,
    incidents: activeIncidents,
    url: base,
    updatedAt: now,
  });
});

// ── GET /api/v1/status ────────────────────────────────────────────────────────
// Per-monitor breakdown with uptime numbers.
v1Router.get("/status", async (c) => {
  const { env } = c;
  const { db, now, page, allMonitors, maintenanceIds } = await loadState(env);

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
  const eventsByMonitor = groupEventsByMonitor(allEvents);

  const list = allMonitors.map((m) => {
    const base = computeLiveStatus(m, now);
    const ev = eventsByMonitor.get(m.id) ?? [];
    return {
      id: m.id,
      name: m.name ?? m.id,
      type: m.type,
      status: maintenanceIds.has(m.id) ? "maintenance" : base,
      uptime24h: computeUptime(ev, m.createdAt, WINDOW_24H, now),
      uptime7d: computeUptime(ev, m.createdAt, WINDOW_7D, now),
      uptime90d: computeUptime(ev, m.createdAt, WINDOW_90D, now),
    };
  });

  return c.json({
    page: page?.pageTitle ?? "System Status",
    monitors: list,
    updatedAt: now,
  });
});

// ── GET /api/v1/incidents ─────────────────────────────────────────────────────
// Recent incidents, newest first. ?active=1 limits to unresolved ones.
v1Router.get("/incidents", async (c) => {
  const { env } = c;
  const db = getDb(env);
  const onlyActive = c.req.query("active") === "1";
  const base = env.SERVER_URL.replace(/\/$/, "");

  const rows = await db
    .select()
    .from(incidents)
    .where(onlyActive ? ne(incidents.status, "resolved") : undefined)
    .orderBy(desc(incidents.createdAt))
    .limit(50)
    .all();

  const ids = rows.map((r) => r.id);
  const nameRows =
    ids.length > 0
      ? await db
          .select({ id: monitors.id, name: monitors.name })
          .from(monitors)
          .all()
      : [];
  const nameById = new Map<string, string>();
  for (const r of nameRows) nameById.set(r.id, r.name ?? r.id);
  const affNames = await affectedNamesByIncident(env, ids, nameById);

  const result = rows.map((inc) => ({
    id: inc.id,
    title: inc.title,
    impact: inc.impact,
    status: inc.status,
    startedAt: inc.createdAt,
    resolvedAt: inc.resolvedAt,
    affected: affNames.get(inc.id) ?? [],
    url: `${base}/incidents/${inc.id}`,
  }));

  return c.json({ incidents: result, updatedAt: Date.now() });
});

// ── GET /api/v1 ───────────────────────────────────────────────────────────────
// Self-describing index so the API is discoverable.
v1Router.get("/", (c) => {
  const base = c.env.SERVER_URL.replace(/\/$/, "");
  return c.json({
    name: "Statch public API",
    version: "1",
    endpoints: {
      summary: `${base}/api/v1/summary`,
      status: `${base}/api/v1/status`,
      incidents: `${base}/api/v1/incidents`,
    },
    embed: `${base}/embed.js`,
    docs: base,
  });
});
