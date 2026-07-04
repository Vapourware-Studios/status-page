import { useState, useEffect } from "react";
import { MonitorsPage } from "./MonitorsPage";
import { IncidentsPage } from "./IncidentsPage";
import { SettingsPage } from "./SettingsPage";
import { LoginPage } from "./LoginPage";
import { MaintenancePage } from "./MaintenancePage";
import { UsersPage } from "./UsersPage";
import { api } from "../../api";

type Tab = "monitors" | "incidents" | "maintenance" | "settings" | "users";

const baseTabs: { id: Tab; label: string }[] = [
  { id: "monitors", label: "Monitors" },
  { id: "incidents", label: "Incidents" },
  { id: "maintenance", label: "Maintenance" },
  { id: "settings", label: "Settings" },
];

export function AdminApp() {
  const [tab, setTab] = useState<Tab>("monitors");
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setAuthed(false), 5000);
    api
      .me()
      .then((r) => {
        setAuthed(r.authenticated);
        setIsOwner(r.isOwner ?? false);
      })
      .catch(() => setAuthed(false))
      .finally(() => clearTimeout(timer));
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await api.logout();
    } finally {
      window.location.href = "/admin";
    }
  }

  if (authed === null) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-sm text-gray-400">Loading…</div>
      </div>
    );
  }

  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />;

  const tabs = isOwner
    ? [...baseTabs, { id: "users" as Tab, label: "Users" }]
    : baseTabs;

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Dark, polished top chrome */}
      <header className="sticky top-0 z-40 bg-linear-to-b from-[#1a1730] to-[#141225] border-b border-white/10 shadow-lg shadow-black/20">
        <div className="max-w-5xl mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <a href="/" className="flex items-center gap-2 font-semibold text-white text-sm">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-indigo-500 text-white text-xs font-bold">S</span>
                Statch
                <span className="text-[10px] font-normal text-indigo-300/70 border border-indigo-400/30 rounded px-1.5 py-0.5">admin</span>
              </a>
            </div>
            <div className="flex items-center gap-4">
              <a href="/" className="text-xs text-gray-400 hover:text-white transition-colors">Public page ↗</a>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="text-xs text-gray-400 hover:text-red-400 disabled:opacity-50 transition-colors"
              >
                {loggingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </div>
          <nav className="flex gap-1 -mb-px overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  tab === t.id
                    ? "border-indigo-400 text-white"
                    : "border-transparent text-gray-400 hover:text-gray-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-200/70 p-6">
          {tab === "monitors" && <MonitorsPage />}
          {tab === "incidents" && <IncidentsPage />}
          {tab === "maintenance" && <MaintenancePage />}
          {tab === "settings" && <SettingsPage />}
          {tab === "users" && isOwner && <UsersPage />}
        </div>
      </main>
    </div>
  );
}
