import type { Event } from "./schema";

const DAY_MS = 24 * 60 * 60 * 1000;
export const WINDOW_24H = DAY_MS;
export const WINDOW_7D = 7 * DAY_MS;
export const WINDOW_90D = 90 * DAY_MS;

export interface DailyBucket {
  date: number; // UTC day start (ms)
  uptimePct: number;
  downtimeMs: number;
  worstStatus: "up" | "down" | "paused" | "no_data";
}

export function computeDailyBuckets(
  evts: Event[],
  monitorCreatedAt: number,
  days: number,
  now: number
): DailyBucket[] {
  const todayStart = now - (now % DAY_MS);
  const buckets: DailyBucket[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const dayStart = todayStart - i * DAY_MS;
    const dayEnd = dayStart + DAY_MS;

    if (dayEnd <= monitorCreatedAt) {
      buckets.push({ date: dayStart, uptimePct: 100, downtimeMs: 0, worstStatus: "no_data" });
      continue;
    }

    const effectiveStart = Math.max(dayStart, monitorCreatedAt);
    const effectiveEnd = Math.min(dayEnd, now);
    const totalMs = effectiveEnd - effectiveStart;

    if (totalMs <= 0) {
      buckets.push({ date: dayStart, uptimePct: 100, downtimeMs: 0, worstStatus: "no_data" });
      continue;
    }

    const before = evts.filter((e) => e.createdAt < effectiveStart);
    let state = before.length > 0 ? before[before.length - 1]!.status : "up";

    const inWin = evts
      .filter((e) => e.createdAt >= effectiveStart && e.createdAt < effectiveEnd)
      .sort((a, b) => a.createdAt - b.createdAt);

    let uptimeMs = 0;
    let downtimeMs = 0;
    let worstStatus: "up" | "down" | "paused" = "up";
    let cursor = effectiveStart;

    for (const ev of inWin) {
      const seg = ev.createdAt - cursor;
      if (state === "up") uptimeMs += seg;
      else {
        downtimeMs += seg;
        if (state === "down") worstStatus = "down";
        else if (state === "paused" && worstStatus === "up") worstStatus = "paused";
      }
      cursor = ev.createdAt;
      state = ev.status;
    }

    const lastSeg = effectiveEnd - cursor;
    if (state === "up") uptimeMs += lastSeg;
    else {
      downtimeMs += lastSeg;
      if (state === "down") worstStatus = "down";
      else if (state === "paused" && worstStatus === "up") worstStatus = "paused";
    }

    buckets.push({
      date: dayStart,
      uptimePct: Math.round((uptimeMs / totalMs) * 10000) / 100,
      downtimeMs,
      worstStatus,
    });
  }

  return buckets;
}

export function computeUptime(
  events: Event[],
  monitorCreatedAt: number,
  windowMs: number,
  now: number
): number {
  const windowStart = Math.max(now - windowMs, monitorCreatedAt);
  const windowEnd = now;
  const totalMs = windowEnd - windowStart;
  if (totalMs <= 0) return 100;

  // Determine state at windowStart from the last event before it
  const before = events.filter((e) => e.createdAt < windowStart);
  let currentStatus =
    before.length > 0 ? before[before.length - 1]!.status : "up";

  const inWindow = events
    .filter((e) => e.createdAt >= windowStart && e.createdAt <= windowEnd)
    .sort((a, b) => a.createdAt - b.createdAt);

  let uptimeMs = 0;
  let cursor = windowStart;

  for (const ev of inWindow) {
    if (currentStatus === "up") {
      uptimeMs += ev.createdAt - cursor;
    }
    cursor = ev.createdAt;
    currentStatus = ev.status;
  }

  if (currentStatus === "up") {
    uptimeMs += windowEnd - cursor;
  }

  return Math.round((uptimeMs / totalMs) * 1000) / 10;
}

export function groupEventsByMonitor(events: Event[]): Map<string, Event[]> {
  const map = new Map<string, Event[]>();
  for (const ev of events) {
    const arr = map.get(ev.monitorId) ?? [];
    arr.push(ev);
    map.set(ev.monitorId, arr);
  }
  return map;
}
