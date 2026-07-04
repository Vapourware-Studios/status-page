// The "it's not you, it's Cloudflare" detector.
//
// When a monitor flagged `checkCloudflare` falls over, we don't want to wake
// anyone up before we've checked whether the actual culprit is the giant orange
// cloud everything runs on. So cron quietly asks Cloudflare's own status page
// "hey, is anything on fire over there?" and, if the answer is yes, pins the
// blame squarely where it belongs — right there in the incident. Your server
// gets to keep its dignity.
//
// We watch the compute/hosting products (Workers, Pages), DNS, the CDN edge,
// and any global major/critical incident, because a service sitting behind
// Cloudflare can be dragged offline by any of them while being perfectly
// healthy itself. Source: Cloudflare's public Statuspage v2 JSON API (no auth).

const STATUS_BASE = "https://www.cloudflarestatus.com/api/v2";

// Component-name fragments that, if they're having a bad day, tend to take
// Cloudflare-hosted things down with them. Tune to taste.
const WATCH_KEYWORDS = ["workers", "pages", "dns", "cdn", "network", "access"];

interface CfComponent {
  name: string;
  status: string; // operational | degraded_performance | partial_outage | major_outage | under_maintenance
}

interface CfIncident {
  name: string;
  impact: string; // none | minor | major | critical
  status: string; // investigating | identified | monitoring | ...
  components?: CfComponent[];
}

export interface CloudflareVerdict {
  matched: boolean;
  summary: string; // human-readable note appended to the incident
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "user-agent": "statch-statuspage/1.0" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function matchedKeyword(name: string): boolean {
  const lower = name.toLowerCase();
  return WATCH_KEYWORDS.some((kw) => lower.includes(kw));
}

// Returns null when Cloudflare's status can't be reached at all (stay silent),
// { matched:false } when reachable but nothing relevant is wrong.
export async function checkCloudflareForOutage(): Promise<CloudflareVerdict | null> {
  const [incidentsData, componentsData] = await Promise.all([
    fetchJson<{ incidents: CfIncident[] }>(`${STATUS_BASE}/incidents/unresolved.json`),
    fetchJson<{ components: CfComponent[] }>(`${STATUS_BASE}/components.json`),
  ]);

  if (!incidentsData && !componentsData) return null; // total fetch failure

  const reasons = new Set<string>();

  // 1. Active incidents touching a watched component, or any global major/critical incident.
  for (const inc of incidentsData?.incidents ?? []) {
    const hits = (inc.components ?? []).filter((c) => matchedKeyword(c.name));
    const globalSevere = inc.impact === "critical" || inc.impact === "major";
    if (hits.length || globalSevere) {
      const where = hits.length ? ` (affecting ${hits.map((c) => c.name).join(", ")})` : "";
      reasons.add(`"${inc.name}" [${inc.impact}, ${inc.status}]${where}`);
    }
  }

  // 2. Watched components degraded even without a declared incident.
  for (const comp of componentsData?.components ?? []) {
    if (comp.status === "operational" || comp.status === "under_maintenance") continue;
    if (!matchedKeyword(comp.name)) continue;
    reasons.add(`${comp.name} is reporting ${comp.status.replace(/_/g, " ")}`);
  }

  if (reasons.size === 0) return { matched: false, summary: "" };

  const summary =
    "We believe this was caused by a Cloudflare outage. Cloudflare's status page is currently reporting: " +
    [...reasons].join("; ") +
    ". Anything that depends on Cloudflare — DNS, Workers, Pages, or the CDN edge — can be taken offline by this even if the underlying server is healthy. See https://www.cloudflarestatus.com for details.";

  return { matched: true, summary };
}
