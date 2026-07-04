import { useState } from "react";
import type { DailyBucket } from "../types";
import { downtimeColor, downtimeLabel } from "../severity";

interface Props {
  buckets: DailyBucket[];
  uptime90d: number;
}

const NO_DATA_COLOR = "#2a2740";
const PAUSED_COLOR = "#f59e0b";

function severityColor(b: DailyBucket): string {
  if (b.worstStatus === "no_data") return NO_DATA_COLOR;
  if (b.worstStatus === "paused") return PAUSED_COLOR;
  return downtimeColor(b.downtimeMs);
}

function severityLabel(b: DailyBucket): string {
  if (b.worstStatus === "no_data") return "No data";
  if (b.worstStatus === "paused") return "Degraded performance";
  return downtimeLabel(b.downtimeMs);
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatDowntime(ms: number): string {
  if (ms === 0) return "None";
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return `${hrs}h ${mins % 60}m ${secs % 60}s`;
  if (mins > 0) return `${mins} minute${mins !== 1 ? "s" : ""} ${secs % 60} seconds`;
  return `${secs} second${secs !== 1 ? "s" : ""}`;
}

export function UptimeBar({ buckets, uptime90d }: Props) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const selected = selectedIdx !== null ? buckets[selectedIdx] : null;

  return (
    <div onMouseLeave={() => setSelectedIdx(null)}>
      {/* Column bars */}
      <div className="flex gap-[2px] h-12 w-full items-end">
        {buckets.map((b, i) => (
          <button
            key={i}
            onMouseEnter={() => setSelectedIdx(i)}
            style={{ backgroundColor: severityColor(b) }}
            className={`flex-1 h-full rounded-[2px] origin-bottom transition-all duration-200 ease-out ${
              selectedIdx === i
                ? "opacity-100 scale-y-[1.15] brightness-125"
                : "opacity-75 scale-y-100 hover:opacity-100 hover:scale-y-[1.15]"
            }`}
          />
        ))}
      </div>

      {/* Labels */}
      <div className="flex justify-between text-xs text-gray-500 mt-1.5">
        <span>90 days ago</span>
        <span>{uptime90d.toFixed(4)}% availability</span>
        <span>Today</span>
      </div>

      {/* Expand panel */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-out ${
          selected !== null ? "max-h-40 opacity-100 mt-4" : "max-h-0 opacity-0 mt-0"
        }`}
      >
        {selected && (() => {
          const sevColor = severityColor(selected);
          const cards: { label: string; value: string; color?: string }[] = [
            { label: "Date", value: formatDate(selected.date) },
            { label: "Downtime", value: formatDowntime(selected.downtimeMs), color: sevColor },
            { label: "Availability", value: `${selected.uptimePct.toFixed(4)}%` },
            { label: "Status", value: severityLabel(selected), color: sevColor },
          ];
          return (
            <div className="grid grid-cols-4 gap-3">
              {cards.map(({ label, value, color }) => (
                <div key={label} className="bg-[#1e1c31] rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">{label}</div>
                  <div className="text-sm font-semibold text-white" style={color ? { color } : undefined}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
