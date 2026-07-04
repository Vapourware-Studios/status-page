import { useState, useEffect, useCallback } from "react";
import type {
  StatusData,
  MonitorSummary,
  MaintenanceWindow,
  MonitorGroup,
  LatencySample,
} from "../types";
import { api } from "../api";
import { UptimeBar } from "../components/UptimeBar";
import { IncidentCard } from "../components/IncidentCard";
import { LatencyChart } from "../components/LatencyChart";
import { Footer } from "../components/Footer";
import { IncidentsHistoryTab } from "./IncidentsHistoryTab";

// ── Live latency buffer ───────────────────────────────────────────────────────
// Latency is no longer stored server-side. We sample monitor.lastLatencyMs on
// every poll and keep a short rolling window in memory for the sparkline.

const LATENCY_CAP = 60;

type LatencyMap = Record<string, LatencySample[]>;

function appendLatency(prev: LatencyMap, monitors: MonitorSummary[]): LatencyMap {
  const now = Date.now();
  const next: LatencyMap = { ...prev };
  for (const m of monitors) {
    if ((m.type === "http" || m.type === "tcp") && m.lastLatencyMs != null && m.lastLatencyMs > 0) {
      next[m.id] = [...(next[m.id] ?? []), { latencyMs: m.lastLatencyMs, checkedAt: now }].slice(
        -LATENCY_CAP
      );
    }
  }
  return next;
}

// ── Push notification helpers ─────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function getDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Browser";
}

const isIOS = (): boolean =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPadOS reports as Mac, detect via touch
  (/Macintosh/.test(navigator.userAgent) && "ontouchend" in document);

const isStandalone = (): boolean =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

// ── Status helpers ────────────────────────────────────────────────────────────

const statusLabel: Record<string, string> = {
  up: "Operational",
  down: "Major outage",
  paused: "Degraded performance",
  maintenance: "Maintenance",
};

// Down monitors used to all read "Major outage". Pick from a varied pool,
// keyed by monitor id so each service gets a stable-but-different phrase
// instead of the whole page chanting the same words.
const downLabels = [
  "Service disruption",
  "Currently unavailable",
  "Not responding",
  "Experiencing issues",
  "Offline",
  "Connectivity problems",
  "Unreachable",
  "Outage in progress",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function downLabelFor(id: string): string {
  return downLabels[hashString(id) % downLabels.length]!;
}

const statusTextColor: Record<string, string> = {
  up: "text-[#4ade80]",
  down: "text-[#f87171]",
  paused: "text-[#f59e0b]",
  maintenance: "text-[#60a5fa]",
};

function getDateRange(): string {
  const now = new Date();
  const start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return `${fmt(start)} – ${fmt(now)}`;
}

function formatMaintenanceTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MaintenanceBanner({ windows }: { windows: MaintenanceWindow[] }) {
  if (!windows.length) return null;

  const active = windows.filter((w) => w.status === "active");
  const upcoming = windows.filter((w) => w.status === "scheduled");

  return (
    <div className="mb-8 space-y-2">
      {active.map((w) => (
        <div
          key={w.id}
          className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3"
        >
          <div className="flex items-start gap-2">
            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-blue-400 animate-pulse" />
            <div>
              <p className="text-sm font-semibold text-blue-300">
                Maintenance in progress — {w.title}
              </p>
              {w.description && (
                <p className="text-xs text-blue-400/80 mt-0.5">{w.description}</p>
              )}
              <p className="text-xs text-blue-500 mt-0.5">
                Until {formatMaintenanceTime(w.endTime)}
              </p>
            </div>
          </div>
        </div>
      ))}
      {upcoming.map((w) => (
        <div
          key={w.id}
          className="rounded-xl border border-gray-600/30 bg-gray-800/40 px-4 py-3"
        >
          <div className="flex items-start gap-2">
            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-gray-500" />
            <div>
              <p className="text-sm font-medium text-gray-300">
                Upcoming maintenance — {w.title}
              </p>
              {w.description && (
                <p className="text-xs text-gray-500 mt-0.5">{w.description}</p>
              )}
              <p className="text-xs text-gray-600 mt-0.5">
                {formatMaintenanceTime(w.startTime)} – {formatMaintenanceTime(w.endTime)}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MonitorRow({ m, samples }: { m: MonitorSummary; samples: LatencySample[] }) {
  const effectiveStatus = m.inMaintenance ? "maintenance" : m.status;
  const label =
    effectiveStatus === "down"
      ? downLabelFor(m.id)
      : statusLabel[effectiveStatus] ?? effectiveStatus;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <a
            href={`/monitors/${m.id}`}
            className="font-semibold text-white hover:text-gray-300 hover:underline decoration-gray-600 underline-offset-4 transition-colors"
          >
            {m.name}
          </a>
          {m.type === "tcp" && (
            <span className="text-xs text-gray-600 uppercase tracking-wide">TCP</span>
          )}
          {m.type === "http" && m.lastLatencyMs != null && (
            <span className="text-gray-500 text-sm">— {m.lastLatencyMs}ms</span>
          )}
        </div>
        <span className={`text-sm font-semibold ${statusTextColor[effectiveStatus] ?? "text-gray-400"}`}>
          {label}
        </span>
      </div>
      <UptimeBar buckets={m.dailyBuckets} uptime90d={m.uptime90d} />
      {m.externalStatusLabel && (
        <p className="text-xs text-gray-500 mt-1.5">
          Official status for{" "}
          {m.externalStatusUrl ? (
            <a
              href={m.externalStatusUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 underline hover:text-gray-200"
            >
              {m.externalStatusLabel}
            </a>
          ) : (
            <span className="text-gray-400">{m.externalStatusLabel}</span>
          )}
        </p>
      )}
      {samples.length >= 2 && (
        <div className="mt-2 pl-0.5">
          <LatencyChart samples={samples} width={300} height={32} />
        </div>
      )}
    </div>
  );
}

function MonitorSection({
  title,
  monitors,
  latency,
}: {
  title?: string;
  monitors: MonitorSummary[];
  latency: LatencyMap;
}) {
  if (!monitors.length) return null;

  return (
    <div>
      {title && (
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">
          {title}
        </h2>
      )}
      <div className="space-y-8">
        {monitors.map((m) => (
          <MonitorRow key={m.id} m={m} samples={latency[m.id] ?? []} />
        ))}
      </div>
    </div>
  );
}

// ── Push subscribe button ─────────────────────────────────────────────────────

type PushState =
  | "unsupported"
  | "ios-install"
  | "checking"
  | "denied"
  | "subscribed"
  | "unsubscribed"
  | "loading";

export function PushSubscribeButton() {
  const [state, setState] = useState<PushState>("checking");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // iOS only exposes Notification/PushManager once installed to the Home Screen.
    if (isIOS() && !isStandalone()) {
      setState("ios-install");
      return;
    }
    if (
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? "subscribed" : "unsubscribed"))
      .catch(() => setState("unsubscribed"));
  }, []);

  async function handleSubscribe() {
    setErr(null);
    setState("loading");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("denied");
        return;
      }
      const { publicKey } = await api.vapidPublicKey();
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await api.pushSubscribe(json, getDeviceName());
      setState("subscribed");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not enable notifications";
      if (Notification.permission === "denied") {
        setState("denied");
      } else {
        setErr(msg);
        setState("unsubscribed");
      }
    }
  }

  async function handleUnsubscribe() {
    setState("loading");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.pushUnsubscribe(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("unsubscribed");
    } catch {
      setState("subscribed");
    }
  }

  if (state === "unsupported") return null;

  if (state === "ios-install") {
    return (
      <span
        className="text-xs text-gray-500"
        title="On iPhone/iPad, open the Share menu and choose “Add to Home Screen”, then open the app to enable alerts."
      >
        Add to Home Screen for alerts
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="flex items-center gap-2">
        {state === "subscribed" && (
          <button
            onClick={handleUnsubscribe}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#4ade80]" />
            Notifications on
          </button>
        )}
        {state === "unsubscribed" && (
          <button
            onClick={handleSubscribe}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-gray-600" />
            Get outage alerts
          </button>
        )}
        {state === "denied" && (
          <span className="text-xs text-gray-600" title="Notifications blocked in browser/OS settings">
            Notifications blocked
          </span>
        )}
        {state === "loading" && <span className="text-xs text-gray-600">…</span>}
      </div>
      {err && <span className="text-[10px] text-[#f87171] max-w-45 text-right">{err}</span>}
    </div>
  );
}

// ── Overall status banner ─────────────────────────────────────────────────────

const overallConfig: Record<
  string,
  { label: string; dot: string; bg: string; border: string; text: string }
> = {
  operational: {
    label: "All systems operational",
    dot: "bg-[#4ade80]",
    bg: "bg-[#4ade80]/10",
    border: "border-[#4ade80]/20",
    text: "text-[#4ade80]",
  },
  partial_outage: {
    label: "Partial system outage",
    dot: "bg-[#f59e0b]",
    bg: "bg-[#f59e0b]/10",
    border: "border-[#f59e0b]/20",
    text: "text-[#f59e0b]",
  },
  major_outage: {
    label: "Major system outage",
    dot: "bg-[#f87171]",
    bg: "bg-[#f87171]/10",
    border: "border-[#f87171]/20",
    text: "text-[#f87171]",
  },
};

function OverallBanner({ overall }: { overall: StatusData["overall"] }) {
  const cfg = overallConfig[overall] ?? overallConfig.operational;
  return (
    <div className={`rounded-xl border ${cfg.bg} ${cfg.border} px-5 py-4 mb-8 flex items-center gap-3`}>
      <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${cfg.dot}`} />
      <span className={`font-semibold ${cfg.text}`}>{cfg.label}</span>
    </div>
  );
}

type Tab = "status" | "incidents";

function readTabFromUrl(): Tab {
  return new URLSearchParams(window.location.search).get("tab") === "incidents"
    ? "incidents"
    : "status";
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function StatusPage() {
  const [tab, setTab] = useState<Tab>(readTabFromUrl);
  const [data, setData] = useState<StatusData | null>(null);
  const [latency, setLatency] = useState<LatencyMap>({});
  const [error, setError] = useState<string | null>(null);

  // Keep tab in sync with browser back/forward.
  useEffect(() => {
    function onPop() {
      setTab(readTabFromUrl());
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function switchTab(t: Tab) {
    setTab(t);
    const url = t === "incidents" ? "?tab=incidents" : window.location.pathname;
    window.history.pushState({}, "", url);
  }

  const load = useCallback(async () => {
    try {
      const d = await api.status();
      setData(d);
      setLatency((prev) => appendLatency(prev, d.monitors));
      setError(null);
      if (d.page.title) document.title = d.page.title;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load status");
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, [load]);

  if (error && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[#f87171] bg-[#13111f]">
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-600 bg-[#13111f]">
        Loading…
      </div>
    );
  }

  // Organise monitors into groups
  const grouped = new Map<number, MonitorSummary[]>();
  const ungrouped: MonitorSummary[] = [];

  for (const m of data.monitors) {
    if (m.groupId != null) {
      const arr = grouped.get(m.groupId) ?? [];
      arr.push(m);
      grouped.set(m.groupId, arr);
    } else {
      ungrouped.push(m);
    }
  }

  // Sort groups by their sortOrder
  const sortedGroups = [...data.groups].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="min-h-screen bg-[#13111f] flex flex-col">
      <div className="max-w-3xl w-full mx-auto px-6 py-10 flex-1">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">
              {data.page.title || "System status"}
            </h1>
            {data.page.headline && (
              <p className="text-sm text-gray-500 mt-0.5">{data.page.headline}</p>
            )}
          </div>
          <div className="flex items-center gap-4">
            <PushSubscribeButton />
            <div className="flex items-center gap-1.5 text-gray-600 text-sm select-none">
              <span className="text-lg leading-none">‹</span>
              <span>{getDateRange()}</span>
              <span className="text-lg leading-none">›</span>
            </div>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="flex gap-6 mb-8 border-b border-[#2a2740]">
          {(["status", "incidents"] as const).map((t) => (
            <button
              key={t}
              onClick={() => switchTab(t)}
              className={`pb-3 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
                tab === t
                  ? "text-white border-white"
                  : "text-gray-500 border-transparent hover:text-gray-300"
              }`}
            >
              {t === "status" ? "Status" : "Incidents"}
            </button>
          ))}
        </div>

        {tab === "incidents" ? (
          <IncidentsHistoryTab />
        ) : (
          <>
            {/* Overall status */}
            <OverallBanner overall={data.overall} />

            {/* Maintenance banners */}
            <MaintenanceBanner windows={data.maintenance} />

            {/* Active incidents — click through for live updates */}
            {data.activeIncidents.length > 0 && (
              <div className="mb-10 space-y-3">
                {data.activeIncidents.map((inc) => (
                  <a
                    key={inc.id}
                    href={`/incidents/${inc.id}`}
                    className="block transition-opacity hover:opacity-90"
                  >
                    <IncidentCard incident={inc} />
                  </a>
                ))}
              </div>
            )}

            {/* Monitors — grouped + ungrouped */}
            {data.monitors.length === 0 && (
              <p className="text-gray-600 text-sm">No monitors configured yet.</p>
            )}

            <div className="space-y-10">
              {sortedGroups.map((g) => {
                const gMonitors = grouped.get(g.id) ?? [];
                if (!gMonitors.length) return null;
                return <MonitorSection key={g.id} title={g.name} monitors={gMonitors} latency={latency} />;
              })}

              {ungrouped.length > 0 && (
                <MonitorSection
                  title={sortedGroups.length > 0 ? "Other" : undefined}
                  monitors={ungrouped}
                  latency={latency}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* Footer — brand, links, credits + API/embed docs */}
      <Footer />
    </div>
  );
}
