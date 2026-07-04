import { useState } from "react";
import { Footer } from "../components/Footer";

// Dedicated docs page: how to embed a live status badge, and the public JSON
// API. Origin is read live so the snippets match whatever domain this is on.

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="shrink-0 rounded-md border border-gray-700 px-2.5 py-1 text-xs text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="flex items-start gap-2">
      <pre className="flex-1 overflow-x-auto rounded-lg border border-[#2a2740] bg-[#1a1829] p-3 text-xs text-gray-300">
        <code>{code}</code>
      </pre>
      <CopyButton text={code} />
    </div>
  );
}

function Endpoint({ method, path, desc }: { method: string; path: string; desc: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-3 py-1.5">
      <span className="shrink-0 rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-400">
        {method}
      </span>
      <code className="text-xs text-gray-300">{path}</code>
      <span className="text-xs text-gray-600">— {desc}</span>
    </div>
  );
}

export function DocsPage() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const embedSnippet = `<script src="${origin}/embed.js" async></script>`;

  const summaryExample = `{
  "status": "operational",
  "operational": true,
  "description": "All systems operational",
  "affected": [],
  "incidents": [],
  "url": "${origin}"
}`;

  return (
    <div className="min-h-screen bg-[#13111f] flex flex-col">
      <main className="max-w-3xl w-full mx-auto px-6 py-10 flex-1">
        <a href="/" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
          ← Back to status
        </a>

        <h1 className="text-2xl font-bold text-white mt-4 mb-2">API &amp; embed</h1>
        <p className="text-sm text-gray-500 mb-10 max-w-xl">
          Show our live status on your own site, or pull it straight from the open API. No key,
          no signup.
        </p>

        <div className="space-y-12 text-sm text-gray-400">
          {/* Embed badge */}
          <section className="space-y-3">
            <h2 className="font-semibold text-gray-200">Status badge</h2>
            <p className="text-gray-500">
              Paste this one line anywhere in your page. It shows our live status and links back
              here — straight to the incident if something is wrong.
            </p>
            <CodeBlock code={embedSnippet} />
            <p className="text-xs text-gray-600">
              Options: <code className="text-gray-500">data-theme="light"</code> for a light badge,{" "}
              <code className="text-gray-500">data-compact</code> for a single-line badge.
            </p>
          </section>

          {/* Public API */}
          <section className="space-y-3">
            <h2 className="font-semibold text-gray-200">Public API</h2>
            <p className="text-gray-500">Open, no key required, CORS-enabled. Call it from anywhere.</p>
            <div className="rounded-lg border border-[#2a2740] bg-[#1a1829] px-3 py-2">
              <Endpoint
                method="GET"
                path="/api/v1/summary"
                desc="overall status + what's down + open incidents"
              />
              <Endpoint method="GET" path="/api/v1/status" desc="per-service status & uptime" />
              <Endpoint
                method="GET"
                path="/api/v1/incidents"
                desc="incident history (?active=1 for open only)"
              />
            </div>
            <p className="text-xs text-gray-600">
              Example: <code className="text-gray-500">curl {origin}/api/v1/summary</code>
            </p>
            <CodeBlock code={summaryExample} />
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
