import type { CheckResult } from "./httpcheck";

export interface TcpOptions {
  /** Connections slower than this (ms) are reported as "degraded". */
  degradedResponseMs?: number | null;
}

// TCP port check using Cloudflare's connect() API (cloudflare:sockets, requires nodejs_compat).
// targetUrl format: "hostname:port" e.g. "db.example.com:5432"
export async function checkTcp(target: string, opts: TcpOptions = {}): Promise<CheckResult> {
  const start = Date.now();
  const colonIdx = target.lastIndexOf(":");
  if (colonIdx === -1) {
    return { status: "down", latencyMs: 0, message: "Invalid target — expected host:port" };
  }

  const hostname = target.slice(0, colonIdx);
  const port = parseInt(target.slice(colonIdx + 1), 10);

  if (!hostname || isNaN(port) || port < 1 || port > 65535) {
    return { status: "down", latencyMs: 0, message: "Invalid host or port" };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { connect } = await import("cloudflare:sockets" as any);
    const socket = connect({ hostname, port });
    await Promise.race([
      socket.opened,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), 10_000)
      ),
    ]);
    void socket.close();
    const latencyMs = Date.now() - start;
    if (opts.degradedResponseMs && latencyMs > opts.degradedResponseMs) {
      return { status: "degraded", latencyMs, message: `Slow connect: ${latencyMs}ms` };
    }
    return { status: "up", latencyMs, message: `TCP:${port} open` };
  } catch (err) {
    return {
      status: "down",
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : "Connection failed",
    };
  }
}
