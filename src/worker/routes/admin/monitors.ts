import { Hono } from "hono";
import { eq, asc } from "drizzle-orm";
import type { Env } from "../../types";
import { getDb } from "../../db";
import { monitors, events, enrollTokens } from "../../schema";
import { notifyMonitorTransition } from "../../notify";
import { generateAgentToken } from "../../pairing";
import { sha256Hex } from "../../auth";

const r = new Hono<{ Bindings: Env }>();

r.get("/", async (c) => {
  const db = getDb(c.env);
  const rows = await db
    .select()
    .from(monitors)
    .orderBy(asc(monitors.sortOrder), asc(monitors.createdAt));
  return c.json({ monitors: rows });
});

// Mint a one-shot enrolment token (Cloudflare-tunnel style). The admin copies
// the printed one-liner onto a box; the agent enrols and appears live — no
// pairing code to type back in.
r.post("/enroll-token", async (c) => {
  const { label, groupId } = await c.req
    .json<{ label?: string; groupId?: number | null }>()
    .catch(() => ({}) as { label?: string; groupId?: number | null });

  const db = getDb(c.env);
  const token = generateAgentToken();
  const now = Date.now();
  const ttlMs = 60 * 60 * 1000; // 1 hour to run the installer

  await db.insert(enrollTokens).values({
    id: crypto.randomUUID(),
    tokenHash: await sha256Hex(token),
    label: label?.trim() || null,
    groupId: groupId ?? null,
    createdAt: now,
    expiresAt: now + ttlMs,
  });

  const install = `curl -fsSL ${c.env.SERVER_URL}/install.sh | STATCH_TOKEN=${token} sh`;
  return c.json({ ok: true, token, install, expiresAt: now + ttlMs });
});

r.post("/http", async (c) => {
  const { name, targetUrl, intervalSeconds, graceSeconds } = await c.req.json<{
    name?: string;
    targetUrl?: string;
    intervalSeconds?: number;
    graceSeconds?: number;
  }>();

  if (!name?.trim() || !targetUrl?.trim()) {
    return c.json({ error: "name and targetUrl required" }, 400);
  }
  try {
    new URL(targetUrl);
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }

  const db = getDb(c.env);
  const now = Date.now();
  const id = crypto.randomUUID();
  const existing = await db.select({ sortOrder: monitors.sortOrder }).from(monitors).orderBy(asc(monitors.sortOrder));
  const maxOrder = existing.length > 0 ? (existing[existing.length - 1]?.sortOrder ?? 0) + 1 : 0;

  await db.insert(monitors).values({
    id,
    type: "http",
    source: "manual",
    name: name.trim(),
    status: "pending",
    claimed: true,
    targetUrl: targetUrl.trim(),
    intervalSeconds: intervalSeconds ?? 60,
    graceSeconds: graceSeconds ?? 90,
    sortOrder: maxOrder,
    createdAt: now,
  });

  return c.json({ ok: true, monitorId: id });
});

// TCP port monitor: targetUrl stores "hostname:port"
r.post("/tcp", async (c) => {
  const { name, target } = await c.req.json<{
    name?: string;
    target?: string;
  }>();

  if (!name?.trim() || !target?.trim()) {
    return c.json({ error: "name and target required" }, 400);
  }
  const parts = target.split(":");
  const port = parseInt(parts[parts.length - 1] ?? "", 10);
  if (parts.length < 2 || isNaN(port) || port < 1 || port > 65535) {
    return c.json({ error: "target must be host:port" }, 400);
  }

  const db = getDb(c.env);
  const now = Date.now();
  const id = crypto.randomUUID();
  const existing = await db.select({ sortOrder: monitors.sortOrder }).from(monitors).orderBy(asc(monitors.sortOrder));
  const maxOrder = existing.length > 0 ? (existing[existing.length - 1]?.sortOrder ?? 0) + 1 : 0;

  await db.insert(monitors).values({
    id,
    type: "tcp",
    source: "manual",
    name: name.trim(),
    status: "pending",
    claimed: true,
    targetUrl: target.trim(),
    intervalSeconds: 60,
    graceSeconds: 90,
    sortOrder: maxOrder,
    createdAt: now,
  });

  return c.json({ ok: true, monitorId: id });
});

r.patch("/:id", async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json<{
    name?: string;
    status?: "paused" | "up";
    targetUrl?: string;
    intervalSeconds?: number;
    graceSeconds?: number;
    sortOrder?: number;
    groupId?: number | null;
    externalStatusLabel?: string | null;
    externalStatusUrl?: string | null;
    checkCloudflare?: boolean;
    degradedResponseMs?: number | null;
    checkSsl?: boolean;
    expectBody?: string | null;
  }>();

  const db = getDb(c.env);
  const [monitor] = await db.select().from(monitors).where(eq(monitors.id, id)).limit(1);
  if (!monitor) return c.json({ error: "Not found" }, 404);

  type MonitorPatch = {
    name?: string;
    status?: "pending" | "up" | "degraded" | "down" | "paused";
    targetUrl?: string;
    intervalSeconds?: number;
    graceSeconds?: number;
    sortOrder?: number;
    groupId?: number | null;
    externalStatusLabel?: string | null;
    externalStatusUrl?: string | null;
    checkCloudflare?: boolean;
    degradedResponseMs?: number | null;
    checkSsl?: boolean;
    expectBody?: string | null;
  };
  const patch: MonitorPatch = {};
  if (body.name != null) patch.name = body.name.trim();
  if (body.status != null) patch.status = body.status;
  if (body.targetUrl != null) patch.targetUrl = body.targetUrl.trim();
  if (body.intervalSeconds != null) patch.intervalSeconds = body.intervalSeconds;
  if (body.graceSeconds != null) patch.graceSeconds = body.graceSeconds;
  if (body.sortOrder != null) patch.sortOrder = body.sortOrder;
  if ("groupId" in body) patch.groupId = body.groupId ?? null;
  if ("externalStatusLabel" in body) {
    const v = body.externalStatusLabel?.trim();
    patch.externalStatusLabel = v ? v : null;
  }
  if ("externalStatusUrl" in body) {
    const v = body.externalStatusUrl?.trim();
    patch.externalStatusUrl = v ? v : null;
  }
  if (typeof body.checkCloudflare === "boolean") patch.checkCloudflare = body.checkCloudflare;
  if (typeof body.checkSsl === "boolean") patch.checkSsl = body.checkSsl;
  if ("degradedResponseMs" in body) patch.degradedResponseMs = body.degradedResponseMs ?? null;
  if ("expectBody" in body) {
    const v = body.expectBody?.trim();
    patch.expectBody = v ? v : null;
  }

  await db.update(monitors).set(patch).where(eq(monitors.id, id));

  if (body.status && body.status !== monitor.status) {
    const now = Date.now();
    await db.insert(events).values({
      monitorId: id,
      status: body.status === "paused" ? "paused" : "up",
      message: body.status === "paused" ? "Monitor paused" : "Monitor resumed",
      createdAt: now,
    });
    if (monitor.name) {
      await notifyMonitorTransition(db, c.env, monitor.name, monitor.status, body.status, undefined, {
        type: monitor.type,
        target: monitor.targetUrl,
        lastLatencyMs: monitor.lastLatencyMs,
      });
    }
  }

  return c.json({ ok: true });
});

r.post("/reorder", async (c) => {
  const { order } = await c.req.json<{ order?: string[] }>();
  if (!Array.isArray(order)) return c.json({ error: "order array required" }, 400);
  const db = getDb(c.env);
  await Promise.all(
    order.map((mid, idx) =>
      db.update(monitors).set({ sortOrder: idx }).where(eq(monitors.id, mid))
    )
  );
  return c.json({ ok: true });
});

r.post("/:id/add", async (c) => {
  const { id } = c.req.param();
  const { name } = await c.req.json<{ name?: string }>();
  if (!name?.trim()) return c.json({ error: "name required" }, 400);

  const db = getDb(c.env);
  const [parent] = await db.select().from(monitors).where(eq(monitors.id, id)).limit(1);
  if (!parent) return c.json({ error: "Not found" }, 404);
  if (parent.type !== "push" || !parent.claimed || !parent.agentTokenHash) {
    return c.json({ error: "Parent must be a claimed push monitor" }, 400);
  }

  const groupId = parent.agentGroupId ?? parent.id;
  const now = Date.now();
  const newId = crypto.randomUUID();
  const existing = await db.select({ sortOrder: monitors.sortOrder }).from(monitors).orderBy(asc(monitors.sortOrder));
  const maxOrder = existing.length > 0 ? (existing[existing.length - 1]?.sortOrder ?? 0) + 1 : 0;

  await db.insert(monitors).values({
    id: newId,
    type: "push",
    source: "agent",
    name: name.trim(),
    status: "up",
    claimed: true,
    agentTokenHash: parent.agentTokenHash,
    agentGroupId: groupId,
    intervalSeconds: parent.intervalSeconds,
    graceSeconds: parent.graceSeconds,
    sortOrder: maxOrder,
    createdAt: now,
  });

  await db.insert(events).values({
    monitorId: newId,
    status: "up",
    message: "Monitor added to agent group",
    createdAt: now,
  });

  return c.json({ ok: true, monitorId: newId });
});

r.delete("/:id", async (c) => {
  const { id } = c.req.param();
  const db = getDb(c.env);
  await db.delete(monitors).where(eq(monitors.id, id));
  return c.json({ ok: true });
});

export const monitorsAdminRouter = r;
