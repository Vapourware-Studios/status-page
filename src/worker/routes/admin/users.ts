import { Hono } from "hono";
import type { Env } from "../../types";
import { getDb } from "../../db";
import { allowedUsers } from "../../schema";
import { eq, asc } from "drizzle-orm";
import {
  getCookie,
  SESSION_COOKIE,
  getSessionDiscordUserId,
  isOwner,
  deleteAllUserSessions,
} from "../../auth";

export const usersAdminRouter = new Hono<{ Bindings: Env }>();

usersAdminRouter.get("/", async (c) => {
  const db = getDb(c.env);
  const users = await db
    .select()
    .from(allowedUsers)
    .orderBy(asc(allowedUsers.createdAt))
    .all();
  return c.json({ users, ownerId: c.env.OWNER_DISCORD_ID ?? "" });
});

usersAdminRouter.post("/", async (c) => {
  const cookie = getCookie(c.req.raw, SESSION_COOKIE);
  const db = getDb(c.env);
  const requesterId = cookie ? await getSessionDiscordUserId(db, cookie) : null;
  if (!requesterId || !isOwner(c.env, requesterId)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const { discordUserId } = await c.req.json<{ discordUserId?: string }>();
  if (!discordUserId?.trim()) {
    return c.json({ error: "discordUserId required" }, 400);
  }

  const trimmed = discordUserId.trim();
  await db
    .insert(allowedUsers)
    .values({
      discordUserId: trimmed,
      addedBy: requesterId,
      createdAt: Date.now(),
    })
    .onConflictDoNothing();

  return c.json({ ok: true });
});

usersAdminRouter.delete("/:id", async (c) => {
  const cookie = getCookie(c.req.raw, SESSION_COOKIE);
  const db = getDb(c.env);
  const requesterId = cookie ? await getSessionDiscordUserId(db, cookie) : null;
  if (!requesterId || !isOwner(c.env, requesterId)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const targetId = c.req.param("id");
  if (c.env.OWNER_DISCORD_ID && targetId === c.env.OWNER_DISCORD_ID) {
    return c.json({ error: "Cannot remove owner" }, 400);
  }

  await deleteAllUserSessions(db, targetId);
  await db.delete(allowedUsers).where(eq(allowedUsers.discordUserId, targetId));

  return c.json({ ok: true });
});
