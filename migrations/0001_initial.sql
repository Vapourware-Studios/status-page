CREATE TABLE IF NOT EXISTS monitors (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('push', 'http')),
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
  registering_ip TEXT
);

CREATE UNIQUE INDEX idx_monitors_pairing_code ON monitors(pairing_code) WHERE pairing_code IS NOT NULL;
CREATE INDEX idx_monitors_agent_token ON monitors(agent_token_hash) WHERE agent_token_hash IS NOT NULL;
CREATE INDEX idx_monitors_status ON monitors(claimed, status);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('up', 'down', 'paused')),
  message TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_events_monitor_created ON events(monitor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'investigating' CHECK(status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  impact TEXT NOT NULL DEFAULT 'minor' CHECK(impact IN ('none', 'minor', 'major', 'critical')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE INDEX idx_incidents_status ON incidents(status, created_at DESC);

CREATE TABLE IF NOT EXISTS incident_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_incident_updates_incident ON incident_updates(incident_id, created_at DESC);

CREATE TABLE IF NOT EXISTS incident_monitors (
  incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  PRIMARY KEY (incident_id, monitor_id)
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  page_title TEXT NOT NULL DEFAULT 'System Status',
  headline TEXT NOT NULL DEFAULT 'Current system status and incident history',
  discord_webhook_url TEXT
);

INSERT OR IGNORE INTO settings (id, page_title, headline)
VALUES (1, 'System Status', 'Current system status and incident history');
