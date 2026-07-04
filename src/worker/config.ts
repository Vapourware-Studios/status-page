// ─────────────────────────────────────────────────────────────────────────────
//  Config-as-code engine.
//
//  status.config.yml is bundled with the Worker at build time (imported ?raw).
//  On each cron tick we parse it, interpolate ${SECRET} references from the
//  Worker env, and reconcile the declared groups / monitors / settings into D1
//  — but only when the file's content hash changes, so a steady state costs
//  nothing. Runtime state (status, incidents, agents) is never touched here.
// ─────────────────────────────────────────────────────────────────────────────

import { parse } from "yaml";
// Vite bundles the repo-root config file as a raw string.
import configRaw from "../../status.config.yml?raw";
import { eq, and } from "drizzle-orm";
import type { Db } from "./db";
import type { Env } from "./types";
import { monitors, monitorGroups, settings } from "./schema";
import { sha256Hex } from "./auth";

export const DEFAULT_SITE_NAME = "Statch";

export type MonitorType = "http" | "tcp" | "push" | "keyword";

export interface MonitorConfig {
  slug: string;
  name: string;
  group?: string;
  type: MonitorType;
  url?: string;
  interval: number;
  grace: number;
  expectStatus?: number[];
  expectBody?: string;
  degradedResponseMs?: number;
  checkSsl: boolean;
  checkCloudflare: boolean;
  externalStatus?: { label: string; url: string };
}

export interface DiscordChannel { url: string }
export interface SlackChannel { url: string }
export interface TelegramChannel { botToken: string; chatId: string }
export interface TeamsChannel { url: string }
export interface PagerDutyChannel { routingKey: string }
export interface WebhookChannel { url: string; template?: string }

export interface StatchConfig {
  site: {
    name: string;
    headline: string;
    url: string;
    accent: string;
    logo: string;
  };
  alerting: { autoIncidents: boolean; confirmations: number };
  groups: string[];
  monitors: MonitorConfig[];
  notifications: {
    discord: DiscordChannel[];
    slack: SlackChannel[];
    telegram: TelegramChannel[];
    teams: TeamsChannel[];
    pagerduty: PagerDutyChannel[];
    webhook: WebhookChannel[];
  };
}

// ─── Parse + interpolate ─────────────────────────────────────────────────────

/** Replace ${VAR} tokens inside every string with the matching env value. */
function interpolate<T>(val: T, env: Record<string, unknown>): T {
  if (typeof val === "string") {
    return val.replace(/\$\{([A-Z0-9_]+)\}/g, (_, k: string) => {
      const v = env[k];
      return typeof v === "string" ? v : "";
    }) as unknown as T;
  }
  if (Array.isArray(val)) return val.map((v) => interpolate(v, env)) as unknown as T;
  if (val && typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) out[k] = interpolate(v, env);
    return out as T;
  }
  return val;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function normalize(raw: Record<string, unknown>): StatchConfig {
  const site = (raw.site ?? {}) as Record<string, unknown>;
  const alerting = (raw.alerting ?? {}) as Record<string, unknown>;
  const notif = (raw.notifications ?? {}) as Record<string, unknown>;

  const monitorsIn = asArray<Record<string, unknown>>(raw.monitors);
  const seen = new Set<string>();
  const mons: MonitorConfig[] = [];
  for (const m of monitorsIn) {
    const slug = String(m.slug ?? "").trim();
    if (!slug || seen.has(slug)) continue; // skip missing/duplicate slugs
    seen.add(slug);
    const type = (m.type as MonitorType) ?? "http";
    mons.push({
      slug,
      name: String(m.name ?? slug),
      group: m.group ? String(m.group) : undefined,
      type,
      url: m.url ? String(m.url) : undefined,
      interval: Number(m.interval ?? 60),
      grace: Number(m.grace ?? 90),
      expectStatus: Array.isArray(m.expectStatus) ? (m.expectStatus as number[]) : undefined,
      expectBody: m.expectBody ? String(m.expectBody) : undefined,
      degradedResponseMs: m.degradedResponseMs != null ? Number(m.degradedResponseMs) : undefined,
      checkSsl: Boolean(m.checkSsl),
      checkCloudflare: Boolean(m.checkCloudflare),
      externalStatus:
        m.externalStatus && typeof m.externalStatus === "object"
          ? {
              label: String((m.externalStatus as Record<string, unknown>).label ?? ""),
              url: String((m.externalStatus as Record<string, unknown>).url ?? ""),
            }
          : undefined,
    });
  }

  return {
    site: {
      name: String(site.name ?? DEFAULT_SITE_NAME),
      headline: String(site.headline ?? "Current system status and incident history"),
      url: String(site.url ?? ""),
      accent: String(site.accent ?? "#6366f1"),
      logo: String(site.logo ?? ""),
    },
    alerting: {
      autoIncidents: alerting.autoIncidents !== false,
      confirmations: Math.max(1, Number(alerting.confirmations ?? 1)),
    },
    groups: asArray<string>(raw.groups).map(String),
    monitors: mons,
    notifications: {
      discord: asArray<DiscordChannel>(notif.discord).filter((c) => c.url),
      slack: asArray<SlackChannel>(notif.slack).filter((c) => c.url),
      telegram: asArray<TelegramChannel>(notif.telegram).filter((c) => c.botToken && c.chatId),
      teams: asArray<TeamsChannel>(notif.teams).filter((c) => c.url),
      pagerduty: asArray<PagerDutyChannel>(notif.pagerduty).filter((c) => c.routingKey),
      webhook: asArray<WebhookChannel>(notif.webhook).filter((c) => c.url),
    },
  };
}

let cached: { config: StatchConfig; hash: string } | null = null;

/** Parse (once per isolate) the bundled config with env secrets applied. */
export async function loadConfig(env: Env): Promise<{ config: StatchConfig; hash: string }> {
  if (cached) return cached;
  const parsed = (parse(configRaw) ?? {}) as Record<string, unknown>;
  const interpolated = interpolate(parsed, env as unknown as Record<string, unknown>);
  const config = normalize(interpolated as Record<string, unknown>);
  // Hash the raw file (pre-interpolation) so rotating a secret alone doesn't
  // needlessly trigger a reconcile — structural edits are what matter here.
  const hash = await sha256Hex(configRaw);
  cached = { config, hash };
  return cached;
}

// ─── Reconcile into D1 ───────────────────────────────────────────────────────

/**
 * Bring the database in line with the declared config. Idempotent and cheap:
 * skips entirely when the config hash is unchanged since the last run. Only
 * touches config-managed rows (monitors.source = "config") — auto-discovered
 * agents and admin-created monitors are left alone.
 */
export async function reconcileConfig(db: Db, env: Env, now: number): Promise<void> {
  const { config, hash } = await loadConfig(env);

  const [cfg] = await db.select().from(settings).limit(1);
  if (cfg?.configHash === hash) return; // nothing changed — bail fast

  // 1. Site settings.
  await db
    .update(settings)
    .set({
      pageTitle: config.site.name,
      headline: config.site.headline,
      accent: config.site.accent,
      logo: config.site.logo || null,
      autoIncidents: config.alerting.autoIncidents,
      confirmations: config.alerting.confirmations,
      configHash: hash,
    })
    .where(eq(settings.id, 1));

  // 2. Groups — ensure each declared group exists; build name → id map.
  const existingGroups = await db.select().from(monitorGroups).all();
  const groupIdByName = new Map(existingGroups.map((g) => [g.name, g.id]));
  for (let i = 0; i < config.groups.length; i++) {
    const name = config.groups[i]!;
    const id = groupIdByName.get(name);
    if (id == null) {
      const [row] = await db
        .insert(monitorGroups)
        .values({ name, sortOrder: i, createdAt: now })
        .returning();
      if (row) groupIdByName.set(name, row.id);
    } else {
      await db.update(monitorGroups).set({ sortOrder: i }).where(eq(monitorGroups.id, id));
    }
  }

  // 3. Monitors — upsert by slug, preserving runtime state.
  const configRows = await db
    .select()
    .from(monitors)
    .where(eq(monitors.source, "config"))
    .all();
  const bySlug = new Map(configRows.map((m) => [m.slug ?? "", m]));
  const declaredSlugs = new Set<string>();

  for (let i = 0; i < config.monitors.length; i++) {
    const m = config.monitors[i]!;
    declaredSlugs.add(m.slug);
    const groupId = m.group ? groupIdByName.get(m.group) ?? null : null;
    const common = {
      name: m.name,
      type: m.type === "keyword" ? ("http" as const) : m.type,
      targetUrl: m.url ?? null,
      intervalSeconds: m.interval,
      graceSeconds: m.grace,
      groupId,
      sortOrder: i,
      expectStatus: m.expectStatus ? JSON.stringify(m.expectStatus) : null,
      expectBody: m.expectBody ?? null,
      degradedResponseMs: m.degradedResponseMs ?? null,
      checkSsl: m.checkSsl,
      checkCloudflare: m.checkCloudflare,
      externalStatusLabel: m.externalStatus?.label ?? null,
      externalStatusUrl: m.externalStatus?.url ?? null,
    };

    const existing = bySlug.get(m.slug);
    if (existing) {
      await db.update(monitors).set(common).where(eq(monitors.id, existing.id));
    } else {
      await db.insert(monitors).values({
        id: crypto.randomUUID(),
        slug: m.slug,
        source: "config",
        status: "pending",
        claimed: true,
        createdAt: now,
        ...common,
      });
    }
  }

  // 4. Remove config-managed monitors no longer declared.
  for (const row of configRows) {
    if (!declaredSlugs.has(row.slug ?? "")) {
      await db.delete(monitors).where(and(eq(monitors.id, row.id), eq(monitors.source, "config")));
    }
  }
}
