import type { LatencySample } from "../types";

interface Props {
  samples: LatencySample[];
  height?: number;
  width?: number;
  color?: string;
}

export function LatencyChart({ samples, height = 40, width = 200, color = "#60a5fa" }: Props) {
  if (samples.length < 2) return null;

  const values = samples.map((s) => s.latencyMs);
  const min = 0;
  const max = Math.max(...values, 1);

  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / (max - min)) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const lastVal = values[values.length - 1] ?? 0;
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);

  return (
    <div className="flex items-end gap-3">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="opacity-70"
        style={{ overflow: "visible" }}
      >
        {/* Subtle grid line at 50% */}
        <line
          x1="0"
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth="0.5"
          className="text-gray-700"
          strokeDasharray="3 3"
        />
        <polyline
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Dot at latest value */}
        {(() => {
          const lastY = height - ((lastVal - min) / (max - min)) * height;
          return (
            <circle cx={width} cy={lastY.toFixed(1)} r="2.5" fill={color} />
          );
        })()}
      </svg>
      <div className="text-xs text-gray-500 leading-tight text-right">
        <div>{lastVal}ms</div>
        <div className="text-gray-600">avg {avg}ms</div>
      </div>
    </div>
  );
}
