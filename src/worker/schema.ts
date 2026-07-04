import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const monitors = sqliteTable("monitors", {
  id: text("id").primaryKey(),
  // Stable identifier for config-managed monitors (null for agents/manual).
  slug: text("slug"),
  // Where this monitor came from: declarative config, an enrolled agent, or
  // hand-created in the admin panel. Only "config" rows are reconciled.
  source: text("source", { enum: ["config", "agent", "manual"] })
    .notNull()
    .default("manual"),
  type: text("type", { enum: ["push", "http", "tcp"] }).notNull(),
  name: text("name"),
  status: text("status", { enum: ["pending", "up", "degraded", "down", "paused"] })
    .notNull()
    .default("pending"),
  claimed: integer("claimed", { mode: "boolean" }).notNull().default(false),
  agentTokenHash: text("agent_token_hash"),
  agentGroupId: text("agent_group_id"),
  targetUrl: text("target_url"),
  intervalSeconds: integer("interval_seconds").notNull().default(30),
  graceSeconds: integer("grace_seconds").notNull().default(90),
  lastSeenAt: integer("last_seen_at"),
  lastLatencyMs: integer("last_latency_ms"),
  // Consecutive failed checks so far — used to require N failures before "down".
  failCount: integer("fail_count").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  groupId: integer("group_id"),
  createdAt: integer("created_at").notNull(),
  registeringIp: text("registering_ip"),
  // ── Assertions / thresholds (config-driven) ──
  expectStatus: text("expect_status"), // JSON array of acceptable status codes
  expectBody: text("expect_body"), // response body must contain this string
  degradedResponseMs: integer("degraded_response_ms"), // slower → "degraded"
  checkSsl: integer("check_ssl", { mode: "boolean" }).notNull().default(false),
  sslExpiresAt: integer("ssl_expires_at"), // cached TLS notAfter (ms)
  // Optional link to a third-party provider's official status page.
  externalStatusLabel: text("external_status_label"),
  externalStatusUrl: text("external_status_url"),
  // When down, auto-probe Cloudflare status and blame it on a match.
  checkCloudflare: integer("check_cloudflare", { mode: "boolean" }).notNull().default(false),
});

// Short-lived tokens that let a machine self-enrol as a push monitor with no
// manual pairing step (Cloudflare-tunnel style). Minted in /admin.
export const enrollTokens = sqliteTable("enroll_tokens", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  label: text("label"),
  groupId: integer("group_id"),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
});

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  monitorId: text("monitor_id")
    .notNull()
    .references(() => monitors.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["up", "degraded", "down", "paused"] }).notNull(),
  message: text("message"),
  createdAt: integer("created_at").notNull(),
});

export const incidents = sqliteTable("incidents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  status: text("status", {
    enum: ["investigating", "identified", "monitoring", "resolved"],
  })
    .notNull()
    .default("investigating"),
  impact: text("impact", { enum: ["none", "minor", "major", "critical"] })
    .notNull()
    .default("minor"),
  autoCreated: integer("auto_created", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  resolvedAt: integer("resolved_at"),
});

export const incidentUpdates = sqliteTable("incident_updates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  incidentId: integer("incident_id")
    .notNull()
    .references(() => incidents.id, { onDelete: "cascade" }),
  status: text("status", {
    enum: ["investigating", "identified", "monitoring", "resolved"],
  }).notNull(),
  body: text("body").notNull(),
  imageUrls: text("image_urls"),
  createdAt: integer("created_at").notNull(),
});

export const incidentMonitors = sqliteTable("incident_monitors", {
  incidentId: integer("incident_id")
    .notNull()
    .references(() => incidents.id, { onDelete: "cascade" }),
  monitorId: text("monitor_id")
    .notNull()
    .references(() => monitors.id, { onDelete: "cascade" }),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  pageTitle: text("page_title").notNull().default("Statch"),
  headline: text("headline")
    .notNull()
    .default("Current system status and incident history"),
  accent: text("accent").notNull().default("#6366f1"),
  logo: text("logo"),
  discordWebhookUrl: text("discord_webhook_url"),
  vapidPrivateJwk: text("vapid_private_jwk"),
  vapidPublicKey: text("vapid_public_key"),
  vapidSubject: text("vapid_subject"),
  autoIncidents: integer("auto_incidents", { mode: "boolean" }).notNull().default(true),
  // Consecutive failed checks required before a monitor is declared down.
  confirmations: integer("confirmations").notNull().default(1),
  // sha256 of status.config.yml at last reconcile — lets us skip no-op syncs.
  configHash: text("config_hash"),
});

export const webhooks = sqliteTable("webhooks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  url: text("url").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  deviceName: text("device_name").notNull().default("Unknown device"),
  createdAt: integer("created_at").notNull(),
});

export const maintenanceWindows = sqliteTable("maintenance_windows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description"),
  startTime: integer("start_time").notNull(),
  endTime: integer("end_time").notNull(),
  monitorIds: text("monitor_ids"),
  status: text("status", {
    enum: ["scheduled", "active", "completed", "cancelled"],
  })
    .notNull()
    .default("scheduled"),
  createdAt: integer("created_at").notNull(),
});

export const monitorGroups = sqliteTable("monitor_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  discordUserId: text("discord_user_id").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const allowedUsers = sqliteTable("allowed_users", {
  discordUserId: text("discord_user_id").primaryKey(),
  addedBy: text("added_by").notNull(),
  createdAt: integer("created_at").notNull(),
});

export type Monitor = typeof monitors.$inferSelect;
export type EnrollToken = typeof enrollTokens.$inferSelect;
export type Event = typeof events.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type IncidentUpdate = typeof incidentUpdates.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type MaintenanceWindow = typeof maintenanceWindows.$inferSelect;
export type MonitorGroup = typeof monitorGroups.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type AllowedUser = typeof allowedUsers.$inferSelect;
