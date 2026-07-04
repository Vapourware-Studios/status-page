import { useState, useEffect, useCallback } from "react";
import type { Incident, AdminMonitor } from "../../types";
import { api } from "../../api";

const statusOptions = ["investigating", "identified", "monitoring", "resolved"];
const impactOptions = ["none", "minor", "major", "critical"];

function fmtDate(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const impactColors: Record<string, string> = {
  none: "bg-gray-100 text-gray-700",
  minor: "bg-yellow-100 text-yellow-700",
  major: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};

const statusColors: Record<string, string> = {
  investigating: "text-yellow-600",
  identified: "text-orange-600",
  monitoring: "text-blue-600",
  resolved: "text-green-600",
};

interface CreateModalProps {
  monitors: AdminMonitor[];
  onCreate: (data: {
    title: string;
    impact: string;
    initialUpdate: string;
    monitorIds: string[];
  }) => Promise<void>;
  onClose: () => void;
}

function CreateModal({ monitors, onCreate, onClose }: CreateModalProps) {
  const [title, setTitle] = useState("");
  const [impact, setImpact] = useState("minor");
  const [update, setUpdate] = useState("");
  const [selectedMonitors, setSelectedMonitors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await onCreate({ title, impact, initialUpdate: update, monitorIds: selectedMonitors });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  const claimedMonitors = monitors.filter((m) => m.claimed);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg space-y-4 my-4">
        <h2 className="font-semibold text-gray-900">Create Incident</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Incident title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <select
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={impact}
            onChange={(e) => setImpact(e.target.value)}
          >
            {impactOptions.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px] resize-y"
            placeholder="Initial update message…"
            value={update}
            onChange={(e) => setUpdate(e.target.value)}
          />
          {claimedMonitors.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-gray-500 font-medium">Affected components</p>
              <div className="space-y-1 max-h-36 overflow-y-auto">
                {claimedMonitors.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedMonitors.includes(m.id)}
                      onChange={(e) =>
                        setSelectedMonitors((prev) =>
                          e.target.checked ? [...prev, m.id] : prev.filter((id) => id !== m.id)
                        )
                      }
                      className="rounded"
                    />
                    {m.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim() || !update.trim()}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium"
            >
              {loading ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface AddUpdateModalProps {
  incident: Incident;
  onAdd: (status: string, body: string, imageUrls: string[]) => Promise<void>;
  onClose: () => void;
}

function AddUpdateModal({ incident, onAdd, onClose }: AddUpdateModalProps) {
  const [status, setStatus] = useState(incident.status);
  const [body, setBody] = useState("");
  const [imageUrlInput, setImageUrlInput] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function addImageUrl() {
    const url = imageUrlInput.trim();
    if (!url) return;
    setImageUrls((prev) => [...prev, url]);
    setImageUrlInput("");
  }

  function removeImageUrl(idx: number) {
    setImageUrls((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await onAdd(status, body, imageUrls);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-4 my-4">
        <div>
          <h2 className="font-semibold text-gray-900">Add Update</h2>
          <p className="text-sm text-gray-500 truncate mt-0.5">{incident.title}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <select
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {statusOptions.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px] resize-y"
            placeholder="Update message…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            autoFocus
          />

          {/* Screenshot URLs */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-500">Screenshots / images (URLs)</p>
            <div className="flex gap-2">
              <input
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="https://example.com/screenshot.png"
                value={imageUrlInput}
                onChange={(e) => setImageUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addImageUrl(); }
                }}
              />
              <button
                type="button"
                onClick={addImageUrl}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 shrink-0"
              >
                Add
              </button>
            </div>
            {imageUrls.length > 0 && (
              <div className="space-y-2">
                {imageUrls.map((url, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <img
                      src={url}
                      alt=""
                      className="h-16 w-24 object-cover rounded border border-gray-200"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-500 truncate">{url}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeImageUrl(i)}
                      className="text-xs text-red-400 hover:text-red-600 shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !body.trim()}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium"
            >
              {loading ? "Posting…" : "Post"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [monitors, setMonitors] = useState<AdminMonitor[]>([]);
  const [modal, setModal] = useState<
    | { type: "create" }
    | { type: "update"; incident: Incident }
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [{ incidents }, { monitors }] = await Promise.all([
        api.adminIncidents(),
        api.adminMonitors(),
      ]);
      setIncidents(incidents);
      setMonitors(monitors);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(data: Parameters<typeof api.createIncident>[0]) {
    await api.createIncident(data);
    await load();
  }

  async function handleAddUpdate(inc: Incident, status: string, body: string, imageUrls: string[]) {
    await api.addIncidentUpdate(inc.id, status, body, imageUrls);
    await load();
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this incident?")) return;
    await api.deleteIncident(id);
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">Incidents</h2>
        <button
          onClick={() => setModal({ type: "create" })}
          className="text-sm bg-blue-600 text-white rounded-lg px-3 py-1.5 hover:bg-blue-700"
        >
          + Create incident
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="space-y-3">
        {incidents.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">No incidents.</p>
        )}
        {incidents.map((inc) => (
          <div
            key={inc.id}
            className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-900">{inc.title}</p>
                  <a
                    href={`/incidents/${inc.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-500 hover:underline"
                  >
                    Public page ↗
                  </a>
                </div>
                <p className="text-xs text-gray-400">{fmtDate(inc.createdAt)}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${impactColors[inc.impact] ?? ""}`}>
                  {inc.impact}
                </span>
                <span className={`text-xs font-medium capitalize ${statusColors[inc.status] ?? "text-gray-500"}`}>
                  {inc.status}
                </span>
              </div>
            </div>

            {inc.updates.length > 0 && (
              <div className="space-y-2 border-l-2 border-gray-100 pl-3">
                {inc.updates.slice(0, 3).map((u) => (
                  <div key={u.id} className="text-sm">
                    <div className="text-gray-600">
                      <span className="font-medium capitalize text-gray-700 mr-1">{u.status}:</span>
                      {u.body}
                      <span className="text-xs text-gray-400 ml-2">{fmtDate(u.createdAt)}</span>
                    </div>
                    {u.imageUrls.length > 0 && (
                      <div className="flex gap-2 mt-1 flex-wrap">
                        {u.imageUrls.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                            <img
                              src={url}
                              alt=""
                              className="h-12 w-16 object-cover rounded border border-gray-200 hover:opacity-80 transition-opacity"
                            />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {inc.updates.length > 3 && (
                  <p className="text-xs text-gray-400">+{inc.updates.length - 3} more</p>
                )}
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              {inc.status !== "resolved" && (
                <button
                  onClick={() => setModal({ type: "update", incident: inc })}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Add update
                </button>
              )}
              {inc.status !== "resolved" && (
                <button
                  onClick={() => api.updateIncident(inc.id, { status: "resolved" }).then(load)}
                  className="text-xs text-green-600 hover:underline"
                >
                  Resolve
                </button>
              )}
              <button
                onClick={() => handleDelete(inc.id)}
                className="text-xs text-red-400 hover:underline ml-auto"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {modal?.type === "create" && (
        <CreateModal
          monitors={monitors}
          onCreate={handleCreate}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "update" && (
        <AddUpdateModal
          incident={modal.incident}
          onAdd={(status, body, imageUrls) =>
            handleAddUpdate(modal.incident, status, body, imageUrls)
          }
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
