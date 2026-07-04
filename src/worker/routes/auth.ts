import { Hono } from "hono";
import type { Env } from "../types";
import {
  createDbSession,
  getSessionDiscordUserId,
  deleteDbSession,
  isOwner,
  getCookie,
  makeSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
} from "../auth";
import { getDb } from "../db";
import { allowedUsers } from "../schema";
import { eq } from "drizzle-orm";

export const authRouter = new Hono<{ Bindings: Env }>();

const DISCORD_STATE_COOKIE = "statch_dstate";

authRouter.post("/login", async (c) => {
  const { password } = await c.req.json<{ password?: string }>();
  if (!password || password !== c.env.ADMIN_PASSWORD) {
    return c.json({ error: "Invalid password" }, 401);
  }
  const db = getDb(c.env);
  const sessionId = await createDbSession(db, "__password__");
  c.header("Set-Cookie", makeSessionCookie(sessionId));
  return c.json({ ok: true });
});

authRouter.post("/logout", async (c) => {
  const cookie = getCookie(c.req.raw, SESSION_COOKIE);
  if (cookie) {
    const db = getDb(c.env);
    await deleteDbSession(db, cookie);
  }
  c.header("Set-Cookie", clearSessionCookie());
  return c.json({ ok: true });
});

authRouter.get("/me", async (c) => {
  const cookie = getCookie(c.req.raw, SESSION_COOKIE);
  if (!cookie) return c.json({ authenticated: false });
  const db = getDb(c.env);
  const discordUserId = await getSessionDiscordUserId(db, cookie);
  if (!discordUserId) return c.json({ authenticated: false });
  return c.json({
    authenticated: true,
    isOwner: isOwner(c.env, discordUserId),
    discordUserId,
  });
});

authRouter.get("/discord", (c) => {
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: c.env.DISCORD_CLIENT_ID,
    redirect_uri: `${c.env.SERVER_URL}/api/auth/discord/callback`,
    response_type: "code",
    scope: "identify",
    state,
    prompt: "consent",
  });

  c.header(
    "Set-Cookie",
    `${DISCORD_STATE_COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=300`
  );
  return c.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

authRouter.get("/discord/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const storedState = getCookie(c.req.raw, DISCORD_STATE_COOKIE);

  const clearState = `${DISCORD_STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

  if (!code || !state || state !== storedState) {
    c.header("Set-Cookie", clearState);
    return c.redirect("/admin?error=oauth_state_mismatch");
  }

  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.env.DISCORD_CLIENT_ID,
      client_secret: c.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${c.env.SERVER_URL}/api/auth/discord/callback`,
    }),
  });

  if (!tokenRes.ok) {
    c.header("Set-Cookie", clearState);
    return c.redirect("/admin?error=token_exchange_failed");
  }

  const { access_token } = await tokenRes.json<{ access_token: string }>();

  const userRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!userRes.ok) {
    c.header("Set-Cookie", clearState);
    return c.redirect("/admin?error=user_fetch_failed");
  }

  const user = await userRes.json<{ id: string; username: string }>();

  const db = getDb(c.env);
  const userRow = await db
    .select()
    .from(allowedUsers)
    .where(eq(allowedUsers.discordUserId, user.id))
    .get();

  if (!userRow) {
    c.header("Set-Cookie", clearState);
    return c.redirect(
      `/admin?error=not_authorized&user=${encodeURIComponent(user.username)}`
    );
  }

  const sessionId = await createDbSession(db, user.id);
  c.header("Set-Cookie", clearState);
  c.header("Set-Cookie", makeSessionCookie(sessionId), { append: true });
  return c.redirect("/admin");
});
