export interface DailyBucket {
  date: number;
  uptimePct: number;
  downtimeMs: number;
  worstStatus: "up" | "down" | "paused" | "no_data";
}

// Live, in-memory latency point sampled from the browser while the page is open.
// Not persisted server-side anymore — built up from monitor.lastLatencyMs per poll.
export interface LatencySample {
  latencyMs: number;
  checkedAt: number;
}

export interface MonitorSummary {
  id: string;
  name: string | null;
  type: "push" | "http" | "tcp";
  status: "up" | "down" | "paused";
  inMaintenance: boolean;
  groupId: number | null;
  lastLatencyMs: number | null;
  uptime24h: number;
  uptime7d: number;
  uptime90d: number;
  dailyBuckets: DailyBucket[];
  externalStatusLabel: string | null;
  externalStatusUrl: string | null;
}

export interface MonitorOutage {
  start: number;
  end: number | null;
  durationMs: number;
  message: string | null;
  ongoing: boolean;
}

export interface MonitorIncidentBrief {
  id: number;
  title: string;
  impact: "none" | "minor" | "major" | "critical";
  status: string;
  createdAt: number;
  resolvedAt: number | null;
}

export interface MonitorDetail {
  id: string;
  name: string | null;
  type: "push" | "http" | "tcp";
  status: "up" | "down" | "paused";
  targetUrl: string | null;
  externalStatusLabel: string | null;
  externalStatusUrl: string | null;
  createdAt: number;
  uptime24h: number;
  uptime7d: number;
  uptime90d: number;
  dailyBuckets: DailyBucket[];
  outages: MonitorOutage[];
  incidents: MonitorIncidentBrief[];
}

export interface IncidentUpdate {
  id: number;
  incidentId: number;
  status: string;
  body: string;
  imageUrls: string[];
  createdAt: number;
}

export interface Incident {
  id: number;
  title: string;
  status: string;
  impact: "none" | "minor" | "major" | "critical";
  autoCreated?: boolean;
  createdAt: number;
  resolvedAt: number | null;
  updates: IncidentUpdate[];
  affectedMonitors: string[];
}

export interface MaintenanceWindow {
  id: number;
  title: string;
  description: string | null;
  startTime: number;
  endTime: number;
  monitorIds: string[];
  status: "scheduled" | "active" | "completed" | "cancelled";
}

export interface MonitorGroup {
  id: number;
  name: string;
  sortOrder: number;
}

export interface StatusData {
  page: { title: string; headline: string };
  overall: "operational" | "partial_outage" | "major_outage";
  monitors: MonitorSummary[];
  activeIncidents: Incident[];
  maintenance: MaintenanceWindow[];
  groups: MonitorGroup[];
}

export interface AdminMonitor {
  id: string;
  type: "push" | "http" | "tcp";
  source: "config" | "agent" | "manual";
  slug: string | null;
  name: string | null;
  status: string;
  claimed: boolean;
  agentGroupId: string | null;
  targetUrl: string | null;
  intervalSeconds: number;
  graceSeconds: number;
  lastSeenAt: number | null;
  lastLatencyMs: number | null;
  sortOrder: number;
  groupId: number | null;
  createdAt: number;
  externalStatusLabel: string | null;
  externalStatusUrl: string | null;
  checkCloudflare: boolean;
  checkSsl: boolean;
  degradedResponseMs: number | null;
  expectBody: string | null;
}

export interface AdminSettings {
  id: number;
  pageTitle: string;
  headline: string;
  discordWebhookUrl: string | null;
  vapidPublicKey: string | null;
  vapidSubject: string | null;
  autoIncidents: boolean;
}

export interface Webhook {
  id: number;
  label: string;
  url: string;
  createdAt: number;
}

export interface PushSubscriptionInfo {
  id: number;
  deviceName: string;
  createdAt: number;
}

export interface AdminMaintenanceWindow {
  id: number;
  title: string;
  description: string | null;
  startTime: number;
  endTime: number;
  monitorIds: string[];
  status: "scheduled" | "active" | "completed" | "cancelled";
  createdAt: number;
}

export interface AllowedUser {
  discordUserId: string;
  addedBy: string;
  createdAt: number;
}

export interface AdminMonitorGroup {
  id: number;
  name: string;
  sortOrder: number;
  createdAt: number;
}
