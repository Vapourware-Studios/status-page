import { useState, useEffect, useCallback } from "react";
import type { Incident } from "../types";
import { api } from "../api";
import { downtimeColor } from "../severity";
import { PushSubscribeButton } from "./StatusPage";

const impactColors = {
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

const statusDot: Record<string, string> = {
  investigating: "bg-yellow-400",
  identified: "bg-orange-400",
  monitoring: "bg-blue-400",
  resolved: "bg-green-400",
};

const statusLabels: Record<string, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

function fmtDateTime(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDuration(startMs: number, endMs: number): string {
  const diff = endMs - startMs;
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

type IncidentDetail = Incident & {
  affectedMonitorNames?: { id: string; name: string | null }[];
};

interface Props {
  incidentId: number;
}

export function IncidentDetailPage({ incidentId }: Props) {
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { incident } = await api.getIncident(incidentId);
      setIncident(incident as IncidentDetail);
      setError(null);
      document.title = `${incident.title} — Incident`;
    } catch (e) {
      setError((prev) => prev ?? (e instanceof Error ? e.message : "Failed to load"));
    }
  }, [incidentId]);

  // Auto-update the page while it's open so visitors see new updates live.
  useEffect(() => {
    load();
    const id = setInterval(load, 20_000);
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

  if (!incident) {
    return (
      <div className="min-h-screen bg-[#13111f] flex items-center justify-center text-gray-600">
        Loading…
      </div>
    );
  }

  const duration =
    incident.resolvedAt
      ? fmtDuration(incident.createdAt, incident.resolvedAt)
      : null;
  const durationColor =
    incident.resolvedAt
      ? downtimeColor(incident.resolvedAt - incident.createdAt)
      : undefined;

  return (
    <div className="min-h-screen bg-[#13111f]">
      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-[#13111f]/80 z-50 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt=""
            className="max-w-full max-h-full rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* Breadcrumb */}
        <div className="mb-8">
          <a href="/" className="text-gray-500 text-sm hover:text-gray-300 transition-colors">
            ← Status page
          </a>
        </div>

        {/* Header */}
        <div className="space-y-4 mb-10">
          <div className="flex flex-wrap items-start gap-3">
            <span
              className={`text-xs font-semibold px-2.5 py-1 rounded-full ${impactColors[incident.impact] ?? "bg-gray-800 text-gray-400"}`}
            >
              {incident.impact} impact
            </span>
            <span
              className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${statusBadge[incident.status] ?? "bg-gray-800 text-gray-400"}`}
            >
              {statusLabels[incident.status] ?? incident.status}
            </span>
          </div>

          <h1 className="text-2xl font-bold text-white leading-tight">{incident.title}</h1>

          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400">
            <span>Opened {fmtDateTime(incident.createdAt)}</span>
            {incident.resolvedAt && (
              <>
                <span className="text-gray-600">·</span>
                <span>Resolved {fmtDateTime(incident.resolvedAt)}</span>
                <span className="text-gray-600">·</span>
                <span style={durationColor ? { color: durationColor } : undefined}>Duration: {duration}</span>
              </>
            )}
          </div>

          {/* Affected monitors */}
          {incident.affectedMonitorNames && incident.affectedMonitorNames.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {incident.affectedMonitorNames.map((m) => (
                <span
                  key={m.id}
                  className="text-xs px-2.5 py-1 rounded-full bg-[#1e1c31] text-gray-300 border border-[#2a2740]"
                >
                  {m.name ?? m.id}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Subscribe to live updates (hidden once resolved) */}
        {incident.status !== "resolved" && (
          <div className="mb-10 rounded-xl border border-[#2a2740] bg-[#1a1829] px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-200">Get notified of updates</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Subscribe to receive a push notification when this incident is updated or resolved —
                even with the page closed.
              </p>
            </div>
            <div className="shrink-0">
              <PushSubscribeButton />
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="space-y-0">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-6">
            Incident timeline
          </h2>

          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[#2a2740]" />

            <div className="space-y-8">
              {incident.updates.map((u, idx) => (
                <div key={u.id} className="relative flex gap-5">
                  {/* Dot */}
                  <div className="relative z-10 shrink-0 mt-0.5">
                    <div
                      className={`w-3.5 h-3.5 rounded-full border-2 border-[#13111f] ${statusDot[u.status] ?? "bg-gray-500"}`}
                    />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 space-y-3 pb-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded capitalize ${statusBadge[u.status] ?? "bg-gray-800 text-gray-400"}`}
                      >
                        {statusLabels[u.status] ?? u.status}
                      </span>
                      <span className="text-xs text-gray-500">{fmtDateTime(u.createdAt)}</span>
                      {idx === 0 && <span className="text-xs text-gray-600">— latest update</span>}
                    </div>

                    <p className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">
                      {u.body}
                    </p>

                    {/* Images */}
                    {u.imageUrls.length > 0 && (
                      <div className="flex flex-wrap gap-3 mt-2">
                        {u.imageUrls.map((url, i) => (
                          <button
                            key={i}
                            onClick={() => setLightbox(url)}
                            className="group relative overflow-hidden rounded-lg border border-[#2a2740] hover:border-[#4a4760] transition-colors"
                          >
                            <img
                              src={url}
                              alt={`Screenshot ${i + 1}`}
                              className="h-32 w-48 object-cover group-hover:opacity-90 transition-opacity"
                              onError={(e) => {
                                (e.target as HTMLImageElement).parentElement!.style.display = "none";
                              }}
                            />
                            <div className="absolute inset-0 bg-[#13111f]/0 group-hover:bg-[#13111f]/10 transition-colors" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Origin marker */}
              <div className="relative flex gap-5">
                <div className="relative z-10 shrink-0 mt-0.5">
                  <div className="w-3.5 h-3.5 rounded-full bg-[#2a2740] border-2 border-[#13111f]" />
                </div>
                <div className="pb-2">
                  <p className="text-xs text-gray-600">Incident opened · {fmtDateTime(incident.createdAt)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
