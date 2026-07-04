-- DB-backed sessions (replaces stateless HMAC tokens)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_discord_user ON sessions(discord_user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Allowed Discord users (replaces DISCORD_ALLOWED_USER_IDS env var)
CREATE TABLE IF NOT EXISTS allowed_users (
  discord_user_id TEXT PRIMARY KEY,
  added_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- No users are seeded. Bootstrap access via the /admin password
-- (ADMIN_PASSWORD), then add Discord users from the admin Users tab.
