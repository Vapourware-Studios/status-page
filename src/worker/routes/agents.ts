import { Hono } from "hono";
import { eq, and, isNull, asc } from "drizzle-orm";
import type { Env } from "../types";
import { getDb } from "../db";
import { monitors, enrollTokens, events } from "../schema";
import { generateAgentToken } from "../pairing";
import { sha256Hex } from "../auth";

export const agentsRouter = new Hono<{ Bindings: Env }>();

// POST /api/agents/enroll — Cloudflare-tunnel-style auto-discovery.
// The machine presents a one-shot enrolment token (minted in /admin) and its
// hostname; we create a live push monitor on the spot and hand back a durable
// agent token. No pairing code, no manual claim — it just shows up.
agentsRouter.post("/enroll", async (c) => {
  const auth = c.req.header("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return c.text("Unauthorized\n", 401);
  const enrollToken = auth.slice(7).trim();
  if (!enrollToken) return c.text("Unauthorized\n", 401);

  const db = getDb(c.env);
  const now = Date.now();
  const enrollHash = await sha256Hex(enrollToken);

  const [tok] = await db
    .select()
    .from(enrollTokens)
    .where(and(eq(enrollTokens.tokenHash, enrollHash), isNull(enrollTokens.usedAt)))
    .limit(1);

  if (!tok || tok.expiresAt < now) {
    return c.text("Invalid or expired enrolment token\n", 401);
  }

  const body = await c.req
    .json<{ hostname?: string }>()
    .catch(() => ({}) as { hostname?: string });
  const hostname = (body.hostname ?? "").trim().slice(0, 64) || "Unnamed server";

  // Burn the token so it can only enrol one machine.
  await db.update(enrollTokens).set({ usedAt: now }).where(eq(enrollTokens.id, tok.id));

  const agentToken = generateAgentToken();
  const id = crypto.randomUUID();
  const existing = await db
    .select({ sortOrder: monitors.sortOrder })
    .from(monitors)
    .orderBy(asc(monitors.sortOrder));
  const maxOrder = existing.length ? (existing[existing.length - 1]?.sortOrder ?? 0) + 1 : 0;

  await db.insert(monitors).values({
    id,
    type: "push",
    source: "agent",
    name: tok.label || hostname,
    status: "pending",
    claimed: true,
    agentTokenHash: await sha256Hex(agentToken),
    agentGroupId: id,
    groupId: tok.groupId ?? null,
    intervalSeconds: 30,
    graceSeconds: 90,
    sortOrder: maxOrder,
    createdAt: now,
    registeringIp:
      c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For") ?? null,
  });

  await db.insert(events).values({
    monitorId: id,
    status: "up",
    message: `Agent enrolled from ${hostname}`,
    createdAt: now,
  });

  // KEY=VALUE — the installer parses with grep/sed, no jq required.
  return c.text(`MONITOR_ID=${id}\nAGENT_TOKEN=${agentToken}\nNAME=${tok.label || hostname}\n`, 200, {
    "Content-Type": "text/plain",
  });
});
