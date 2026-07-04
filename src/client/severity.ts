// Shared downtime -> color/label scale, used by the uptime bars and incident
// history so "past downtime" is colored consistently everywhere.

const FULL_DAY_MIN = 1440; // minutes in a day = worst severity anchor

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// 0 (no downtime) .. 1 (full-day outage). Log scale so a 1-min blip is still
// visible while not swamping multi-hour outages. Any downtime at all jumps
// straight to FLOOR (clear yellow) so "it was down" reads at a glance, then
// climbs toward red from there.
const FLOOR = 0.4;
export function severity(downtimeMs: number): number {
  const mins = downtimeMs / 60000;
  if (mins <= 0) return 0;
  const raw = Math.min(1, Math.log10(1 + mins) / Math.log10(1 + FULL_DAY_MIN));
  return FLOOR + (1 - FLOOR) * raw;
}

// Continuous green -> yellow -> orange -> red gradient (HSL hue sweep).
// Effectively unlimited stages: every distinct downtime maps to its own hue.
export function downtimeColor(downtimeMs: number): string {
  const t = severity(downtimeMs);
  const hue = lerp(140, 0, t); // 140=green .. 0=red
  const sat = lerp(65, 78, t);
  const light = lerp(60, 57, t);
  return `hsl(${hue.toFixed(0)} ${sat.toFixed(0)}% ${light.toFixed(0)}%)`;
}

// Named tiers — many discrete stages by downtime duration.
export function downtimeLabel(downtimeMs: number): string {
  const mins = downtimeMs / 60000;
  if (mins <= 0) return "Operational";
  if (mins < 1) return "Small outage";
  if (mins < 5) return "Minor disruption";
  if (mins < 15) return "Brief outage";
  if (mins < 30) return "Partial degradation";
  if (mins < 60) return "Notable outage";
  if (mins < 120) return "Significant outage";
  if (mins < 240) return "Major outage";
  if (mins < 480) return "Severe outage";
  if (mins < 720) return "Extended outage";
  if (mins < FULL_DAY_MIN) return "Critical outage";
  return "Total outage";
}
