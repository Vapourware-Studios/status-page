import { useState, useEffect } from "react";
import { api } from "../../api";
import type { AllowedUser } from "../../types";

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function UsersPage() {
  const [users, setUsers] = useState<AllowedUser[]>([]);
  const [ownerId, setOwnerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [newId, setNewId] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    try {
      const { users: u, ownerId: oid } = await api.listUsers();
      setUsers(u);
      setOwnerId(oid);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newId.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await api.addUser(newId.trim());
      setNewId("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add user");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(discordUserId: string) {
    if (!confirm(`Remove user ${discordUserId}? They will be logged out immediately.`)) return;
    setDeletingId(discordUserId);
    setError(null);
    try {
      await api.deleteUser(discordUserId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove user");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Allowed Users</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Users who can log in via Discord. Add by Discord user ID.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          type="text"
          placeholder="Discord user ID (e.g. 123456789012345678)"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={adding || !newId.trim()}
          className="bg-gray-800 hover:bg-gray-900 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          {adding ? "Adding…" : "Add"}
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          {users.length === 0 ? (
            <p className="text-sm text-gray-400 px-4 py-3">No users.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Discord ID</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Added</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.discordUserId} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-2.5 font-mono text-gray-800">
                      {u.discordUserId}
                      {!!ownerId && u.discordUserId === ownerId && (
                        <span className="ml-2 text-xs text-blue-600 font-sans font-medium">owner</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{formatDate(u.createdAt)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {(!ownerId || u.discordUserId !== ownerId) && (
                        <button
                          onClick={() => handleDelete(u.discordUserId)}
                          disabled={deletingId === u.discordUserId}
                          className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50 transition-colors"
                        >
                          {deletingId === u.discordUserId ? "Removing…" : "Remove"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
