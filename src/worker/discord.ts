const COLORS = {
  up: 0x4ade80,
  down: 0xf87171,
  paused: 0xf59e0b,
  investigating: 0xf59e0b,
  identified: 0xfb923c,
  monitoring: 0x60a5fa,
  resolved: 0x4ade80,
  none: 0x6b7280,
  minor: 0xfacc15,
  major: 0xf97316,
  critical: 0xef4444,
};

interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

async function sendEmbed(webhookUrl: string, embed: DiscordEmbed): Promise<void> {
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  }).catch(() => {});
}

// Compact human duration: 45s, 12m, 3h 20m, 2d 4h
export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return remM ? `${h}h ${remM}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `${d}d ${remH}h` : `${d}d`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface MonitorBrief {
  name: string;
  type: string;
  target?: string | null;
  lastLatencyMs?: number | null;
}

function monitorLine(m: MonitorBrief): string {
  const parts = [`**${m.name}**`, `\`${m.type}\``];
  if (m.target) parts.push(`— ${m.target}`);
  if (m.lastLatencyMs != null && m.lastLatencyMs > 0) parts.push(`(${m.lastLatencyMs}ms)`);
  return `• ${parts.join(" ")}`;
}

function monitorListField(label: string, list: MonitorBrief[]): { name: string; value: string } {
  const value = list.map(monitorLine).join("\n").slice(0, 1024) || "—";
  return { name: label, value };
}

export async function sendDiscordAlert(
  webhookUrl: string,
  content: string
): Promise<void> {
  // Legacy plain-text fallback (unused internally, kept for compat)
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  }).catch(() => {});
}

export interface MonitorAlertInfo {
  type?: string;
  target?: string | null;
  lastLatencyMs?: number | null;
  downForMs?: number; // set on recovery to report how long it was down
  statusUrl?: string;
}

export async function sendMonitorTransitionAlert(
  webhookUrl: string,
  name: string,
  from: string,
  to: string,
  info: MonitorAlertInfo = {}
): Promise<void> {
  const isDown = to === "down";
  const isPaused = to === "paused";
  const color = isDown ? COLORS.down : isPaused ? COLORS.paused : COLORS.up;

  const statusLabel = isDown ? "Down" : isPaused ? "Paused" : "Operational";
  const title = isDown
    ? `🔴 Outage detected — ${name}`
    : isPaused
    ? `⏸️ Monitor paused — ${name}`
    : `✅ Recovered — ${name}`;

  const fields: DiscordEmbed["fields"] = [
    { name: "Monitor", value: name, inline: true },
    { name: "Previous", value: cap(from), inline: true },
    { name: "Current", value: statusLabel, inline: true },
  ];

  if (info.type) fields.push({ name: "Type", value: info.type.toUpperCase(), inline: true });
  if (info.target) fields.push({ name: "Target", value: info.target, inline: true });
  if (info.lastLatencyMs != null && info.lastLatencyMs > 0) {
    fields.push({ name: "Latency", value: `${info.lastLatencyMs}ms`, inline: true });
  }
  if (!isDown && info.downForMs != null) {
    fields.push({ name: "Was down for", value: fmtDuration(info.downForMs), inline: true });
  }
  if (info.statusUrl) fields.push({ name: "Status page", value: info.statusUrl });

  await sendEmbed(webhookUrl, {
    title,
    color,
    fields,
    footer: { text: "Statch" },
    timestamp: new Date().toISOString(),
  });
}

// Grouped, rolling auto-incident alert — one announcement covering many monitors.
export interface AutoIncidentAlert {
  title: string;
  // "monitoring" = services recovered but incident stays open until admin closes it
  action: "created" | "updated" | "resolved" | "monitoring";
  impact: string;
  status: string;
  affected: MonitorBrief[];
  newlyDown?: MonitorBrief[];
  newlyUp?: MonitorBrief[];
  durationMs?: number;
  incidentUrl?: string;
  // Extra context note, e.g. a link to an upstream provider’s incident.
  note?: string;
}

export async function sendAutoIncidentAlert(
  webhookUrl: string,
  a: AutoIncidentAlert
): Promise<void> {
  const color =
    a.action === "resolved" || a.action === "monitoring"
      ? COLORS.resolved
      : COLORS[a.impact as keyof typeof COLORS] ?? COLORS.major;

  const title =
    a.action === "created"
      ? `🚨 Incident opened — ${a.title}`
      : a.action === "resolved"
      ? `✅ Incident resolved — ${a.title}`
      : a.action === "monitoring"
      ? `✅ Services recovered — ${a.title}`
      : `📝 Incident update — ${a.title}`;

  const fields: DiscordEmbed["fields"] = [
    { name: "Impact", value: cap(a.impact), inline: true },
    { name: "Status", value: cap(a.status), inline: true },
    { name: "Affected", value: String(a.affected.length), inline: true },
  ];

  if (a.note) fields.push({ name: "Note", value: a.note.slice(0, 1024) });
  if (a.newlyDown?.length) fields.push(monitorListField("Now down", a.newlyDown));
  if (a.newlyUp?.length) fields.push(monitorListField("Recovered", a.newlyUp));
  fields.push(monitorListField("All affected services", a.affected));
  if ((a.action === "resolved" || a.action === "monitoring") && a.durationMs != null) {
    fields.push({ name: "Total disruption", value: fmtDuration(a.durationMs), inline: true });
  }
  if (a.action === "monitoring") {
    fields.push({ name: "Status", value: "Issue resolved. We will continue to monitor until this incident is closed." });
  }
  if (a.incidentUrl) {
    fields.push({ name: "Live updates", value: `[View incident & subscribe](${a.incidentUrl})` });
  }

  await sendEmbed(webhookUrl, {
    title,
    color,
    fields,
    footer: { text: "Statch" },
    timestamp: new Date().toISOString(),
  });
}

export async function sendIncidentAlert(
  webhookUrl: string,
  title: string,
  action: "created" | "resolved" | "updated",
  impact: string,
  status: string,
  updateBody?: string,
  incidentUrl?: string
): Promise<void> {
  const color =
    action === "resolved"
      ? COLORS.resolved
      : COLORS[impact as keyof typeof COLORS] ?? COLORS.minor;

  const embedTitle =
    action === "created"
      ? `Incident created — ${title}`
      : action === "resolved"
      ? `Incident resolved — ${title}`
      : `Incident update — ${title}`;

  const fields: DiscordEmbed["fields"] = [
    { name: "Impact", value: impact.charAt(0).toUpperCase() + impact.slice(1), inline: true },
    { name: "Status", value: status.charAt(0).toUpperCase() + status.slice(1), inline: true },
  ];

  if (updateBody) {
    fields.push({ name: "Update", value: updateBody.slice(0, 1024) });
  }

  if (incidentUrl) {
    fields.push({ name: "Details", value: incidentUrl });
  }

  await sendEmbed(webhookUrl, {
    title: embedTitle,
    color,
    fields,
    footer: { text: "Statch" },
    timestamp: new Date().toISOString(),
  });
}

// Legacy compat wrappers used by existing callers
export function monitorTransitionMessage(name: string, from: string, to: string): string {
  const arrow = to === "up" ? "✅" : "🔴";
  return `${arrow} **${name}** changed from **${from}** → **${to}**`;
}

export function incidentMessage(title: string, action: "created" | "resolved", impact: string): string {
  const icon = action === "created" ? "🚨" : "✅";
  return `${icon} Incident **${action}**: ${title} (impact: ${impact})`;
}
