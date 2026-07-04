import { useState, useEffect, useCallback } from "react";
import type { AdminSettings, Webhook, PushSubscriptionInfo } from "../../types";
import { api } from "../../api";

// ── Push helpers ──────────────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function getDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Browser";
}

const isIOSNotInstalled = (): boolean => {
  const iOS =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && "ontouchend" in document);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  return iOS && !standalone;
};

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Push Notifications section ─────────────────────────────────────────────────

function PushSection() {
  const [subscriptions, setSubscriptions] = useState<PushSubscriptionInfo[]>([]);
  const [thisDeviceSubbed, setThisDeviceSubbed] = useState(false);
  const [pushState, setPushState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [testState, setTestState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [testMsg, setTestMsg] = useState<string | null>(null);

  const supported = "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;

  const loadSubs = useCallback(async () => {
    try {
      const { subscriptions } = await api.listPushSubscriptions();
      setSubscriptions(subscriptions);
    } catch {
      // not critical
    }
  }, []);

  useEffect(() => {
    loadSubs();
    if (!supported) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setThisDeviceSubbed(!!sub))
      .catch(() => {});
  }, [loadSubs, supported]);

  async function handleSubscribeThis() {
    setPushState("loading");
    setPushMsg(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushState("error");
        setPushMsg("Notifications were not allowed. Enable them in browser/OS settings.");
        return;
      }
      const { publicKey } = await api.vapidPublicKey();
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await api.pushSubscribe(json, getDeviceName());
      setThisDeviceSubbed(true);
      setPushState("done");
      setPushMsg("Subscribed! This device will receive push notifications.");
      await loadSubs();
    } catch (err) {
      setPushState("error");
      setPushMsg(err instanceof Error ? err.message : "Subscribe failed");
    }
  }

  async function handleUnsubscribeThis() {
    setPushState("loading");
    setPushMsg(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.pushUnsubscribe(sub.endpoint);
        await sub.unsubscribe();
      }
      setThisDeviceSubbed(false);
      setPushState("idle");
      await loadSubs();
    } catch (err) {
      setPushState("error");
      setPushMsg(err instanceof Error ? err.message : "Unsubscribe failed");
    }
  }

  async function handleDeleteSub(id: number) {
    await api.deletePushSubscription(id);
    await loadSubs();
  }

  async function handleTest() {
    setTestState("sending");
    setTestMsg(null);
    try {
      const { sent, removed } = await api.testPush();
      setTestState("done");
      setTestMsg(`Sent to ${sent} device${sent !== 1 ? "s" : ""}${removed > 0 ? `, removed ${removed} expired` : ""}.`);
    } catch (err) {
      setTestState("error");
      setTestMsg(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTimeout(() => { setTestState("idle"); setTestMsg(null); }, 4000);
    }
  }

  if (isIOSNotInstalled()) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-2">
        <h3 className="text-sm font-semibold text-gray-700">Push Notifications</h3>
        <p className="text-xs text-gray-500">
          On iPhone/iPad, web push only works after installing this page as an app:
        </p>
        <ol className="text-xs text-gray-500 list-decimal pl-4 space-y-0.5">
          <li>Tap the Share button in Safari</li>
          <li>Choose <span className="font-medium">Add to Home Screen</span></li>
          <li>Open the installed app, return here, and tap Subscribe</li>
        </ol>
      </div>
    );
  }

  if (!supported) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-2">
        <h3 className="text-sm font-semibold text-gray-700">Push Notifications</h3>
        <p className="text-xs text-gray-400">
          Push notifications require HTTPS and a compatible browser. Not supported in this context.
        </p>
      </div>
    );
  }

  const permission = Notification.permission;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-700">Push Notifications</h3>
        <p className="text-xs text-gray-400 mt-0.5">
          Receive alerts on your iPhone (install to Home Screen) or desktop. Works alongside Discord.
        </p>
      </div>

      {/* This device */}
      <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-800">This device</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {thisDeviceSubbed
              ? "Subscribed — you'll receive alerts here."
              : permission === "denied"
              ? "Notifications blocked. Allow in browser/OS settings."
              : "Not subscribed."}
          </p>
          {pushMsg && (
            <p
              className={`text-xs mt-1 ${
                pushState === "error" ? "text-red-600" : "text-green-600"
              }`}
            >
              {pushMsg}
            </p>
          )}
        </div>
        {permission !== "denied" && (
          <button
            onClick={thisDeviceSubbed ? handleUnsubscribeThis : handleSubscribeThis}
            disabled={pushState === "loading"}
            className={`shrink-0 text-sm rounded-lg px-3 py-1.5 font-medium disabled:opacity-50 transition-colors ${
              thisDeviceSubbed
                ? "border border-gray-300 text-gray-700 hover:bg-gray-100"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {pushState === "loading"
              ? "…"
              : thisDeviceSubbed
              ? "Unsubscribe"
              : "Subscribe this device"}
          </button>
        )}
      </div>

      {/* Subscribed devices list */}
      {subscriptions.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1.5">
            All subscribed devices ({subscriptions.length})
          </p>
          <div className="border border-gray-100 rounded-lg divide-y divide-gray-100 overflow-hidden">
            {subscriptions.map((sub) => (
              <div key={sub.id} className="flex items-center justify-between px-3 py-2">
                <div>
                  <p className="text-sm text-gray-800">{sub.deviceName}</p>
                  <p className="text-xs text-gray-400">Subscribed {fmtDate(sub.createdAt)}</p>
                </div>
                <button
                  onClick={() => handleDeleteSub(sub.id)}
                  className="text-xs text-red-400 hover:text-red-600"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Test button */}
      {subscriptions.length > 0 && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleTest}
            disabled={testState === "sending"}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
          >
            {testState === "sending" ? "Sending…" : "Send test notification"}
          </button>
          {testMsg && (
            <p className={`text-xs ${testState === "error" ? "text-red-600" : "text-gray-500"}`}>
              {testMsg}
            </p>
          )}
        </div>
      )}

      {subscriptions.length === 0 && (
        <p className="text-xs text-gray-400">No devices subscribed yet.</p>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [form, setForm] = useState({ pageTitle: "", headline: "" });
  const [webhookForm, setWebhookForm] = useState({ label: "", url: "" });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [webhookError, setWebhookError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [addingWebhook, setAddingWebhook] = useState(false);
  const [testingWebhookId, setTestingWebhookId] = useState<number | null>(null);
  const [webhookTestMsg, setWebhookTestMsg] = useState<Record<number, string>>({});
  const [allTest, setAllTest] = useState<{ state: "idle" | "sending" | "done" | "error"; msg: string }>({
    state: "idle",
    msg: "",
  });

  const load = useCallback(async () => {
    try {
      const [{ settings }, { webhooks }] = await Promise.all([
        api.adminSettings(),
        api.listWebhooks(),
      ]);
      setSettings(settings);
      setForm({ pageTitle: settings.pageTitle, headline: settings.headline });
      setWebhooks(webhooks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.updateSettings({ pageTitle: form.pageTitle, headline: form.headline });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleAuto() {
    if (!settings) return;
    const next = !settings.autoIncidents;
    setSettings({ ...settings, autoIncidents: next });
    try {
      await api.updateSettings({ autoIncidents: next });
    } catch {
      setSettings({ ...settings, autoIncidents: !next }); // revert on failure
    }
  }

  async function handleAddWebhook(e: React.FormEvent) {
    e.preventDefault();
    setAddingWebhook(true);
    setWebhookError(null);
    try {
      await api.addWebhook(webhookForm.label, webhookForm.url);
      setWebhookForm({ label: "", url: "" });
      await load();
    } catch (err) {
      setWebhookError(err instanceof Error ? err.message : "Failed");
    } finally {
      setAddingWebhook(false);
    }
  }

  async function handleDeleteWebhook(id: number) {
    if (!confirm("Remove this webhook?")) return;
    await api.deleteWebhook(id);
    await load();
  }

  async function handleTestWebhook(id: number) {
    setTestingWebhookId(id);
    setWebhookTestMsg((m) => ({ ...m, [id]: "" }));
    try {
      await api.testWebhook(id);
      setWebhookTestMsg((m) => ({ ...m, [id]: "Sent — check Discord ✓" }));
    } catch (e) {
      setWebhookTestMsg((m) => ({ ...m, [id]: e instanceof Error ? e.message : "Failed" }));
    } finally {
      setTestingWebhookId(null);
      setTimeout(() => setWebhookTestMsg((m) => ({ ...m, [id]: "" })), 5000);
    }
  }

  async function handleTestAll() {
    setAllTest({ state: "sending", msg: "" });
    try {
      const r = await api.testAllChannels();
      setAllTest({
        state: "done",
        msg: `Sent to ${r.webhooks} webhook${r.webhooks !== 1 ? "s" : ""} + ${r.pushSent} device${
          r.pushSent !== 1 ? "s" : ""
        }${r.pushRemoved > 0 ? `, removed ${r.pushRemoved} dead` : ""}.`,
      });
    } catch (e) {
      setAllTest({ state: "error", msg: e instanceof Error ? e.message : "Failed" });
    } finally {
      setTimeout(() => setAllTest({ state: "idle", msg: "" }), 6000);
    }
  }

  if (!settings) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="space-y-6 max-w-lg">
      <h2 className="font-semibold text-gray-900">Settings</h2>

      {/* Page */}
      <form onSubmit={handleSave} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold text-gray-700">Page</h3>
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">Page title</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.pageTitle}
            onChange={(e) => setForm((f) => ({ ...f, pageTitle: e.target.value }))}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">Headline</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.headline}
            onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value }))}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          {saved ? "Saved!" : loading ? "Saving…" : "Save"}
        </button>
      </form>

      {/* Auto-incidents */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">Automatic incidents</h3>
            <p className="text-xs text-gray-400 mt-0.5 max-w-sm">
              When monitors go down, automatically open one public incident with a shareable link,
              group further outages into it, and resolve it when everything recovers. Replaces noisy
              per-monitor Discord alerts with a single grouped announcement.
            </p>
          </div>
          <button
            type="button"
            onClick={handleToggleAuto}
            aria-pressed={settings.autoIncidents}
            className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              settings.autoIncidents ? "bg-blue-600" : "bg-gray-300"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                settings.autoIncidents ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Push notifications */}
      <PushSection />

      {/* Discord webhooks */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Discord Webhooks</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Rich embeds for incidents (grouped when auto-incidents is on) and manual incident
            updates, with a link back to the live incident page.
          </p>
        </div>

        {webhooks.length > 0 && (
          <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
            {webhooks.map((wh) => (
              <div key={wh.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{wh.label}</p>
                  <p className="text-xs text-gray-400 truncate">{wh.url}</p>
                  {webhookTestMsg[wh.id] && (
                    <p
                      className={`text-xs mt-0.5 ${
                        webhookTestMsg[wh.id]?.startsWith("Sent") ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {webhookTestMsg[wh.id]}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleTestWebhook(wh.id)}
                  disabled={testingWebhookId === wh.id}
                  className="shrink-0 text-xs text-blue-500 hover:text-blue-700 disabled:opacity-50"
                >
                  {testingWebhookId === wh.id ? "Sending…" : "Test"}
                </button>
                <button
                  onClick={() => handleDeleteWebhook(wh.id)}
                  className="shrink-0 text-xs text-red-400 hover:text-red-600"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {webhooks.length === 0 && (
          <p className="text-sm text-gray-400">No webhooks configured.</p>
        )}

        <form onSubmit={handleAddWebhook} className="space-y-2 pt-1">
          <div className="flex gap-2">
            <input
              className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Label"
              value={webhookForm.label}
              onChange={(e) => setWebhookForm((f) => ({ ...f, label: e.target.value }))}
            />
            <input
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="https://discord.com/api/webhooks/…"
              value={webhookForm.url}
              onChange={(e) => setWebhookForm((f) => ({ ...f, url: e.target.value }))}
              type="url"
            />
          </div>
          {webhookError && <p className="text-sm text-red-600">{webhookError}</p>}
          <button
            type="submit"
            disabled={addingWebhook || !webhookForm.label.trim() || !webhookForm.url.trim()}
            className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 font-medium"
          >
            {addingWebhook ? "Adding…" : "+ Add webhook"}
          </button>
        </form>
      </div>

      {/* Diagnostics — fire a real sample across every channel at once */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Diagnostics</h3>
          <p className="text-xs text-gray-400 mt-0.5 max-w-sm">
            Sends a sample grouped outage announcement to every Discord webhook and every subscribed
            push device — the exact path a real auto-incident uses. Use the per-webhook “Test” above,
            or “Send test notification” in Push Notifications, to check channels in isolation.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleTestAll}
            disabled={allTest.state === "sending"}
            className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 font-medium"
          >
            {allTest.state === "sending" ? "Sending…" : "Send test to all channels"}
          </button>
          {allTest.msg && (
            <p className={`text-xs ${allTest.state === "error" ? "text-red-600" : "text-gray-500"}`}>
              {allTest.msg}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
