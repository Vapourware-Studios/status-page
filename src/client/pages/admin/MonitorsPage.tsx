import { useState, useEffect, useCallback } from "react";
import type { AdminMonitor, AdminMonitorGroup, LatencySample } from "../../types";
import { api } from "../../api";
import { StatusDot } from "../../components/StatusDot";
import { LatencyChart } from "../../components/LatencyChart";

function fmtRelative(ms: number | null) {
  if (!ms) return "never";
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

// ── Modals ────────────────────────────────────────────────────────────────────

// Cloudflare-tunnel-style enrolment: name the server, mint a one-shot token,
// copy the printed one-liner onto the box — it auto-discovers itself. No code
// to type back in.
function EnrollModal({ onClose }: { onClose: () => void }) {
  const [label, setLabel] = useState("");
  const [install, setInstall] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!install) return;
    navigator.clipboard.writeText(install);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api.createEnrollToken(label.trim() || undefined);
      setInstall(r.install);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-4">
        <h2 className="font-semibold text-gray-900">Add server</h2>
        {!install ? (
          <form onSubmit={handleGenerate} className="space-y-3">
            <p className="text-sm text-gray-500">
              Give it a name, then run the generated command on the machine you want to monitor.
              It enrols itself and appears here within seconds.
            </p>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Name (optional, e.g. Home Server) — defaults to hostname"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              autoFocus
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={loading} className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium">
                {loading ? "Generating…" : "Generate command"}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">Run this on your server (valid for 1 hour, single use):</p>
            <div className="flex items-center gap-2 bg-gray-950 rounded-lg px-3 py-2">
              <code className="flex-1 text-xs text-green-400 font-mono break-all">{install}</code>
              <button type="button" onClick={handleCopy} className="shrink-0 text-xs text-gray-400 hover:text-white">
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-xs text-gray-400">Keep this token secret — anyone who runs it can enrol a monitor.</p>
            <button onClick={onClose} className="w-full bg-gray-100 hover:bg-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-700">Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

function AddHttpModal({ onAdd, onClose }: { onAdd: (name: string, url: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try { await onAdd(name, url); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm space-y-4">
        <h2 className="font-semibold text-gray-900">Add HTTP Monitor</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Name (e.g. API)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="https://example.com" value={url} onChange={(e) => setUrl(e.target.value)} type="url" />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={loading || !name.trim() || !url.trim()} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium">{loading ? "Adding…" : "Add"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddTcpModal({ onAdd, onClose }: { onAdd: (name: string, target: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try { await onAdd(name, target); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm space-y-4">
        <h2 className="font-semibold text-gray-900">Add TCP Monitor</h2>
        <p className="text-xs text-gray-500">Checks if a TCP port is reachable. Good for databases, game servers, etc.</p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Name (e.g. PostgreSQL)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="db.example.com:5432" value={target} onChange={(e) => setTarget(e.target.value)} />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={loading || !name.trim() || !target.trim()} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium">{loading ? "Adding…" : "Add"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddAgentMonitorModal({ parentMonitor, onAdd, onClose }: { parentMonitor: AdminMonitor; onAdd: (parentId: string, name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try { await onAdd(parentMonitor.id, name); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">Add monitor to agent</h2>
          <p className="text-xs text-gray-400 mt-0.5">Agent: <span className="font-medium text-gray-600">{parentMonitor.name}</span></p>
        </div>
        <p className="text-sm text-gray-500">Creates an additional monitor that shares this agent's heartbeat.</p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Monitor name (e.g. PostgreSQL, Redis)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={loading || !name.trim()} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium">{loading ? "Adding…" : "Add monitor"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Monitor row ────────────────────────────────────────────────────────────────

interface MonitorRowProps {
  m: AdminMonitor;
  isChild?: boolean;
  groups: AdminMonitorGroup[];
  onTogglePause: (m: AdminMonitor) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onAssignGroup: (id: string, groupId: number | null) => void;
  onSaveExternal: (id: string, label: string, url: string) => Promise<void>;
  onToggleCloudflare: (id: string, value: boolean) => Promise<void>;
  onAddToAgent?: (m: AdminMonitor) => void;
  editName: Record<string, string>;
  setEditName: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  latency: Record<string, LatencySample[]>;
}

function MonitorRow({
  m, isChild, groups, onTogglePause, onDelete, onRename, onAssignGroup,
  onSaveExternal, onToggleCloudflare, onAddToAgent,
  editName, setEditName, latency,
}: MonitorRowProps) {
  const [showLatency, setShowLatency] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const [extLabel, setExtLabel] = useState(m.externalStatusLabel ?? "");
  const [extUrl, setExtUrl] = useState(m.externalStatusUrl ?? "");
  const [savingExt, setSavingExt] = useState(false);
  const samples = latency[m.id] ?? [];

  return (
    <div className={`px-5 py-3 space-y-1.5 ${isChild ? "bg-gray-50 pl-10" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {isChild && <span className="text-gray-300 text-sm select-none">└</span>}
          <StatusDot status={m.status as "up" | "down" | "paused" | "pending"} size="sm" />
          {editName[m.id] !== undefined ? (
            <form onSubmit={(e) => { e.preventDefault(); onRename(m.id, editName[m.id] ?? ""); }} className="flex gap-1">
              <input
                className="border border-gray-300 rounded px-2 py-0.5 text-sm"
                value={editName[m.id] ?? ""}
                onChange={(e) => setEditName((prev) => ({ ...prev, [m.id]: e.target.value }))}
                autoFocus
              />
              <button type="submit" className="text-xs text-blue-600 hover:underline">Save</button>
              <button type="button" onClick={() => setEditName((prev) => { const next = { ...prev }; delete next[m.id]; return next; })} className="text-xs text-gray-400 hover:underline">Cancel</button>
            </form>
          ) : (
            <span className="font-medium text-gray-900 truncate">
              {m.name ?? <span className="text-gray-400 italic">Pending…</span>}
            </span>
          )}
          {/* Type badge */}
          {m.type !== "push" && (
            <span className="text-xs text-gray-400 uppercase tracking-wide bg-gray-100 px-1.5 py-0.5 rounded">
              {m.type}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-400">
            {m.type === "push" ? fmtRelative(m.lastSeenAt) : m.lastLatencyMs != null ? `${m.lastLatencyMs}ms` : m.status}
          </span>
          {m.claimed && (
            <>
              <button onClick={() => setEditName((prev) => ({ ...prev, [m.id]: m.name ?? "" }))} className="text-xs text-gray-400 hover:text-gray-700">rename</button>
              <button onClick={() => onTogglePause(m)} className="text-xs text-gray-400 hover:text-gray-700">{m.status === "paused" ? "resume" : "pause"}</button>
              <button onClick={() => setShowExtra((v) => !v)} className={`text-xs hover:text-gray-700 ${m.externalStatusLabel || m.checkCloudflare ? "text-amber-500" : "text-gray-400"}`}>integrations</button>
              {(m.type === "http" || m.type === "tcp") && samples.length > 0 && (
                <button onClick={() => setShowLatency((v) => !v)} className="text-xs text-blue-500 hover:text-blue-700">
                  {showLatency ? "hide chart" : "chart"}
                </button>
              )}
              {onAddToAgent && (
                <button onClick={() => onAddToAgent(m)} className="text-xs text-blue-500 hover:text-blue-700">+ monitor</button>
              )}
            </>
          )}
          <button onClick={() => onDelete(m.id)} className="text-xs text-red-400 hover:text-red-600">delete</button>
        </div>
      </div>

      {/* URL */}
      {(m.type === "http" || m.type === "tcp") && m.targetUrl && (
        <p className="text-xs text-gray-400 pl-[22px] truncate">{m.targetUrl}</p>
      )}

      {/* Integrations: external status reference + Cloudflare auto-check */}
      {m.claimed && showExtra && (
        <div className="pl-[22px] pt-2 space-y-3">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-gray-500">
              Official status reference
              <span className="text-gray-400 font-normal"> — shows "Official status for …" under this monitor</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                className="flex-1 min-w-[140px] border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                placeholder="Provider name (e.g. Cloudflare)"
                value={extLabel}
                onChange={(e) => setExtLabel(e.target.value)}
              />
              <input
                className="flex-1 min-w-[140px] border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
                placeholder="https://status.provider.com (optional link)"
                value={extUrl}
                onChange={(e) => setExtUrl(e.target.value)}
              />
              <button
                onClick={async () => { setSavingExt(true); try { await onSaveExternal(m.id, extLabel, extUrl); } finally { setSavingExt(false); } }}
                disabled={savingExt || (extLabel === (m.externalStatusLabel ?? "") && extUrl === (m.externalStatusUrl ?? ""))}
                className="text-xs bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 rounded px-3 py-1 font-medium"
              >
                {savingExt ? "…" : "Save"}
              </button>
            </div>
          </div>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={m.checkCloudflare}
              onChange={(e) => onToggleCloudflare(m.id, e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-xs text-gray-600">
              <span className="font-medium text-gray-700">Auto-check Cloudflare on outage</span>
              <span className="block text-gray-400">
                When this monitor goes down, probe Cloudflare's status (Brisbane / Workers / Pages / DNS / global).
                On a match, the incident is noted as a likely Cloudflare outage.
              </span>
            </span>
          </label>
        </div>
      )}

      {/* Group selector */}
      {m.claimed && !isChild && groups.length > 0 && (
        <div className="pl-[22px] flex items-center gap-1.5">
          <span className="text-xs text-gray-400">Group:</span>
          <select
            value={m.groupId ?? ""}
            onChange={(e) => onAssignGroup(m.id, e.target.value === "" ? null : parseInt(e.target.value, 10))}
            className="text-xs border border-gray-200 rounded px-1.5 py-0.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="">None</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Latency sparkline */}
      {showLatency && samples.length >= 2 && (
        <div className="pl-[22px] pt-1">
          <LatencyChart samples={samples} width={240} height={36} />
        </div>
      )}
    </div>
  );
}

// ── Groups management inline ───────────────────────────────────────────────────

function GroupsPanel({
  groups,
  onCreateGroup,
  onDeleteGroup,
}: {
  groups: AdminMonitorGroup[];
  onCreateGroup: (name: string) => Promise<void>;
  onDeleteGroup: (id: number) => Promise<void>;
}) {
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    try {
      await onCreateGroup(newName.trim());
      setNewName("");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-3">
      <h3 className="text-sm font-semibold text-gray-700">Monitor Groups</h3>
      {groups.length === 0 && <p className="text-xs text-gray-400">No groups yet.</p>}
      {groups.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {groups.map((g) => (
            <div key={g.id} className="flex items-center gap-1 bg-gray-100 rounded-full px-3 py-1 text-sm text-gray-700">
              {g.name}
              <button onClick={() => onDeleteGroup(g.id)} className="text-gray-400 hover:text-red-500 ml-1 text-xs leading-none">×</button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="New group name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit" disabled={adding || !newName.trim()} className="text-sm bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 rounded-lg px-3 py-1.5 font-medium">
          {adding ? "…" : "+ Group"}
        </button>
      </form>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

// Latency is no longer stored — sample lastLatencyMs live into a rolling window.
const LATENCY_CAP = 60;

function appendLatency(
  prev: Record<string, LatencySample[]>,
  monitors: AdminMonitor[]
): Record<string, LatencySample[]> {
  const now = Date.now();
  const next: Record<string, LatencySample[]> = { ...prev };
  for (const m of monitors) {
    if ((m.type === "http" || m.type === "tcp") && m.lastLatencyMs != null && m.lastLatencyMs > 0) {
      next[m.id] = [...(next[m.id] ?? []), { latencyMs: m.lastLatencyMs, checkedAt: now }].slice(
        -LATENCY_CAP
      );
    }
  }
  return next;
}

export function MonitorsPage() {
  const [monitors, setMonitors] = useState<AdminMonitor[]>([]);
  const [groups, setGroups] = useState<AdminMonitorGroup[]>([]);
  const [latency, setLatency] = useState<Record<string, LatencySample[]>>({});
  const [modal, setModal] = useState<
    "enroll" | "http" | "tcp" | { type: "addToAgent"; parent: AdminMonitor } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [editName, setEditName] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const [{ monitors }, { groups }] = await Promise.all([
        api.adminMonitors(),
        api.adminGroups(),
      ]);
      setMonitors(monitors);
      setGroups(groups);
      setLatency((prev) => appendLatency(prev, monitors));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  // Poll so the live latency sparkline keeps filling while the page is open.
  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const claimed = monitors.filter((m) => m.claimed);
  const groups_sorted = [...groups].sort((a, b) => a.sortOrder - b.sortOrder);

  // Group push monitors by agentGroupId
  const agentGroups: Array<{ root: AdminMonitor; children: AdminMonitor[] }> = [];
  const grouped = new Set<string>();

  for (const m of claimed) {
    if (grouped.has(m.id)) continue;
    if (m.type === "push" && m.agentGroupId) {
      const siblings = claimed.filter((s) => s.type === "push" && s.agentGroupId === m.agentGroupId && s.id !== m.id);
      const isRoot = m.agentGroupId === m.id || !claimed.some((s) => s.id === m.agentGroupId && !grouped.has(s.id));
      if (isRoot) {
        agentGroups.push({ root: m, children: siblings });
        grouped.add(m.id);
        siblings.forEach((s) => grouped.add(s.id));
      }
    } else {
      agentGroups.push({ root: m, children: [] });
      grouped.add(m.id);
    }
  }
  for (const m of claimed) {
    if (!grouped.has(m.id)) {
      agentGroups.push({ root: m, children: [] });
    }
  }

  const rowProps = {
    groups: groups_sorted,
    onTogglePause: async (m: AdminMonitor) => {
      await api.updateMonitor(m.id, { status: m.status === "paused" ? "up" : "paused" });
      await load();
    },
    onDelete: async (id: string) => {
      if (!confirm("Delete this monitor?")) return;
      await api.deleteMonitor(id);
      await load();
    },
    onRename: async (id: string, name: string) => {
      if (!name.trim()) return;
      await api.updateMonitor(id, { name });
      setEditName((prev) => { const next = { ...prev }; delete next[id]; return next; });
      await load();
    },
    onAssignGroup: async (id: string, groupId: number | null) => {
      await api.assignGroup(id, groupId);
      await load();
    },
    onSaveExternal: async (id: string, label: string, url: string) => {
      await api.updateMonitor(id, {
        externalStatusLabel: label.trim() || null,
        externalStatusUrl: url.trim() || null,
      });
      await load();
    },
    onToggleCloudflare: async (id: string, value: boolean) => {
      await api.updateMonitor(id, { checkCloudflare: value });
      await load();
    },
    editName,
    setEditName,
    latency,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">Monitors</h2>
        <div className="flex gap-2">
          <button onClick={() => setModal("enroll")} className="text-sm bg-white border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50">+ Server</button>
          <button onClick={() => setModal("http")} className="text-sm bg-white border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50">+ HTTP</button>
          <button onClick={() => setModal("tcp")} className="text-sm bg-blue-600 text-white rounded-lg px-3 py-1.5 hover:bg-blue-700">+ TCP</button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <GroupsPanel
        groups={groups_sorted}
        onCreateGroup={async (name) => { await api.createGroup(name); await load(); }}
        onDeleteGroup={async (id) => { if (!confirm("Delete this group? Monitors will be ungrouped.")) return; await api.deleteGroup(id); await load(); }}
      />

      <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 shadow-sm overflow-hidden">
        {agentGroups.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-gray-400">No monitors yet.</p>
        )}
        {agentGroups.map(({ root, children }) => (
          <div key={root.id}>
            <MonitorRow
              m={root}
              onAddToAgent={root.type === "push" ? (m) => setModal({ type: "addToAgent", parent: m }) : undefined}
              {...rowProps}
            />
            {children.map((child) => (
              <MonitorRow key={child.id} m={child} isChild {...rowProps} />
            ))}
          </div>
        ))}
      </div>

      {modal === "enroll" && <EnrollModal onClose={() => { setModal(null); void load(); }} />}
      {modal === "http" && <AddHttpModal onAdd={async (name, url) => { await api.addHttpMonitor(name, url); await load(); }} onClose={() => setModal(null)} />}
      {modal === "tcp" && <AddTcpModal onAdd={async (name, target) => { await api.addTcpMonitor(name, target); await load(); }} onClose={() => setModal(null)} />}
      {modal !== null && typeof modal === "object" && modal.type === "addToAgent" && (
        <AddAgentMonitorModal
          parentMonitor={modal.parent}
          onAdd={async (parentId, name) => { await api.addMonitorToAgent(parentId, name); await load(); }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
