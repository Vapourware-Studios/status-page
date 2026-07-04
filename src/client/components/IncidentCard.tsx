import type { Incident } from "../types";

const impactColors = {
  none: "bg-[#1e1c31] text-gray-400",
  minor: "bg-[#2a2200] text-[#f59e0b]",
  major: "bg-[#2a1500] text-[#f97316]",
  critical: "bg-[#2a0000] text-[#f87171]",
};

const statusLabels: Record<string, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

function fmtTime(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Props {
  incident: Incident;
}

export function IncidentCard({ incident }: Props) {
  return (
    <div className="border border-[#2a2740] rounded-xl p-5 space-y-3 bg-[#1a1829]">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-white">{incident.title}</h3>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${impactColors[incident.impact]}`}
          >
            {incident.impact}
          </span>
          <span className="text-xs text-gray-500 capitalize">
            {statusLabels[incident.status] ?? incident.status}
          </span>
        </div>
      </div>
      <div className="space-y-2">
        {incident.updates.map((u) => (
          <div key={u.id} className="flex gap-3 text-sm">
            <span className="text-gray-600 shrink-0 text-xs pt-0.5">
              {fmtTime(u.createdAt)}
            </span>
            <div>
              <span className="font-medium text-gray-400 capitalize mr-1">
                {statusLabels[u.status] ?? u.status}:
              </span>
              <span className="text-gray-300">{u.body}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
