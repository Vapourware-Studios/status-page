interface Props {
  status: "up" | "degraded" | "down" | "paused" | "pending";
  size?: "sm" | "md";
}

const colors = {
  up: "bg-green-500",
  degraded: "bg-amber-400",
  down: "bg-red-500",
  paused: "bg-yellow-400",
  pending: "bg-gray-400",
};

const rings = {
  up: "ring-green-200",
  degraded: "ring-amber-200",
  down: "ring-red-200",
  paused: "ring-yellow-200",
  pending: "ring-gray-200",
};

const pulse = {
  up: "animate-pulse",
  degraded: "animate-pulse",
  down: "animate-pulse",
  paused: "",
  pending: "",
};

export function StatusDot({ status, size = "md" }: Props) {
  const sz = size === "sm" ? "w-2.5 h-2.5" : "w-3.5 h-3.5";
  const key = (status in colors ? status : "pending") as keyof typeof colors;
  return (
    <span
      className={`inline-block rounded-full ${sz} ${colors[key]} ring-4 ${rings[key]} ${pulse[key]}`}
      title={status}
    />
  );
}
