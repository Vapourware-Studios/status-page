CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Migrate existing discord_webhook_url into the new table
INSERT INTO webhooks (label, url, created_at)
SELECT 'Discord', discord_webhook_url, strftime('%s', 'now') * 1000
FROM settings
WHERE discord_webhook_url IS NOT NULL AND discord_webhook_url != '';
