export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  SERVER_URL: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_ALLOWED_USER_IDS: string; // comma-separated Discord user IDs
  OWNER_DISCORD_ID: string; // Discord user ID of the owner (can manage users)
}
