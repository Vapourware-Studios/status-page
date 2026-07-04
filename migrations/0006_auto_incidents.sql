-- Auto-incidents: cron opens a single rolling incident when monitors go down,
-- attaches further downs to it, and auto-resolves when all recover.

-- Mark incidents the system created automatically (vs. admin-created).
ALTER TABLE incidents ADD COLUMN auto_created INTEGER NOT NULL DEFAULT 0;

-- Master switch for auto-incident behaviour (admin can disable in Settings).
ALTER TABLE settings ADD COLUMN auto_incidents INTEGER NOT NULL DEFAULT 1;

-- Fix bogus default VAPID subject: Apple's push service rejects the `.local`
-- TLD with BadJwtToken, so existing rows that still hold the old default get
-- nulled and re-derived from SERVER_URL at send time.
UPDATE settings SET vapid_subject = NULL WHERE vapid_subject = 'mailto:admin@status.local';

-- Find the open rolling auto-incident quickly.
CREATE INDEX IF NOT EXISTS idx_incidents_auto_open ON incidents(auto_created, status);
