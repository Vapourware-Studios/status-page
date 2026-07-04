/*
 * Statch — an edge-native, config-as-code status page.
 * Copyright (C) 2026 Mr_chank <https://chank.dev> (https://github.com/chank-op)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq, desc } from "drizzle-orm";
import type { Env } from "./types";
import { authRouter } from "./routes/auth";
import { agentsRouter } from "./routes/agents";
import { publicRouter } from "./routes/public";
import { v1Router } from "./routes/v1";
import { adminRouter } from "./routes/admin/index";
import { pushRouter } from "./routes/push";
import { handleInstall } from "./routes/install";
import { handleEmbed } from "./routes/embed";
import { handleRss } from "./routes/rss";
import { cronHandler } from "./cron";
import { sha256Hex } from "./auth";
import { getDb } from "./db";
import { monitors, settings, incidents, incidentUpdates } from "./schema";
import { generateOgImage } from "./ogimage";
import { getPageStatus } from "./pagestatus";

const PREVIEW_BOT_UAS = ["discordbot", "twitterbot", "facebookexternalhit", "linkedinbot", "slackbot", "whatsapp", "telegrambot"];

// Bump this whenever the OG image design changes so social platforms (Discord
// especially) refetch the image instead of serving a stale cached one.
const OG_IMAGE_VERSION = "8";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const app = new Hono<{ Bindings: Env }>();

app.use(
  "/api/*",
  cors({
    origin: (origin) => origin,
    credentials: true,
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

app.get("/", async (c) => {
  const ua = c.req.header("user-agent") ?? "";
  if (!PREVIEW_BOT_UAS.some((b) => ua.toLowerCase().includes(b))) {
    return c.env.ASSETS.fetch(c.req.raw);
  }

  const db = getDb(c.env);
  const now = Date.now();

  const [cfgRows, allMonitors] = await Promise.all([
    db.select({ pageTitle: settings.pageTitle }).from(settings).limit(1),
    db
      .select({ name: monitors.name, id: monitors.id, type: monitors.type, status: monitors.status, lastSeenAt: monitors.lastSeenAt, graceSeconds: monitors.graceSeconds })
      .from(monitors)
      .where(eq(monitors.claimed, true))
      .orderBy(monitors.sortOrder, monitors.createdAt)
      .all(),
  ]);

  const pageTitle = cfgRows[0]?.pageTitle ?? "System Status";

  const liveStatus = (m: { type: string; status: string; lastSeenAt: number | null; graceSeconds: number }) => {
    if (m.status === "paused") return "paused";
    if (m.type === "push") return !m.lastSeenAt || now - m.lastSeenAt > m.graceSeconds * 1000 ? "down" : "up";
    return m.status as "up" | "down";
  };

  const statuses = allMonitors.map((m) => ({ name: m.name ?? m.id, s: liveStatus(m) }));

  // Badge/theme reflect the whole page (incidents > maintenance > down > ok).
  const { status: overallStatus, label: overallLabel, themeColor } = await getPageStatus(db, now);

  const emoji = (s: string) => s === "up" ? "✅" : s === "paused" ? "⏸️" : "🔴";
  const description = statuses.length > 0
    ? statuses.map((m) => `${emoji(m.s)} ${m.name}`).join("  ·  ")
    : "No services configured";

  const siteUrl = c.env.SERVER_URL ?? "https://status.example.com";
  const title = escapeHtml(`${overallLabel} | ${pageTitle}`);
  const desc = escapeHtml(description);
  const ogImageUrl = `${siteUrl}/og.png?s=${overallStatus}&v=${OG_IMAGE_VERSION}`;

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${title}</title>
<meta property="og:type" content="website" />
<meta property="og:url" content="${siteUrl}" />
<meta property="og:site_name" content="${escapeHtml(pageTitle)}" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${desc}" />
<meta property="og:image" content="${ogImageUrl}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${desc}" />
<meta name="twitter:image" content="${ogImageUrl}" />
<meta name="theme-color" content="${themeColor}" />
</head>
<body></body>
</html>`);
});

app.get("/og.png", async (c) => {
  const db = getDb(c.env);
  const now = Date.now();

  const [cfgRows, page] = await Promise.all([
    db.select({ pageTitle: settings.pageTitle }).from(settings).limit(1),
    getPageStatus(db, now),
  ]);

  const pageTitle = cfgRows[0]?.pageTitle ?? "System Status";
  const subtitle =
    page.total > 0
      ? `${page.upCount} of ${page.total} service${page.total !== 1 ? "s" : ""} operational`
      : "";

  const png = await generateOgImage(page.status, pageTitle, subtitle);

  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=60, s-maxage=60",
    },
  });
});

// Discord/social preview + generated card for a single incident.
// Humans get the SPA (served via ASSETS); preview bots get OG meta tags.
app.get("/incidents/:id/og.png", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = getDb(c.env);
  const now = Date.now();

  const [inc] = Number.isNaN(id)
    ? [undefined]
    : await db.select({ title: incidents.title, impact: incidents.impact }).from(incidents).where(eq(incidents.id, id)).limit(1);

  const page = await getPageStatus(db, now);

  if (!inc) {
    const cfgRows = await db.select({ pageTitle: settings.pageTitle }).from(settings).limit(1);
    const png = await generateOgImage(page.status, cfgRows[0]?.pageTitle ?? "System Status", page.label);
    return new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=60, s-maxage=60" } });
  }

  const [update] = await db
    .select({ body: incidentUpdates.body })
    .from(incidentUpdates)
    .where(eq(incidentUpdates.incidentId, id))
    .orderBy(desc(incidentUpdates.createdAt))
    .limit(1);

  const subtitle = update?.body ?? `${inc.impact} impact incident`;
  const png = await generateOgImage(page.status, inc.title, subtitle);

  return new Response(png, {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=60, s-maxage=60" },
  });
});

app.get("/incidents/:id", async (c) => {
  const ua = c.req.header("user-agent") ?? "";
  const isBot = PREVIEW_BOT_UAS.some((b) => ua.toLowerCase().includes(b));
  const id = parseInt(c.req.param("id"), 10);

  // Non-bots (and malformed ids) get the single-page app.
  if (!isBot || Number.isNaN(id)) return c.env.ASSETS.fetch(c.req.raw);

  const db = getDb(c.env);
  const now = Date.now();

  const [inc] = await db
    .select({ title: incidents.title, impact: incidents.impact, status: incidents.status, createdAt: incidents.createdAt })
    .from(incidents)
    .where(eq(incidents.id, id))
    .limit(1);

  // Unknown incident: let the SPA render its own 404.
  if (!inc) return c.env.ASSETS.fetch(c.req.raw);

  const [cfgRows, [update], page] = await Promise.all([
    db.select({ pageTitle: settings.pageTitle }).from(settings).limit(1),
    db
      .select({ body: incidentUpdates.body })
      .from(incidentUpdates)
      .where(eq(incidentUpdates.incidentId, id))
      .orderBy(desc(incidentUpdates.createdAt))
      .limit(1),
    getPageStatus(db, now),
  ]);

  const pageTitle = cfgRows[0]?.pageTitle ?? "System Status";
  const siteUrl = c.env.SERVER_URL ?? "https://status.example.com";
  const description = update?.body ?? `${inc.impact} impact · ${inc.status}`;

  const title = escapeHtml(inc.title);
  const descTag = escapeHtml(description);
  const pageUrl = `${siteUrl}/incidents/${id}`;
  const ogImageUrl = `${siteUrl}/incidents/${id}/og.png?v=${OG_IMAGE_VERSION}`;

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${title} | ${escapeHtml(pageTitle)}</title>
<meta property="og:type" content="article" />
<meta property="og:url" content="${pageUrl}" />
<meta property="og:site_name" content="${escapeHtml(pageTitle)}" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${descTag}" />
<meta property="og:image" content="${ogImageUrl}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${descTag}" />
<meta name="twitter:image" content="${ogImageUrl}" />
<meta name="theme-color" content="${page.themeColor}" />
</head>
<body></body>
</html>`);
});

app.get("/install.sh", handleInstall);
app.get("/embed.js", handleEmbed);
app.get("/rss.xml", handleRss);

app.route("/api/auth", authRouter);
app.route("/api/agents", agentsRouter);
app.route("/api/push", pushRouter);

app.post("/api/heartbeat", async (c) => {
  const authHeader = c.req.header("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return c.json({ error: "Unauthorized" }, 401);
  const token = authHeader.slice(7);
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  const tokenHash = await sha256Hex(token);
  const db = getDb(c.env);

  const [auth] = await db
    .select({ id: monitors.id })
    .from(monitors)
    .where(eq(monitors.agentTokenHash, tokenHash))
    .limit(1);

  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{ latency_ms?: number }>().catch(() => ({} as { latency_ms?: number }));
  const now = Date.now();

  await db
    .update(monitors)
    .set({
      lastSeenAt: now,
      ...(body.latency_ms != null ? { lastLatencyMs: body.latency_ms } : {}),
    })
    .where(eq(monitors.agentTokenHash, tokenHash));

  return c.json({ ok: true });
});

app.route("/api/v1", v1Router);
app.route("/api/admin", adminRouter);
app.route("/api", publicRouter);

export default {
  fetch: app.fetch,
  scheduled: cronHandler,
};
