import { eq, ne, and, gte, lte } from "drizzle-orm";
import type { Db } from "./db";
import { monitors, incidents, maintenanceWindows } from "./schema";
import type { OgStatus } from "./ogimage";

export type PageStatus = {
  status: OgStatus;
  /** Human label, e.g. "All Systems Operational". */
  label: string;
  /** Hex color for the Discord <meta theme-color> accent bar. */
  themeColor: string;
  total: number;
  upCount: number;
  downCount: number;
};

const LABELS: Record<OgStatus, string> = {
  operational: "All Systems Operational",
  partial_outage: "Partial Outage",
  major_outage: "Major Outage",
  maintenance: "Under Maintenance",
};

const THEME_COLORS: Record<OgStatus, string> = {
  operational: "#22c55e",
  partial_outage: "#f59e0b",
  major_outage: "#ef4444",
  maintenance: "#94a3b8",
};

type MonitorRow = { type: string; status: string; lastSeenAt: number | null; graceSeconds: number };
type Live = "up" | "degraded" | "down" | "paused";

function liveStatus(m: MonitorRow, now: number): Live {
  if (m.status === "paused") return "paused";
  if (m.type === "push") return !m.lastSeenAt || now - m.lastSeenAt > m.graceSeconds * 1000 ? "down" : "up";
  return m.status as Live;
}

/**
 * Overall status shown in embeds. Priority (per product decision):
 * active incident  >  active maintenance  >  monitors down  >  operational.
 * When both an incident and maintenance are active, the incident wins.
 */
export async function getPageStatus(db: Db, now = Date.now()): Promise<PageStatus> {
  const [allMonitors, activeIncidents, activeMaintenance] = await Promise.all([
    db
      .select({ type: monitors.type, status: monitors.status, lastSeenAt: monitors.lastSeenAt, graceSeconds: monitors.graceSeconds })
      .from(monitors)
      .where(eq(monitors.claimed, true))
      .all(),
    db
      .select({ impact: incidents.impact })
      .from(incidents)
      .where(ne(incidents.status, "resolved"))
      .all()
      .catch(() => [] as { impact: string }[]),
    db
      .select({ id: maintenanceWindows.id })
      .from(maintenanceWindows)
      .where(
        and(
          ne(maintenanceWindows.status, "completed"),
          ne(maintenanceWindows.status, "cancelled"),
          lte(maintenanceWindows.startTime, now),
          gte(maintenanceWindows.endTime, now)
        )
      )
      .all()
      .catch(() => [] as { id: number }[]),
  ]);

  const live = allMonitors.map((m) => liveStatus(m, now));
  const total = live.length;
  const upCount = live.filter((s) => s === "up").length;
  const downCount = live.filter((s) => s === "down").length;
  const degradedCount = live.filter((s) => s === "degraded").length;

  let status: OgStatus;
  if (activeIncidents.length > 0) {
    const worst = activeIncidents.some((i) => i.impact === "critical" || i.impact === "major");
    status = worst ? "major_outage" : "partial_outage";
  } else if (activeMaintenance.length > 0) {
    status = "maintenance";
  } else if (downCount > 0) {
    status = downCount < total / 2 ? "partial_outage" : "major_outage";
  } else if (degradedCount > 0) {
    // Everything's reachable, just cranky and slow.
    status = "partial_outage";
  } else {
    status = "operational";
  }

  return { status, label: LABELS[status], themeColor: THEME_COLORS[status], total, upCount, downCount };
}
