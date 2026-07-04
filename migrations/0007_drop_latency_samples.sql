-- Latency is now rendered live in the browser from monitors.last_latency_ms and
-- never persisted. Drop the per-check history table — it grew unbounded
-- (1 row / monitor / minute) for a chart that only needs live values.
DROP INDEX IF EXISTS idx_latency_samples_monitor;
DROP TABLE IF EXISTS latency_samples;
