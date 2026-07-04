-- Config-as-code engine + richer monitoring.
--
--   slug/source          : config-managed monitors are keyed by slug and
--                          reconciled from status.config.yml; agents and
--                          admin-created monitors are left untouched.
--   fail_count           : consecutive failures, for "N failures before down".
--   expect_status/body   : HTTP assertions (status codes / body substring).
--   degraded_response_ms : slower responses flip the monitor to "degraded".
--   check_ssl/ssl_expires_at : TLS certificate expiry tracking.
--   settings.accent/logo/confirmations/config_hash : branding + alerting +
--                          a hash guard so unchanged config is a no-op sync.
--   enroll_tokens        : one-shot tokens for pairing-code-free agent enrol.

ALTER TABLE monitors ADD COLUMN slug TEXT;
ALTER TABLE monitors ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE monitors ADD COLUMN fail_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE monitors ADD COLUMN expect_status TEXT;
ALTER TABLE monitors ADD COLUMN expect_body TEXT;
ALTER TABLE monitors ADD COLUMN degraded_response_ms INTEGER;
ALTER TABLE monitors ADD COLUMN check_ssl INTEGER NOT NULL DEFAULT 0;
ALTER TABLE monitors ADD COLUMN ssl_expires_at INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_monitors_slug ON monitors(slug) WHERE slug IS NOT NULL;

ALTER TABLE settings ADD COLUMN accent TEXT NOT NULL DEFAULT '#6366f1';
ALTER TABLE settings ADD COLUMN logo TEXT;
ALTER TABLE settings ADD COLUMN confirmations INTEGER NOT NULL DEFAULT 1;
ALTER TABLE settings ADD COLUMN config_hash TEXT;

CREATE TABLE IF NOT EXISTS enroll_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  label TEXT,
  group_id INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
