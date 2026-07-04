import type { Context, Next } from "hono";
import type { Env } from "./types";
import { getDb } from "./db";
import { sessions, allowedUsers } from "./schema";
import { eq, and, gt } from "drizzle-orm";

export const SESSION_COOKIE = "statch_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export function isOwner(env: Env, discordUserId: string): boolean {
  return (
    (!!env.OWNER_DISCORD_ID && discordUserId === env.OWNER_DISCORD_ID) ||
    discordUserId === "__password__"
  );
}

export async function createDbSession(
  db: ReturnType<typeof getDb>,
  discordUserId: string
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(sessions).values({
    id,
    discordUserId,
    createdAt: now,
    expiresAt: now + SESSION_DURATION_MS,
  });
  return id;
}

export async function getSessionDiscordUserId(
  db: ReturnType<typeof getDb>,
  sessionId: string
): Promise<string | null> {
  const row = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, Date.now())))
    .get();
  return row?.discordUserId ?? null;
}

export async function deleteDbSession(
  db: ReturnType<typeof getDb>,
  sessionId: string
): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function deleteAllUserSessions(
  db: ReturnType<typeof getDb>,
  discordUserId: string
): Promise<void> {
  await db.delete(sessions).where(eq(sessions.discordUserId, discordUserId));
}

export function getCookie(req: Request, name: string): string | null {
  const header = req.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const k = part.slice(0, eqIdx).trim();
    if (k === name) {
      try {
        return decodeURIComponent(part.slice(eqIdx + 1).trim());
      } catch {
        return part.slice(eqIdx + 1).trim();
      }
    }
  }
  return null;
}

export function makeSessionCookie(token: string): string {
  const maxAge = Math.floor(SESSION_DURATION_MS / 1000);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function requireAdmin(
  c: Context<{ Bindings: Env }>,
  next: Next
): Promise<Response | void> {
  const cookie = getCookie(c.req.raw, SESSION_COOKIE);
  if (!cookie) return c.json({ error: "Unauthorized" }, 401);
  const db = getDb(c.env);
  const discordUserId = await getSessionDiscordUserId(db, cookie);
  if (!discordUserId) return c.json({ error: "Unauthorized" }, 401);
  if (discordUserId !== "__password__") {
    const user = await db
      .select()
      .from(allowedUsers)
      .where(eq(allowedUsers.discordUserId, discordUserId))
      .get();
    if (!user) return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
