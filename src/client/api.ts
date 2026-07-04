async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    credentials: "include",
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // ── Public ──────────────────────────────────────────────────────────────────
  status: () => apiFetch<import("./types").StatusData>("/api/status"),
  incidents: (page = 1) =>
    apiFetch<{ incidents: import("./types").Incident[]; page: number; hasMore: boolean }>(
      `/api/incidents?page=${page}`
    ),
  getIncident: (id: number) =>
    apiFetch<{
      incident: import("./types").Incident & {
        affectedMonitorNames: { id: string; name: string | null }[];
      };
    }>(`/api/incidents/${id}`),
  getMonitor: (id: string) =>
    apiFetch<{ monitor: import("./types").MonitorDetail }>(
      `/api/monitors/${encodeURIComponent(id)}`
    ),

  // ── Auth ────────────────────────────────────────────────────────────────────
  login: (password: string) =>
    apiFetch<{ ok: boolean }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  logout: () => apiFetch<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  me: () =>
    apiFetch<{ authenticated: boolean; isOwner?: boolean; discordUserId?: string }>(
      "/api/auth/me"
    ),

  // ── Users ───────────────────────────────────────────────────────────────────
  listUsers: () =>
    apiFetch<{ users: import("./types").AllowedUser[]; ownerId: string }>(
      "/api/admin/users"
    ),
  addUser: (discordUserId: string) =>
    apiFetch<{ ok: boolean }>("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ discordUserId }),
    }),
  deleteUser: (discordUserId: string) =>
    apiFetch<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(discordUserId)}`, {
      method: "DELETE",
    }),

  // ── Monitors ────────────────────────────────────────────────────────────────
  adminMonitors: () =>
    apiFetch<{ monitors: import("./types").AdminMonitor[] }>("/api/admin/monitors"),
  // Mint a one-shot enrolment token → the admin pastes the returned one-liner
  // onto a server and it auto-discovers itself (no pairing code to type back).
  createEnrollToken: (label?: string, groupId?: number | null) =>
    apiFetch<{ ok: boolean; token: string; install: string; expiresAt: number }>(
      "/api/admin/monitors/enroll-token",
      { method: "POST", body: JSON.stringify({ label, groupId }) }
    ),
  addHttpMonitor: (name: string, targetUrl: string) =>
    apiFetch<{ ok: boolean; monitorId: string }>("/api/admin/monitors/http", {
      method: "POST",
      body: JSON.stringify({ name, targetUrl }),
    }),
  addTcpMonitor: (name: string, target: string) =>
    apiFetch<{ ok: boolean; monitorId: string }>("/api/admin/monitors/tcp", {
      method: "POST",
      body: JSON.stringify({ name, target }),
    }),
  updateMonitor: (id: string, data: Record<string, unknown>) =>
    apiFetch<{ ok: boolean }>(`/api/admin/monitors/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteMonitor: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/admin/monitors/${id}`, { method: "DELETE" }),
  reorderMonitors: (order: string[]) =>
    apiFetch<{ ok: boolean }>("/api/admin/monitors/reorder", {
      method: "POST",
      body: JSON.stringify({ order }),
    }),
  addMonitorToAgent: (parentId: string, name: string) =>
    apiFetch<{ ok: boolean; monitorId: string }>(`/api/admin/monitors/${parentId}/add`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  // ── Incidents ───────────────────────────────────────────────────────────────
  adminIncidents: () =>
    apiFetch<{ incidents: import("./types").Incident[] }>("/api/admin/incidents"),
  createIncident: (data: {
    title: string;
    impact: string;
    initialUpdate: string;
    monitorIds: string[];
  }) =>
    apiFetch<{ ok: boolean; incidentId: number }>("/api/admin/incidents", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateIncident: (id: number, data: Record<string, unknown>) =>
    apiFetch<{ ok: boolean }>(`/api/admin/incidents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  addIncidentUpdate: (id: number, status: string, body: string, imageUrls?: string[]) =>
    apiFetch<{ ok: boolean }>(`/api/admin/incidents/${id}/updates`, {
      method: "POST",
      body: JSON.stringify({ status, body, imageUrls: imageUrls ?? [] }),
    }),
  deleteIncident: (id: number) =>
    apiFetch<{ ok: boolean }>(`/api/admin/incidents/${id}`, { method: "DELETE" }),

  // ── Settings ────────────────────────────────────────────────────────────────
  adminSettings: () =>
    apiFetch<{ settings: import("./types").AdminSettings }>("/api/admin/settings"),
  updateSettings: (data: {
    pageTitle?: string;
    headline?: string;
    discordWebhookUrl?: string | null;
    autoIncidents?: boolean;
  }) =>
    apiFetch<{ ok: boolean }>("/api/admin/settings", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  // ── Webhooks ────────────────────────────────────────────────────────────────
  listWebhooks: () =>
    apiFetch<{ webhooks: import("./types").Webhook[] }>("/api/admin/webhooks"),
  addWebhook: (label: string, url: string) =>
    apiFetch<{ ok: boolean; webhook: import("./types").Webhook }>("/api/admin/webhooks", {
      method: "POST",
      body: JSON.stringify({ label, url }),
    }),
  deleteWebhook: (id: number) =>
    apiFetch<{ ok: boolean }>(`/api/admin/webhooks/${id}`, { method: "DELETE" }),
  testWebhook: (id: number) =>
    apiFetch<{ ok: boolean }>(`/api/admin/webhooks/${id}/test`, { method: "POST" }),
  testAllChannels: () =>
    apiFetch<{ ok: boolean; webhooks: number; pushSent: number; pushRemoved: number }>(
      "/api/admin/webhooks/test-all",
      { method: "POST" }
    ),

  // ── Maintenance ─────────────────────────────────────────────────────────────
  adminMaintenance: () =>
    apiFetch<{ maintenance: import("./types").AdminMaintenanceWindow[] }>(
      "/api/admin/maintenance"
    ),
  createMaintenance: (data: {
    title: string;
    description?: string;
    startTime: number;
    endTime: number;
    monitorIds?: string[];
  }) =>
    apiFetch<{ ok: boolean; id: number }>("/api/admin/maintenance", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateMaintenance: (id: number, data: Record<string, unknown>) =>
    apiFetch<{ ok: boolean }>(`/api/admin/maintenance/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteMaintenance: (id: number) =>
    apiFetch<{ ok: boolean }>(`/api/admin/maintenance/${id}`, { method: "DELETE" }),

  // ── Groups ──────────────────────────────────────────────────────────────────
  adminGroups: () =>
    apiFetch<{ groups: import("./types").AdminMonitorGroup[] }>("/api/admin/groups"),
  createGroup: (name: string) =>
    apiFetch<{ ok: boolean; group: import("./types").AdminMonitorGroup }>(
      "/api/admin/groups",
      { method: "POST", body: JSON.stringify({ name }) }
    ),
  updateGroup: (id: number, data: { name?: string; sortOrder?: number }) =>
    apiFetch<{ ok: boolean }>(`/api/admin/groups/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteGroup: (id: number) =>
    apiFetch<{ ok: boolean }>(`/api/admin/groups/${id}`, { method: "DELETE" }),
  assignGroup: (monitorId: string, groupId: number | null) =>
    apiFetch<{ ok: boolean }>("/api/admin/groups/assign", {
      method: "POST",
      body: JSON.stringify({ monitorId, groupId }),
    }),

  // ── Push notifications ───────────────────────────────────────────────────────
  vapidPublicKey: () =>
    apiFetch<{ publicKey: string }>("/api/push/vapid-public-key"),
  pushSubscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, deviceName?: string) =>
    apiFetch<{ ok: boolean; id: number }>("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify({ ...sub, deviceName }),
    }),
  pushUnsubscribe: (endpoint: string) =>
    apiFetch<{ ok: boolean }>("/api/push/unsubscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint }),
    }),
  listPushSubscriptions: () =>
    apiFetch<{ subscriptions: import("./types").PushSubscriptionInfo[] }>(
      "/api/push/subscriptions"
    ),
  deletePushSubscription: (id: number) =>
    apiFetch<{ ok: boolean }>(`/api/push/subscriptions/${id}`, { method: "DELETE" }),
  testPush: () =>
    apiFetch<{ ok: boolean; sent: number; removed: number }>("/api/push/test", {
      method: "POST",
    }),
};
