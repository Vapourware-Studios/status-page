import type { Context } from "hono";
import { desc, eq } from "drizzle-orm";
import type { Env } from "../types";
import { getDb } from "../db";
import { incidents, incidentUpdates, settings } from "../schema";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// RSS 2.0 feed of incidents so people can subscribe without email.
export async function handleRss(c: Context<{ Bindings: Env }>): Promise<Response> {
  const db = getDb(c.env);
  const base = c.env.SERVER_URL;

  const [cfg] = await db.select({ pageTitle: settings.pageTitle, headline: settings.headline }).from(settings).limit(1);
  const title = cfg?.pageTitle ?? "Statch";

  const rows = await db
    .select()
    .from(incidents)
    .orderBy(desc(incidents.createdAt))
    .limit(40)
    .all();

  const items = await Promise.all(
    rows.map(async (inc) => {
      const [latest] = await db
        .select({ body: incidentUpdates.body, createdAt: incidentUpdates.createdAt })
        .from(incidentUpdates)
        .where(eq(incidentUpdates.incidentId, inc.id))
        .orderBy(desc(incidentUpdates.createdAt))
        .limit(1);
      const link = `${base}/incidents/${inc.id}`;
      const desc = latest?.body ?? `${inc.impact} impact · ${inc.status}`;
      const date = new Date(inc.resolvedAt ?? latest?.createdAt ?? inc.createdAt).toUTCString();
      return `    <item>
      <title>${esc(inc.title)} [${esc(inc.status)}]</title>
      <link>${esc(link)}</link>
      <guid isPermaLink="false">incident-${inc.id}-${inc.status}</guid>
      <pubDate>${date}</pubDate>
      <description>${esc(desc)}</description>
    </item>`;
    })
  );

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${esc(title)} — Incident history</title>
    <link>${esc(base)}</link>
    <description>${esc(cfg?.headline ?? "Status updates and incident history")}</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items.join("\n")}
  </channel>
</rss>`;

  return c.body(xml, 200, {
    "Content-Type": "application/rss+xml; charset=utf-8",
    "Cache-Control": "public, max-age=120, s-maxage=120",
  });
}
