-- Per-monitor extras:
--   external_status_*: link a monitor to a third-party provider's official
--     status page. The public page shows "Official status for <label>".
--   check_cloudflare: when this monitor goes down, cron probes Cloudflare's
--     status (Brisbane/Workers/Pages/DNS/global) and, on a match, adds a note
--     to the incident saying the outage was likely a Cloudflare problem.

ALTER TABLE monitors ADD COLUMN external_status_label TEXT;
ALTER TABLE monitors ADD COLUMN external_status_url TEXT;
ALTER TABLE monitors ADD COLUMN check_cloudflare INTEGER NOT NULL DEFAULT 0;
