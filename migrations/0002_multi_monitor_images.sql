-- Multiple monitors per agent + image attachments on incident updates

ALTER TABLE monitors ADD COLUMN agent_group_id TEXT;
ALTER TABLE incident_updates ADD COLUMN image_urls TEXT; -- JSON array of URL strings

-- Backfill: each existing claimed push monitor is its own group
UPDATE monitors SET agent_group_id = id WHERE type = 'push' AND claimed = 1;

CREATE INDEX idx_monitors_agent_group ON monitors(agent_group_id) WHERE agent_group_id IS NOT NULL;
