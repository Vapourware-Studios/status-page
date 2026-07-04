const CACHE = "statch-v1";
const PRECACHE = ["/", "/favicon.svg"];

// ── Install: cache shell ──────────────────────────────────────────────────────
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ─────────────────────────────────────────────
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: network-first, fall back to cache for navigation ──────────────────
self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Skip API requests
  if (url.pathname.startsWith("/api/")) return;

  // Network-first for everything; fall back to cache for navigate requests
  e.respondWith(
    fetch(request)
      .then((res) => {
        // Cache successful navigations so the shell is available offline
        if (res.ok && request.mode === "navigate") {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(request, clone));
        }
        return res;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? caches.match("/")))
  );
});

// ── Push: show notification ───────────────────────────────────────────────────
self.addEventListener("push", (e) => {
  if (!e.data) return;

  let data;
  try {
    data = e.data.json();
  } catch {
    data = { title: "Statch", body: e.data.text() };
  }

  const title = data.title ?? "Statch";
  const options = {
    body: data.body ?? "",
    icon: data.icon ?? "/favicon.svg",
    badge: data.badge ?? "/favicon.svg",
    tag: data.tag ?? "statch",
    data: { url: data.url ?? "/" },
    requireInteraction: data.tag?.startsWith("monitor-") || data.tag?.startsWith("incident-"),
    silent: false,
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click: open / focus the status page ─────────────────────────
self.addEventListener("notificationclick", (e) => {
  e.notification.close();

  const targetUrl = e.notification.data?.url ?? "/";
  const fullUrl = new URL(targetUrl, self.location.origin).href;

  e.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const match = clients.find((c) => c.url === fullUrl);
        if (match) return match.focus();
        return self.clients.openWindow(fullUrl);
      })
  );
});
