// Central notification dispatcher — fans every alert out to Discord (rich
// embeds), Slack / Teams / Telegram / PagerDuty / generic webhooks (config), and
// Web Push subscriptions, so every channel stays in sync.

import { eq, inArray } from "drizzle-orm";
import type { Db } from "./db";
import type { Env } from "./types";
import { webhooks, pushSubscriptions, settings, incidentMonitors, monitors } from "./schema";
import {
  sendMonitorTransitionAlert,
  sendIncidentAlert,
  sendAutoIncidentAlert,
  fmtDuration,
  type MonitorAlertInfo,
  type MonitorBrief,
} from "./discord";
import { sendWebPush, generateVapidKeys, type WebPushPayload } from "./vapid";
import { loadConfig } from "./config";
import { fanoutChannels, type AlertPayload } from "./channels";

// Send a normalized alert to every non-Discord channel declared in config.
async function fanout(env: Env, a: AlertPayload): Promise<void> {
  const { config } = await loadConfig(env);
  await fanoutChannels(config, a);
}

export async function ensureVapidKeys(db: Db): Promise<string> {
  const [cfg] = await db.select().from(settings).limit(1);
  if (cfg?.vapidPublicKey) return cfg.vapidPublicKey;

  const { privateJwk, publicKeyB64u } = await generateVapidKeys();
  await db
    .update(settings)
    .set({
      vapidPrivateJwk: JSON.stringify(privateJwk),
      vapidPublicKey: publicKeyB64u,
    })
    .where(eq(settings.id, 1));

  return publicKeyB64u;
}

// VAPID `sub` must be a real mailto:/https: — Apple's push service rejects
// bogus values (e.g. the old `.local` default) with BadJwtToken, which silently
// kills iOS push. Derive a valid one from SERVER_URL when not explicitly set.
export function resolveVapidSubject(stored: string | null | undefined, env: Env): string {
  let host = "status.example";
  try {
    host = new URL(env.SERVER_URL).hostname;
  } catch {
    /* keep fallback */
  }
  const fallback = `mailto:admin@${host}`;
  if (!stored) return fallback;
  // reject the unroutable .local TLD that Apple bounces
  if (/@[^@\s]*\.local$/i.test(stored)) return fallback;
  return stored;
}

async function getVapidConfig(
  db: Db,
  env: Env
): Promise<{ privateJwk: JsonWebKey; publicKeyB64u: string; subject: string } | null> {
  const [cfg] = await db.select().from(settings).limit(1);
  if (!cfg?.vapidPrivateJwk || !cfg?.vapidPublicKey) return null;
  try {
    return {
      privateJwk: JSON.parse(cfg.vapidPrivateJwk) as JsonWebKey,
      publicKeyB64u: cfg.vapidPublicKey,
      subject: resolveVapidSubject(cfg.vapidSubject, env),
    };
  } catch {
    return null;
  }
}

async function dispatchWebPush(
  db: Db,
  env: Env,
  payload: WebPushPayload
): Promise<{ sent: number; removed: number }> {
  const vapid = await getVapidConfig(db, env);
  if (!vapid) return { sent: 0, removed: 0 };

  const subs = await db.select().from(pushSubscriptions);
  if (!subs.length) return { sent: 0, removed: 0 };

  const full: WebPushPayload = { icon: "/favicon.svg", ...payload };

  const deadIds: number[] = [];
  await Promise.all(
    subs.map(async (sub) => {
      const alive = await sendWebPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        full,
        vapid.privateJwk,
        vapid.publicKeyB64u,
        vapid.subject
      );
      if (!alive) deadIds.push(sub.id);
    })
  );

  for (const id of deadIds) {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
  }

  return { sent: subs.length - deadIds.length, removed: deadIds.length };
}

// Discord targets = admin-added webhooks (DB) ∪ config-declared discord webhooks.
async function getWebhookUrls(db: Db, env: Env): Promise<string[]> {
  const rows = await db.select({ url: webhooks.url }).from(webhooks);
  const { config } = await loadConfig(env);
  const configUrls = config.notifications.discord.map((c) => c.url);
  return [...new Set([...rows.map((r) => r.url), ...configUrls])];
}

// ─── Monitor transitions (per-monitor; used when auto-incidents are off) ──────

export async function notifyMonitorTransition(
  db: Db,
  env: Env,
  monitorName: string,
  from: string,
  to: string,
  message?: string,
  info: MonitorAlertInfo = {}
): Promise<void> {
  const urls = await getWebhookUrls(db, env);
  const withStatusUrl: MonitorAlertInfo = { statusUrl: env.SERVER_URL, ...info };
  await Promise.all(urls.map((url) => sendMonitorTransitionAlert(url, monitorName, from, to, withStatusUrl)));

  const isDown = to === "down";
  const isPaused = to === "paused";

  await fanout(env, {
    title: isDown ? `Down: ${monitorName}` : isPaused ? `Paused: ${monitorName}` : `Recovered: ${monitorName}`,
    body: message ?? (isDown ? "Monitor is unreachable" : "Monitor is back online"),
    severity: isDown ? "down" : isPaused ? "warning" : "up",
    url: env.SERVER_URL,
  });

  if (isPaused) return; // pauses don't warrant a push
  await dispatchWebPush(db, env, {
    title: isDown ? `Down: ${monitorName}` : `Recovered: ${monitorName}`,
    body: isDown ? (message ?? "Monitor is unreachable") : "Monitor is back online",
    tag: `monitor-${monitorName.toLowerCase().replace(/\s+/g, "-")}`,
    url: "/",
  });
}

// ─── Auto-incidents (grouped, rolling) ───────────────────────────────────────

function toBrief(m: typeof monitors.$inferSelect): MonitorBrief {
  return {
    name: m.name ?? m.id,
    type: m.type,
    target: m.targetUrl,
    lastLatencyMs: m.lastLatencyMs,
  };
}

export async function notifyAutoIncident(
  db: Db,
  env: Env,
  incident: { id: number; title: string; impact: string; status: string; createdAt: number; resolvedAt?: number | null },
  action: "created" | "updated" | "resolved" | "monitoring",
  newlyDown: MonitorBrief[],
  newlyUp: MonitorBrief[],
  note?: string
): Promise<void> {
  // Pull the full current affected set for the embed.
  const affectedRows = await db
    .select({ monitorId: incidentMonitors.monitorId })
    .from(incidentMonitors)
    .where(eq(incidentMonitors.incidentId, incident.id))
    .all();
  const affectedIds = affectedRows.map((r) => r.monitorId);
  const affectedMonitors = affectedIds.length
    ? await db.select().from(monitors).where(inArray(monitors.id, affectedIds)).all()
    : [];
  const affected = affectedMonitors.map(toBrief);

  const incidentUrl = `${env.SERVER_URL}/incidents/${incident.id}`;
  const durationMs =
    action === "resolved" || action === "monitoring"
      ? (incident.resolvedAt ?? Date.now()) - incident.createdAt
      : undefined;

  const urls = await getWebhookUrls(db, env);
  await Promise.all(
    urls.map((url) =>
      sendAutoIncidentAlert(url, {
        title: incident.title,
        action,
        impact: incident.impact,
        status: incident.status,
        affected,
        newlyDown,
        newlyUp,
        durationMs,
        incidentUrl,
        note,
      })
    )
  );

  const recovered = action === "resolved" || action === "monitoring";
  await fanout(env, {
    title: recovered ? `Recovered — ${incident.title}` : `Incident — ${incident.title}`,
    body: recovered
      ? `All affected services have recovered${durationMs != null ? ` after ${fmtDuration(durationMs)}` : ""}.`
      : `${affected.length} service(s) affected · impact: ${incident.impact}`,
    severity: recovered ? "up" : "down",
    url: incidentUrl,
  });

  // Web push — one announcement per significant event.
  const names = (list: MonitorBrief[]) => list.map((m) => m.name).join(", ");
  let pushTitle: string;
  let pushBody: string;
  if (action === "created") {
    pushTitle = `🔴 ${incident.title}`;
    pushBody = `${affected.length} service${affected.length === 1 ? "" : "s"} affected: ${names(affected)}. Tap for live updates.`;
  } else if (action === "monitoring") {
    pushTitle = `✅ Recovered: ${incident.title}`;
    pushBody = durationMs != null
      ? `All services recovered after ${fmtDuration(durationMs)}. We will continue to monitor until this incident is closed.`
      : "All services recovered. We will continue to monitor until this incident is closed.";
  } else if (action === "resolved") {
    pushTitle = `✅ Resolved: ${incident.title}`;
    pushBody = durationMs != null ? `All services recovered after ${fmtDuration(durationMs)}.` : "All services recovered.";
  } else if (newlyUp.length && !newlyDown.length) {
    pushTitle = `🟡 Update: ${incident.title}`;
    pushBody = `Recovered: ${names(newlyUp)}. Still working on the rest.`;
  } else {
    pushTitle = `🔴 Update: ${incident.title}`;
    pushBody = `Also affected: ${names(newlyDown)}.`;
  }

  await dispatchWebPush(db, env, {
    title: pushTitle,
    body: pushBody,
    tag: `incident-${incident.id}`,
    url: `/incidents/${incident.id}`,
  });
}

// ─── Diagnostics / test buttons ──────────────────────────────────────────────

const SAMPLE_AFFECTED: MonitorBrief[] = [
  { name: "API server", type: "http", target: "https://api.example.com/health", lastLatencyMs: 128 },
  { name: "Database", type: "tcp", target: "db.example.com:5432", lastLatencyMs: 4 },
];

// Send sample embeds to ONE webhook so the admin can verify formatting + delivery.
export async function testWebhook(env: Env, url: string): Promise<void> {
  await sendMonitorTransitionAlert(url, "Sample monitor", "up", "down", {
    type: "http",
    target: "https://api.example.com/health",
    lastLatencyMs: 0,
    statusUrl: env.SERVER_URL,
  });
  await sendAutoIncidentAlert(url, {
    title: "Test incident — sample outage",
    action: "created",
    impact: "major",
    status: "investigating",
    affected: SAMPLE_AFFECTED,
    newlyDown: SAMPLE_AFFECTED,
    incidentUrl: `${env.SERVER_URL}/`,
  });
}

// Fire a grouped sample announcement across BOTH channels (every webhook + push).
export async function notifyTest(
  db: Db,
  env: Env
): Promise<{ webhooks: number; pushSent: number; pushRemoved: number }> {
  const urls = await getWebhookUrls(db, env);
  await Promise.all(urls.map((url) => testWebhook(env, url)));

  const { sent, removed } = await dispatchWebPush(db, env, {
    title: "🔔 Test announcement",
    body: "Sample grouped outage alert — if you see this, push and the incident pipeline both work.",
    tag: "test-announcement",
    url: "/",
  });

  return { webhooks: urls.length, pushSent: sent, pushRemoved: removed };
}

// ─── Incidents (admin-created / manual updates) ──────────────────────────────

export async function notifyIncident(
  db: Db,
  env: Env,
  incidentId: number,
  title: string,
  action: "created" | "resolved" | "updated",
  impact: string,
  status: string,
  updateBody?: string
): Promise<void> {
  const urls = await getWebhookUrls(db, env);
  const incidentUrl = `${env.SERVER_URL}/incidents/${incidentId}`;
  await Promise.all(
    urls.map((url) =>
      sendIncidentAlert(url, title, action, impact, status, updateBody, incidentUrl)
    )
  );

  await fanout(env, {
    title: action === "resolved" ? `Resolved — ${title}` : `Incident ${action} — ${title}`,
    body: updateBody ?? `Status: ${status} · Impact: ${impact}`,
    severity: action === "resolved" ? "up" : "down",
    url: incidentUrl,
  });

  const pushTitle =
    action === "created"
      ? `Incident: ${title}`
      : action === "resolved"
      ? `Resolved: ${title}`
      : `Update: ${title}`;

  await dispatchWebPush(db, env, {
    title: pushTitle,
    body: updateBody ?? `Status: ${status} · Impact: ${impact}`,
    tag: `incident-${incidentId}`,
    url: `/incidents/${incidentId}`,
  });
}

// ─── Maintenance ─────────────────────────────────────────────────────────────

export async function notifyMaintenanceStart(
  db: Db,
  env: Env,
  title: string,
  description?: string | null
): Promise<void> {
  await fanout(env, {
    title: `Maintenance started — ${title}`,
    body: description ?? "Scheduled maintenance is now in progress.",
    severity: "warning",
    url: env.SERVER_URL,
  });
  await dispatchWebPush(db, env, {
    title: `Maintenance started: ${title}`,
    body: description ?? "Scheduled maintenance is now in progress.",
    tag: `maint-${title.toLowerCase().replace(/\s+/g, "-")}`,
    url: "/",
  });
}

export async function notifyMaintenanceEnd(db: Db, env: Env, title: string): Promise<void> {
  await fanout(env, {
    title: `Maintenance complete — ${title}`,
    body: "Scheduled maintenance has ended.",
    severity: "up",
    url: env.SERVER_URL,
  });
  await dispatchWebPush(db, env, {
    title: `Maintenance complete: ${title}`,
    body: "Scheduled maintenance has ended.",
    tag: `maint-${title.toLowerCase().replace(/\s+/g, "-")}`,
    url: "/",
  });
}
