import { eq, and, lt, ne, lte, gte, desc, inArray } from "drizzle-orm";
import type { Env } from "./types";
import { getDb, type Db } from "./db";
import {
  monitors,
  events,
  maintenanceWindows,
  incidents,
  incidentUpdates,
  incidentMonitors,
  settings,
  enrollTokens,
} from "./schema";
import { checkHttp, type CheckOptions } from "./httpcheck";
import { checkTcp } from "./tcpcheck";
import {
  notifyMonitorTransition,
  notifyAutoIncident,
  notifyIncident,
  notifyMaintenanceStart,
  notifyMaintenanceEnd,
} from "./notify";
import { fmtDuration, type MonitorBrief } from "./discord";
import { checkCloudflareForOutage } from "./cloudflare";
import { reconcileConfig } from "./config";

type Mon = typeof monitors.$inferSelect;
type LiveStatus = "up" | "degraded" | "down" | "paused";

// How often, at most, to persist an unchanged monitor's latency/last-seen.
// Healthy monitors otherwise write nothing — a quiet day touches the DB ~never.
const LATENCY_REFRESH_MS = 15 * 60 * 1000;

interface Transition {
  monitor: Mon;
  from: string;
  to: LiveStatus;
  message?: string;
}

export async function cronHandler(
  _event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  ctx.waitUntil(runSweep(env));
}

async function runSweep(env: Env): Promise<void> {
  const db = getDb(env);
  const now = Date.now();

  // 0. Reconcile config-as-code into the DB (no-op when the file is unchanged).
  await reconcileConfig(db, env, now);

  // 1. GC: unclaimed pending monitors + expired enrolment tokens.
  await db.delete(monitors).where(
    and(
      eq(monitors.claimed, false),
      eq(monitors.status, "pending"),
      lt(monitors.createdAt, now - 3_600_000)
    )
  );
  await db.delete(enrollTokens).where(lt(enrollTokens.expiresAt, now));

  // 2. Update maintenance window statuses
  await tickMaintenanceWindows(db, env, now);

  // How many consecutive failures before we cry wolf.
  const [cfg] = await db.select().from(settings).limit(1);
  const confirmations = Math.max(1, cfg?.confirmations ?? 1);

  // 3. Check active claimed monitors, collecting transitions
  const activeMonitors = await db
    .select()
    .from(monitors)
    .where(and(eq(monitors.claimed, true), ne(monitors.status, "paused")));

  const transitions: Transition[] = [];
  for (const m of activeMonitors) {
    let t: Transition | null = null;
    if (m.type === "push") {
      t = await sweepPushMonitor(m, now, db);
    } else if ((m.type === "http" || m.type === "tcp") && m.targetUrl) {
      t = await sweepHttpOrTcpMonitor(m, now, db, confirmations);
    }
    if (t) transitions.push(t);
  }

  // 4. Dispatch notifications (grouped auto-incidents or per-monitor fallback)
  await dispatchTransitions(db, env, transitions, now);
}

function checkOptionsFor(m: Mon): CheckOptions {
  let expectStatus: number[] | null = null;
  if (m.expectStatus) {
    try {
      const parsed = JSON.parse(m.expectStatus);
      if (Array.isArray(parsed)) expectStatus = parsed.map(Number).filter((n) => !Number.isNaN(n));
    } catch {
      /* ignore malformed */
    }
  }
  return {
    expectStatus,
    expectBody: m.expectBody,
    degradedResponseMs: m.degradedResponseMs,
    checkSsl: m.checkSsl,
  };
}

async function tickMaintenanceWindows(db: Db, env: Env, now: number): Promise<void> {
  // scheduled → active
  const toActivate = await db
    .select()
    .from(maintenanceWindows)
    .where(
      and(
        eq(maintenanceWindows.status, "scheduled"),
        lte(maintenanceWindows.startTime, now),
        gte(maintenanceWindows.endTime, now)
      )
    )
    .all();

  for (const w of toActivate) {
    await db
      .update(maintenanceWindows)
      .set({ status: "active" })
      .where(eq(maintenanceWindows.id, w.id));
    await notifyMaintenanceStart(db, env, w.title, w.description);
  }

  // active → completed
  const toComplete = await db
    .select()
    .from(maintenanceWindows)
    .where(and(eq(maintenanceWindows.status, "active"), lt(maintenanceWindows.endTime, now)))
    .all();

  for (const w of toComplete) {
    await db
      .update(maintenanceWindows)
      .set({ status: "completed" })
      .where(eq(maintenanceWindows.id, w.id));
    await notifyMaintenanceEnd(db, env, w.title);
  }
}

async function maintenanceSet(db: Db): Promise<{ all: boolean; ids: Set<string> }> {
  const active = await db
    .select({ monitorIds: maintenanceWindows.monitorIds })
    .from(maintenanceWindows)
    .where(eq(maintenanceWindows.status, "active"))
    .all();

  const ids = new Set<string>();
  for (const w of active) {
    if (!w.monitorIds) return { all: true, ids };
    try {
      const parsed = JSON.parse(w.monitorIds) as string[];
      if (parsed.length === 0) return { all: true, ids };
      parsed.forEach((id) => ids.add(id));
    } catch {
      /* ignore malformed */
    }
  }
  return { all: false, ids };
}

async function sweepPushMonitor(m: Mon, now: number, db: Db): Promise<Transition | null> {
  const liveStatus: "up" | "down" =
    m.lastSeenAt != null && now - m.lastSeenAt <= m.graceSeconds * 1000 ? "up" : "down";

  if (liveStatus === m.status) return null;

  await db.update(monitors).set({ status: liveStatus }).where(eq(monitors.id, m.id));
  const message =
    liveStatus === "down" ? `No heartbeat for > ${m.graceSeconds}s` : "Heartbeat resumed";
  await db.insert(events).values({
    monitorId: m.id,
    status: liveStatus,
    message,
    createdAt: now,
  });

  return { monitor: m, from: m.status, to: liveStatus, message };
}

async function sweepHttpOrTcpMonitor(
  m: Mon,
  now: number,
  db: Db,
  confirmations: number
): Promise<Transition | null> {
  const result =
    m.type === "tcp"
      ? await checkTcp(m.targetUrl!, { degradedResponseMs: m.degradedResponseMs })
      : await checkHttp(m.targetUrl!, checkOptionsFor(m));

  // ── Confirmations: a single bad check doesn't cry "down" — we require N
  //    consecutive failures. Flaky networks stay quiet; real outages still fire.
  const failing = result.status === "down";
  const newFail = failing ? m.failCount + 1 : 0;

  let effective: LiveStatus;
  if (failing) {
    // Only flip to "down" once the failure is confirmed; otherwise hold the line.
    effective = newFail >= confirmations ? "down" : m.status === "pending" ? "up" : (m.status as LiveStatus);
  } else {
    effective = result.status; // "up" or "degraded"
  }

  const statusChanged = effective !== m.status;
  const failChanged = newFail !== m.failCount;
  const stale = m.lastSeenAt == null || now - m.lastSeenAt > LATENCY_REFRESH_MS;

  // Write policy: only touch the row on a real change or an occasional refresh.
  // Steady-state healthy monitors barely write at all.
  if (statusChanged || failChanged || stale) {
    await db
      .update(monitors)
      .set({
        lastSeenAt: now,
        lastLatencyMs: result.latencyMs,
        ...(statusChanged ? { status: effective } : {}),
        ...(failChanged ? { failCount: newFail } : {}),
      })
      .where(eq(monitors.id, m.id));
  }

  if (!statusChanged) return null;

  await db.insert(events).values({
    monitorId: m.id,
    status: effective,
    message: result.message,
    createdAt: now,
  });

  // attach fresh latency so the embed shows it
  return {
    monitor: { ...m, lastLatencyMs: result.latencyMs },
    from: m.status,
    to: effective,
    message: result.message,
  };
}

// ─── Notification dispatch ────────────────────────────────────────────────────

async function dispatchTransitions(
  db: Db,
  env: Env,
  transitions: Transition[],
  now: number
): Promise<void> {
  if (!transitions.length) return;

  const [cfg] = await db.select().from(settings).limit(1);
  const autoEnabled = cfg?.autoIncidents !== false;

  const maint = await maintenanceSet(db);
  const visible = transitions.filter(
    (t) => t.monitor.name && !(maint.all || maint.ids.has(t.monitor.id))
  );
  if (!visible.length) return;

  // Only "up" and "down" drive incidents/alerts. "degraded" is recorded to the
  // timeline (as an event) but stays quiet — nobody needs a 2am page for "slow".
  const downs = visible.filter((t) => t.to === "down");
  const ups = visible.filter((t) => t.to === "up");
  const pauses = visible.filter((t) => t.to === "paused");

  if (autoEnabled) {
    await processAutoIncidents(db, env, downs, ups, now);
  } else {
    for (const t of [...downs, ...ups]) {
      await notifyMonitorTransition(db, env, t.monitor.name!, t.from, t.to, t.message, {
        type: t.monitor.type,
        target: t.monitor.targetUrl,
        lastLatencyMs: t.monitor.lastLatencyMs,
        downForMs: t.to === "up" ? await downForMs(db, t.monitor.id, now) : undefined,
      });
    }
  }

  // Pauses never join incidents — always a quiet per-monitor note.
  for (const t of pauses) {
    await notifyMonitorTransition(db, env, t.monitor.name!, t.from, t.to, t.message, {
      type: t.monitor.type,
      target: t.monitor.targetUrl,
    });
  }
}

// How long the monitor's most recent down spell lasted (best-effort).
async function downForMs(db: Db, monitorId: string, now: number): Promise<number | undefined> {
  const [lastDown] = await db
    .select({ createdAt: events.createdAt })
    .from(events)
    .where(and(eq(events.monitorId, monitorId), eq(events.status, "down")))
    .orderBy(desc(events.createdAt))
    .limit(1);
  return lastDown ? now - lastDown.createdAt : undefined;
}

const IMPACT_RANK: Record<string, number> = { none: 0, minor: 1, major: 2, critical: 3 };

function pickImpact(affectedCount: number): "minor" | "major" | "critical" {
  if (affectedCount >= 5) return "critical";
  if (affectedCount >= 2) return "major";
  return "minor";
}

function buildIncidentTitle(mons: Mon[]): string {
  const names = mons.map((m) => m.name ?? m.id);
  if (names.length === 1) return `${names[0]} is down`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are down`;
  return `Service disruption — ${names[0]} and ${names.length - 1} more`;
}

function toBrief(m: Mon): MonitorBrief {
  return { name: m.name ?? m.id, type: m.type, target: m.targetUrl, lastLatencyMs: m.lastLatencyMs };
}

const CF_NOTE_MARKER = "caused by a Cloudflare outage";

// For any newly-down monitor opted into the Cloudflare check, probe Cloudflare's
// status and, on a match, append a "likely Cloudflare outage" note to the
// incident. Best-effort and posted at most once per incident.
async function maybeNoteCloudflare(
  db: Db,
  env: Env,
  incident: { id: number; title: string; impact: string; status: string },
  candidates: Mon[]
): Promise<void> {
  if (!candidates.some((m) => m.checkCloudflare)) return;

  const existing = await db
    .select({ body: incidentUpdates.body })
    .from(incidentUpdates)
    .where(eq(incidentUpdates.incidentId, incident.id))
    .all();
  if (existing.some((u) => u.body.includes(CF_NOTE_MARKER))) return;

  let verdict;
  try {
    verdict = await checkCloudflareForOutage();
  } catch {
    return;
  }
  if (!verdict?.matched) return;

  const status = (incident.status === "resolved" ? "monitoring" : incident.status) as
    | "investigating"
    | "identified"
    | "monitoring"
    | "resolved";
  await db.insert(incidentUpdates).values({
    incidentId: incident.id,
    status,
    body: verdict.summary,
    createdAt: Date.now(),
  });
  await notifyIncident(
    db,
    env,
    incident.id,
    incident.title,
    "updated",
    incident.impact,
    status,
    verdict.summary
  );
}

// Rolling auto-incident: one open incident at a time absorbs all downs/ups.
// The system never auto-resolves — incidents move to "monitoring" when all
// services recover, but only an admin can close (resolve) the incident.
async function processAutoIncidents(
  db: Db,
  env: Env,
  downs: Transition[],
  ups: Transition[],
  now: number
): Promise<void> {
  let [open] = await db
    .select()
    .from(incidents)
    .where(and(eq(incidents.autoCreated, true), ne(incidents.status, "resolved")))
    .orderBy(desc(incidents.createdAt))
    .limit(1);

  // ── Downs: open a new incident or attach to the existing one ──
  if (downs.length) {
    const downMons = downs.map((d) => d.monitor);
    if (!open) {
      const title = buildIncidentTitle(downMons);
      const impact = pickImpact(downMons.length);
      const [inc] = await db
        .insert(incidents)
        .values({ title, status: "investigating", impact, autoCreated: true, createdAt: now })
        .returning();
      if (inc) {
        open = inc;
        await db
          .insert(incidentMonitors)
          .values(downMons.map((m) => ({ incidentId: inc.id, monitorId: m.id })));

        await db.insert(incidentUpdates).values({
          incidentId: inc.id,
          status: "investigating",
          body: `We are investigating an outage affecting: ${downMons.map((m) => m.name).join(", ")}.`,
          createdAt: now,
        });
        await notifyAutoIncident(db, env, inc, "created", downMons.map(toBrief), []);
        await maybeNoteCloudflare(db, env, inc, downMons);
      }
    } else {
      const existing = await db
        .select({ monitorId: incidentMonitors.monitorId })
        .from(incidentMonitors)
        .where(eq(incidentMonitors.incidentId, open.id))
        .all();
      const existingSet = new Set(existing.map((e) => e.monitorId));
      const newDowns = downMons.filter((m) => !existingSet.has(m.id));

      if (newDowns.length) {
        await db
          .insert(incidentMonitors)
          .values(newDowns.map((m) => ({ incidentId: open!.id, monitorId: m.id })));
        await db.insert(incidentUpdates).values({
          incidentId: open.id,
          status: open.status === "resolved" ? "investigating" : open.status,
          body: `Additional services affected: ${newDowns.map((m) => m.name).join(", ")}.`,
          createdAt: now,
        });

        const totalAffected = existingSet.size + newDowns.length;
        const newImpact = pickImpact(totalAffected);
        if ((IMPACT_RANK[newImpact] ?? 0) > (IMPACT_RANK[open.impact] ?? 0)) {
          await db.update(incidents).set({ impact: newImpact }).where(eq(incidents.id, open.id));
          open = { ...open, impact: newImpact };
        }
        // No webhook for "updated" — only notify on created and full recovery.
        await maybeNoteCloudflare(db, env, open, newDowns);
      }
    }
  }

  // ── Ups: record recoveries; move to "monitoring" when every service is back ──
  // Never auto-resolve — admin must close the incident manually.
  if (open && ups.length) {
    const affectedRows = await db
      .select({ monitorId: incidentMonitors.monitorId })
      .from(incidentMonitors)
      .where(eq(incidentMonitors.incidentId, open.id))
      .all();
    const affectedSet = new Set(affectedRows.map((r) => r.monitorId));
    const recovered = ups.filter((u) => affectedSet.has(u.monitor.id));

    if (recovered.length) {
      const affectedIds = [...affectedSet];
      const liveRows = await db
        .select({ status: monitors.status })
        .from(monitors)
        .where(inArray(monitors.id, affectedIds))
        .all();
      const allUp = liveRows.every((m) => m.status !== "down");
      const recoveredBriefs = recovered.map((r) => toBrief(r.monitor));

      if (allUp) {
        // All services recovered — move to monitoring, announce, wait for admin to close.
        await db
          .update(incidents)
          .set({ status: "monitoring" })
          .where(eq(incidents.id, open.id));
        await db.insert(incidentUpdates).values({
          incidentId: open.id,
          status: "monitoring",
          body: `All affected services have recovered. We will continue to monitor until this incident is closed. Total disruption: ${fmtDuration(now - open.createdAt)}.`,
          createdAt: now,
        });
        await notifyAutoIncident(
          db,
          env,
          { ...open, status: "monitoring" },
          "monitoring",
          [],
          recoveredBriefs
        );
      } else {
        // Partial recovery — update DB only, no webhook.
        await db.update(incidents).set({ status: "monitoring" }).where(eq(incidents.id, open.id));
        await db.insert(incidentUpdates).values({
          incidentId: open.id,
          status: "monitoring",
          body: `Recovered: ${recovered.map((r) => r.monitor.name).join(", ")}. Still monitoring the remaining services.`,
          createdAt: now,
        });
      }
    }
  }
}
