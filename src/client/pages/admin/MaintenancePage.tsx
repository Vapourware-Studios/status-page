import { useState, useEffect, useCallback } from "react";
import type { AdminMaintenanceWindow, AdminMonitor } from "../../types";
import { api } from "../../api";

function fmtDateLocal(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(s: string): number {
  return new Date(s).getTime();
}

const statusColors: Record<string, string> = {
  scheduled: "bg-gray-100 text-gray-700",
  active: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

interface CreateModalProps {
  monitors: AdminMonitor[];
  onCreate: (data: {
    title: string;
    description: string;
    startTime: number;
    endTime: number;
    monitorIds: string[];
  }) => Promise<void>;
  onClose: () => void;
}

function CreateModal({ monitors, onCreate, onClose }: CreateModalProps) {
  const nowMs = Date.now();
  const in1h = nowMs + 60 * 60 * 1000;
  const in2h = nowMs + 2 * 60 * 60 * 1000;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startTime, setStartTime] = useState(toDatetimeLocal(in1h));
  const [endTime, setEndTime] = useState(toDatetimeLocal(in2h));
  const [selectedMonitors, setSelectedMonitors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await onCreate({
        title,
        description,
        startTime: fromDatetimeLocal(startTime),
        endTime: fromDatetimeLocal(endTime),
        monitorIds: selectedMonitors,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  function toggleMonitor(id: string) {
    setSelectedMonitors((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-4">
        <h2 className="font-semibold text-gray-900">Schedule maintenance</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Title (e.g. Database upgrade)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            required
          />
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            placeholder="Description (optional)"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-gray-500 font-medium">Start</label>
              <input
                type="datetime-local"
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-500 font-medium">End</label>
              <input
                type="datetime-local"
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
              />
            </div>
          </div>

          {monitors.filter((m) => m.claimed).length > 0 && (
            <div className="space-y-1">
              <label className="text-xs text-gray-500 font-medium">
                Affected monitors
                <span className="text-gray-400 ml-1">(leave empty = all)</span>
              </label>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-32 overflow-y-auto">
                {monitors
                  .filter((m) => m.claimed && m.name)
                  .map((m) => (
                    <label
                      key={m.id}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedMonitors.includes(m.id)}
                        onChange={() => toggleMonitor(m.id)}
                        className="rounded"
                      />
                      <span className="text-sm text-gray-800">{m.name}</span>
                    </label>
                  ))}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim()}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium"
            >
              {loading ? "Scheduling…" : "Schedule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function MaintenancePage() {
  const [windows, setWindows] = useState<AdminMaintenanceWindow[]>([]);
  const [monitors, setMonitors] = useState<AdminMonitor[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [{ maintenance }, { monitors }] = await Promise.all([
        api.adminMaintenance(),
        api.adminMonitors(),
      ]);
      setWindows(maintenance);
      setMonitors(monitors);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(data: {
    title: string;
    description: string;
    startTime: number;
    endTime: number;
    monitorIds: string[];
  }) {
    await api.createMaintenance(data);
    await load();
  }

  async function handleCancel(id: number) {
    if (!confirm("Cancel this maintenance window?")) return;
    await api.updateMaintenance(id, { status: "cancelled" });
    await load();
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this maintenance window?")) return;
    await api.deleteMaintenance(id);
    await load();
  }

  const monitorNameMap = new Map(monitors.map((m) => [m.id, m.name ?? m.id]));

  const active = windows.filter((w) => w.status === "active");
  const scheduled = windows.filter((w) => w.status === "scheduled");
  const past = windows.filter((w) => w.status === "completed" || w.status === "cancelled");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">Maintenance</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="text-sm bg-blue-600 text-white rounded-lg px-3 py-1.5 hover:bg-blue-700"
        >
          + Schedule maintenance
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Active */}
      {active.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Active</h3>
          <WindowList windows={active} monitorNames={monitorNameMap} onCancel={handleCancel} onDelete={handleDelete} />
        </div>
      )}

      {/* Scheduled */}
      {scheduled.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Upcoming</h3>
          <WindowList windows={scheduled} monitorNames={monitorNameMap} onCancel={handleCancel} onDelete={handleDelete} />
        </div>
      )}

      {/* Past */}
      {past.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">History</h3>
          <WindowList windows={past} monitorNames={monitorNameMap} onCancel={handleCancel} onDelete={handleDelete} />
        </div>
      )}

      {windows.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-400">No maintenance windows scheduled.</p>
        </div>
      )}

      {showCreate && (
        <CreateModal
          monitors={monitors}
          onCreate={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}

function WindowList({
  windows,
  monitorNames,
  onCancel,
  onDelete,
}: {
  windows: AdminMaintenanceWindow[];
  monitorNames: Map<string, string>;
  onCancel: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 shadow-sm overflow-hidden">
      {windows.map((w) => (
        <div key={w.id} className="px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium text-gray-900 text-sm">{w.title}</p>
                <span
                  className={`text-xs font-medium px-1.5 py-0.5 rounded ${statusColors[w.status] ?? ""}`}
                >
                  {w.status}
                </span>
              </div>
              {w.description && (
                <p className="text-xs text-gray-500 mt-0.5">{w.description}</p>
              )}
              <p className="text-xs text-gray-400 mt-1">
                {fmtDateLocal(w.startTime)} → {fmtDateLocal(w.endTime)}
              </p>
              {w.monitorIds.length > 0 && (
                <p className="text-xs text-gray-400 mt-0.5">
                  Affects: {w.monitorIds.map((id) => monitorNames.get(id) ?? id).join(", ")}
                </p>
              )}
              {w.monitorIds.length === 0 && (
                <p className="text-xs text-gray-400 mt-0.5">Affects all monitors</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {(w.status === "scheduled" || w.status === "active") && (
                <button
                  onClick={() => onCancel(w.id)}
                  className="text-xs text-gray-400 hover:text-gray-700"
                >
                  Cancel
                </button>
              )}
              {(w.status === "completed" || w.status === "cancelled") && (
                <button
                  onClick={() => onDelete(w.id)}
                  className="text-xs text-red-400 hover:text-red-600"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
