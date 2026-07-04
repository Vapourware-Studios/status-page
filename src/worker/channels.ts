// ─────────────────────────────────────────────────────────────────────────────
//  Multi-channel notification fan-out.
//
//  Discord keeps its rich embeds (see discord.ts). Every other channel receives
//  a normalized alert rendered into that platform's native format. Channels are
//  declared in status.config.yml → notifications.
// ─────────────────────────────────────────────────────────────────────────────

import type { StatchConfig } from "./config";
import { sha256Hex } from "./auth";

export type Severity = "up" | "down" | "warning" | "info";

export interface AlertPayload {
  title: string;
  body: string;
  severity: Severity;
  url?: string;
}

const EMOJI: Record<Severity, string> = { up: "✅", down: "🔴", warning: "🟠", info: "📝" };
const HEX: Record<Severity, string> = {
  up: "4ade80",
  down: "f87171",
  warning: "f59e0b",
  info: "60a5fa",
};

async function post(url: string, body: string, contentType = "application/json"): Promise<void> {
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Per-platform senders ────────────────────────────────────────────────────

export function sendSlack(url: string, a: AlertPayload): Promise<void> {
  const link = a.url ? `\n<${a.url}|View status page>` : "";
  return post(url, JSON.stringify({ text: `${EMOJI[a.severity]} *${a.title}*\n${a.body}${link}` }));
}

export function sendTeams(url: string, a: AlertPayload): Promise<void> {
  const text = a.url ? `${a.body}\n\n[View status page](${a.url})` : a.body;
  return post(
    url,
    JSON.stringify({
      "@type": "MessageCard",
      "@context": "https://schema.org/extensions",
      summary: a.title,
      themeColor: HEX[a.severity],
      title: `${EMOJI[a.severity]} ${a.title}`,
      text,
    })
  );
}

export function sendTelegram(botToken: string, chatId: string, a: AlertPayload): Promise<void> {
  const link = a.url ? `\n<a href="${a.url}">View status page</a>` : "";
  return post(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    JSON.stringify({
      chat_id: chatId,
      text: `${EMOJI[a.severity]} <b>${escapeHtml(a.title)}</b>\n${escapeHtml(a.body)}${link}`,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    })
  );
}

export async function sendPagerDuty(routingKey: string, a: AlertPayload): Promise<void> {
  // Events API v2. "up" resolves the alert; everything else triggers/updates it.
  const dedupKey = (await sha256Hex(a.title)).slice(0, 32);
  const severity = a.severity === "down" ? "critical" : a.severity === "warning" ? "warning" : "info";
  await post(
    "https://events.pagerduty.com/v2/enqueue",
    JSON.stringify({
      routing_key: routingKey,
      event_action: a.severity === "up" ? "resolve" : "trigger",
      dedup_key: dedupKey,
      payload: { summary: a.title, source: "statch", severity, custom_details: { body: a.body, url: a.url } },
    })
  );
}

export function sendGenericWebhook(url: string, template: string | undefined, a: AlertPayload): Promise<void> {
  if (template) {
    const body = template
      .replace(/\{\{\s*title\s*\}\}/g, a.title)
      .replace(/\{\{\s*body\s*\}\}/g, a.body)
      .replace(/\{\{\s*severity\s*\}\}/g, a.severity)
      .replace(/\{\{\s*url\s*\}\}/g, a.url ?? "");
    return post(url, body);
  }
  return post(url, JSON.stringify(a));
}

// ─── Fan-out ─────────────────────────────────────────────────────────────────

/** Send a normalized alert to every non-Discord channel declared in config. */
export async function fanoutChannels(config: StatchConfig, a: AlertPayload): Promise<void> {
  const n = config.notifications;
  await Promise.all([
    ...n.slack.map((c) => sendSlack(c.url, a)),
    ...n.teams.map((c) => sendTeams(c.url, a)),
    ...n.telegram.map((c) => sendTelegram(c.botToken, c.chatId, a)),
    ...n.pagerduty.map((c) => sendPagerDuty(c.routingKey, a)),
    ...n.webhook.map((c) => sendGenericWebhook(c.url, c.template, a)),
  ]);
}
