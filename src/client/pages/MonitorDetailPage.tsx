import { useState, useEffect, useCallback } from "react";
import type { MonitorDetail } from "../types";
import { api } from "../api";
import { UptimeBar } from "../components/UptimeBar";
import { downtimeColor, downtimeLabel } from "../severity";

const statusBadge: Record<string, { label: string; cls: string; dot: string }> = {
  up: { label: "Operational", cls: "bg-green-500/15 text-[#4ade80]", dot: "bg-[#4ade80]" },
  down: { label: "Outage", cls: "bg-red-500/15 text-[#f87171]", dot: "bg-[#f87171]" },
  paused: { label: "Paused", cls: "bg-amber-500/15 text-[#f59e0b]", dot: "bg-[#f59e0b]" },
};

const impactColors: Record<string, string> = {
  none: "bg-[#1e1c31] text-gray-400",
  minor: "bg-[#2a2200] text-[#f59e0b]",
  major: "bg-[#2a1500] text-[#f97316]",
  critical: "bg-[#2a0000] text-[#f87171]",
};

function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (days > 0) return `${days}d ${hrs % 24}h ${mins % 60}m`;
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  if (mins > 0) return `${mins}m ${secs % 60}s`;
  return `${secs}s`;
}

interface Props {
  monitorId: string;
}

export function MonitorDetailPage({ monitorId }: Props) {
  const [monitor, setMonitor] = useState<MonitorDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { monitor } = await api.getMonitor(monitorId);
      setMonitor(monitor);
      setError(null);
      document.title = `${monitor.name ?? "Monitor"} — History`;
    } catch (e) {
      setError((prev) => prev ?? (e instanceof Error ? e.message : "Failed to load"));
    }
  }, [monitorId]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  if (error) {
    return (
      <div className="min-h-screen bg-[#13111f] flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-[#f87171] text-lg">{error}</p>
          <a href="/" className="text-gray-400 text-sm hover:text-white underline">
            Back to status page
          </a>
        </div>
      </div>
    );
  }

  if (!monitor) {
    return (
      <div className="min-h-screen bg-[#13111f] flex items-center justify-center text-gray-600">
        Loading…
      </div>
    );
  }

  const badge = statusBadge[monitor.status] ?? statusBadge.up!;

  return (
    <div className="min-h-screen bg-[#13111f]">
      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* Breadcrumb */}
        <div className="mb-8">
          <a href="/" className="text-gray-500 text-sm hover:text-gray-300 transition-colors">
            ← Status page
          </a>
        </div>

        {/* Header */}
        <div className="space-y-4 mb-10">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${badge.cls}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
              {badge.label}
            </span>
            {monitor.type !== "push" && (
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{monitor.type}</span>
            )}
          </div>

          <h1 className="text-2xl font-bold text-white leading-tight">{monitor.name ?? monitor.id}</h1>

          {monitor.targetUrl && (
            <p className="text-sm text-gray-500 font-mono break-all">{monitor.targetUrl}</p>
          )}
          {monitor.externalStatusLabel && (
            <p className="text-xs text-gray-500">
              Official status for{" "}
              {monitor.externalStatusUrl ? (
                <a
                  href={monitor.externalStatusUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 underline hover:text-gray-200"
                >
                  {monitor.externalStatusLabel}
                </a>
              ) : (
                <span className="text-gray-400">{monitor.externalStatusLabel}</span>
              )}
            </p>
          )}
          <p className="text-xs text-gray-600">Monitoring since {fmtDateTime(monitor.createdAt)}</p>
        </div>

        {/* Uptime */}
        <div className="mb-10 rounded-xl border border-[#2a2740] bg-[#1a1829] p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {([
              ["24 hours", monitor.uptime24h],
              ["7 days", monitor.uptime7d],
              ["90 days", monitor.uptime90d],
            ] as const).map(([label, val]) => (
              <div key={label} className="bg-[#13111f] rounded-lg p-3 text-center">
                <div className="text-xs text-gray-500 mb-1">{label}</div>
                <div className="text-lg font-semibold text-white">{val.toFixed(2)}%</div>
              </div>
            ))}
          </div>
          <UptimeBar buckets={monitor.dailyBuckets} uptime90d={monitor.uptime90d} />
        </div>

        {/* Outage history */}
        <div className="mb-10">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">
            Outage history
          </h2>
          {monitor.outages.length === 0 ? (
            <p className="text-sm text-gray-500">No recorded outages. 🎉</p>
          ) : (
            <div className="space-y-2">
              {monitor.outages.map((o, i) => {
                const color = downtimeColor(o.durationMs);
                return (
                  <div
                    key={i}
                    className="flex items-start justify-between gap-4 rounded-lg border border-[#2a2740] bg-[#1a1829] px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-white">{fmtDateTime(o.start)}</span>
                        {o.ongoing && (
                          <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-red-500/15 text-[#f87171]">
                            ongoing
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {o.ongoing ? "Started" : `Recovered ${o.end ? fmtDateTime(o.end) : ""}`}
                        {o.message ? ` · ${o.message}` : ""}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold" style={{ color }}>
                        {fmtDuration(o.durationMs)}
                      </div>
                      <div className="text-xs" style={{ color }}>
                        {downtimeLabel(o.durationMs)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Incidents */}
        <div>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">
            Related incidents
          </h2>
          {monitor.incidents.length === 0 ? (
            <p className="text-sm text-gray-500">No incidents have referenced this monitor.</p>
          ) : (
            <div className="space-y-2">
              {monitor.incidents.map((inc) => (
                <a
                  key={inc.id}
                  href={`/incidents/${inc.id}`}
                  className="flex items-center justify-between gap-4 rounded-lg border border-[#2a2740] bg-[#1a1829] px-4 py-3 hover:border-[#4a4760] transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{inc.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {fmtDateTime(inc.createdAt)}
                      {inc.resolvedAt ? ` · resolved ${fmtDateTime(inc.resolvedAt)}` : " · open"}
                    </p>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${impactColors[inc.impact] ?? "bg-gray-800 text-gray-400"}`}>
                    {inc.impact}
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
