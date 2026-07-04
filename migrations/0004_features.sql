-- Push subscriptions (Web Push / PWA notifications)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  device_name TEXT NOT NULL DEFAULT 'Unknown device',
  created_at INTEGER NOT NULL
);

-- Maintenance windows
CREATE TABLE IF NOT EXISTS maintenance_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  monitor_ids TEXT, -- JSON array of monitor IDs
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | active | completed | cancelled
  created_at INTEGER NOT NULL
);

-- Monitor groups (visual grouping on status page)
CREATE TABLE IF NOT EXISTS monitor_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Latency samples for history charts
CREATE TABLE IF NOT EXISTS latency_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  checked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_latency_samples_monitor ON latency_samples(monitor_id, checked_at DESC);

-- Widen monitors.type to include 'tcp' + add group_id column.
-- SQLite cannot ALTER CHECK constraints, so recreate the table.
-- D1 does not enforce foreign keys by default, so the DROP is safe.
CREATE TABLE monitors_v2 (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('push', 'http', 'tcp')),
  name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'up', 'down', 'paused')),
  pairing_code TEXT,
  claimed INTEGER NOT NULL DEFAULT 0,
  agent_token_hash TEXT,
  target_url TEXT,
  interval_seconds INTEGER NOT NULL DEFAULT 30,
  grace_seconds INTEGER NOT NULL DEFAULT 90,
  last_seen_at INTEGER,
  last_latency_ms INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  registering_ip TEXT,
  agent_group_id TEXT,
  group_id INTEGER
);

INSERT INTO monitors_v2
  SELECT id, type, name, status, pairing_code, claimed, agent_token_hash, target_url,
         interval_seconds, grace_seconds, last_seen_at, last_latency_ms, sort_order,
         created_at, registering_ip, agent_group_id, NULL
  FROM monitors;

DROP TABLE monitors;
ALTER TABLE monitors_v2 RENAME TO monitors;

CREATE UNIQUE INDEX idx_monitors_pairing_code ON monitors(pairing_code) WHERE pairing_code IS NOT NULL;
CREATE INDEX idx_monitors_agent_token ON monitors(agent_token_hash) WHERE agent_token_hash IS NOT NULL;
CREATE INDEX idx_monitors_status ON monitors(claimed, status);
CREATE INDEX idx_monitors_agent_group ON monitors(agent_group_id) WHERE agent_group_id IS NOT NULL;

-- Add VAPID keys to settings (auto-generated on first use, stored in DB)
ALTER TABLE settings ADD COLUMN vapid_private_jwk TEXT;
ALTER TABLE settings ADD COLUMN vapid_public_key TEXT;
ALTER TABLE settings ADD COLUMN vapid_subject TEXT DEFAULT 'mailto:admin@status.local';
