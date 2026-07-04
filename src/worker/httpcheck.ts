export interface CheckResult {
  status: "up" | "degraded" | "down";
  latencyMs: number;
  message: string;
}

export interface CheckOptions {
  /** Acceptable HTTP status codes. Defaults to any 2xx/3xx. */
  expectStatus?: number[] | null;
  /** Response body must contain this substring (keyword check). */
  expectBody?: string | null;
  /** Responses slower than this (ms) are "degraded" rather than "up". */
  degradedResponseMs?: number | null;
  /** Surface TLS/certificate problems with a clearer failure reason. */
  checkSsl?: boolean;
}

function statusAccepted(code: number, expect?: number[] | null): boolean {
  if (expect && expect.length) return expect.includes(code);
  return code >= 200 && code < 400;
}

function looksLikeTlsError(msg: string): boolean {
  return /certificate|SSL|TLS|handshake|self.signed|expired/i.test(msg);
}

export async function checkHttp(url: string, opts: CheckOptions = {}): Promise<CheckResult> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      // A bland UA — some hosts 403 the default Workers agent.
      headers: { "User-Agent": "Statch/1.0 (+https://github.com/Vapourware-Studios/status-page)" },
    });
    const latencyMs = Date.now() - start;

    if (!statusAccepted(res.status, opts.expectStatus)) {
      return { status: "down", latencyMs, message: `HTTP ${res.status}` };
    }

    // Keyword assertion — the body must contain the expected substring.
    if (opts.expectBody) {
      const body = await res.text();
      if (!body.includes(opts.expectBody)) {
        return { status: "down", latencyMs, message: `Body missing "${opts.expectBody}"` };
      }
    }

    // Passed all assertions — decide up vs degraded on response time.
    if (opts.degradedResponseMs && latencyMs > opts.degradedResponseMs) {
      return {
        status: "degraded",
        latencyMs,
        message: `Slow: ${latencyMs}ms > ${opts.degradedResponseMs}ms`,
      };
    }
    return { status: "up", latencyMs, message: `HTTP ${res.status}` };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const raw = err instanceof Error ? err.message : "Request failed";
    const message =
      opts.checkSsl && looksLikeTlsError(raw) ? `TLS certificate error: ${raw}` : raw;
    return { status: "down", latencyMs, message };
  }
}
