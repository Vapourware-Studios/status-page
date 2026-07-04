import { useState, useEffect, useCallback } from "react";
import type { Incident } from "../types";
import { api } from "../api";
import { downtimeColor } from "../severity";

const impactBorderColor: Record<string, string> = {
  none: "border-l-gray-700",
  minor: "border-l-[#f59e0b]",
  major: "border-l-[#f97316]",
  critical: "border-l-[#f87171]",
};

const impactBadge: Record<string, string> = {
  none: "bg-[#1e1c31] text-gray-400",
  minor: "bg-[#2a2200] text-[#f59e0b]",
  major: "bg-[#2a1500] text-[#f97316]",
  critical: "bg-[#2a0000] text-[#f87171]",
};

const statusBadge: Record<string, string> = {
  investigating: "bg-yellow-500/20 text-yellow-300",
  identified: "bg-orange-500/20 text-orange-300",
  monitoring: "bg-blue-500/20 text-blue-300",
  resolved: "bg-green-500/20 text-green-300",
};

const statusLabels: Record<string, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

function fmtDate(ms: number): string {
  const now = Date.now();
  const days = Math.floor((now - ms) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function fmtDuration(startMs: number, endMs: number): string {
  const mins = Math.floor((endMs - startMs) / 60_000);
  if (mins < 1) return "< 1m";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

function IncidentRow({ incident }: { incident: Incident }) {
  const latestUpdate = incident.updates[0];
  const isActive = incident.status !== "resolved";
  const durationMs = incident.resolvedAt ? incident.resolvedAt - incident.createdAt : null;
  const borderColor = impactBorderColor[incident.impact] ?? "border-l-gray-700";

  return (
    <a
      href={`/incidents/${incident.id}`}
      className={`block border border-[#2a2740] border-l-4 ${borderColor} rounded-xl bg-[#1a1829] overflow-hidden transition-colors hover:border-[#3a3760] hover:bg-[#1e1c31]`}
    >
      <div className="px-5 py-4 space-y-2.5">
        {/* Badges + date */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded-full ${impactBadge[incident.impact] ?? "bg-gray-800 text-gray-400"}`}
            >
              {incident.impact}
            </span>
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${statusBadge[incident.status] ?? "bg-gray-800 text-gray-400"}`}
            >
              {statusLabels[incident.status] ?? incident.status}
            </span>
            {isActive && (
              <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse" />
            )}
          </div>
          <div className="flex items-center gap-3 text-xs">
            {durationMs != null ? (
              <span style={{ color: downtimeColor(durationMs) }}>
                {fmtDuration(incident.createdAt, incident.resolvedAt!)}
              </span>
            ) : (
              <span className="text-yellow-500/60">Ongoing</span>
            )}
            <span className="text-gray-500">{fmtDate(incident.createdAt)}</span>
          </div>
        </div>

        {/* Title */}
        <p className="font-semibold text-white leading-snug">{incident.title}</p>

        {/* Latest update body */}
        {latestUpdate && (
          <p className="text-sm text-gray-400 line-clamp-2 leading-relaxed">
            <span className="text-gray-500 mr-1">
              {statusLabels[latestUpdate.status] ?? latestUpdate.status}:
            </span>
            {latestUpdate.body}
          </p>
        )}

        {/* Affected services count */}
        {incident.affectedMonitors.length > 0 && (
          <p className="text-xs text-gray-600">
            {incident.affectedMonitors.length}{" "}
            {incident.affectedMonitors.length === 1 ? "service" : "services"} affected
          </p>
        )}
      </div>
    </a>
  );
}

export function IncidentsHistoryTab() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async (p: number, append: boolean) => {
    try {
      const data = await api.incidents(p);
      setIncidents((prev) => (append ? [...prev, ...data.incidents] : data.incidents));
      setHasMore(data.hasMore);
      setPage(data.page);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load incidents");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(1, false);
  }, [loadPage]);

  async function loadMore() {
    setLoadingMore(true);
    await loadPage(page + 1, true);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-600">Loading…</div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-[#f87171] mb-3">{error}</p>
        <button
          onClick={() => {
            setLoading(true);
            void loadPage(1, false);
          }}
          className="text-sm text-gray-500 hover:text-gray-300 underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!incidents.length) {
    return (
      <div className="text-center py-20 text-gray-600">No incidents recorded yet.</div>
    );
  }

  const active = incidents.filter((i) => i.status !== "resolved");
  const past = incidents.filter((i) => i.status === "resolved");

  return (
    <div className="space-y-8">
      {active.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">
            Active
          </h2>
          <div className="space-y-3">
            {active.map((inc) => (
              <IncidentRow key={inc.id} incident={inc} />
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">
            Past incidents
          </h2>
          <div className="space-y-3">
            {past.map((inc) => (
              <IncidentRow key={inc.id} incident={inc} />
            ))}
          </div>
        </section>
      )}

      {hasMore && (
        <div className="flex justify-center pt-2">
          <button
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="text-sm text-gray-400 hover:text-white border border-[#2a2740] hover:border-[#4a4760] px-6 py-2 rounded-lg transition-colors disabled:opacity-40"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
