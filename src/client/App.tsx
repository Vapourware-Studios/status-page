import { StatusPage } from "./pages/StatusPage";
import { AdminApp } from "./pages/admin/AdminApp";
import { IncidentDetailPage } from "./pages/IncidentDetailPage";
import { MonitorDetailPage } from "./pages/MonitorDetailPage";
import { DocsPage } from "./pages/DocsPage";

export function App() {
  const path = window.location.pathname;

  if (path.startsWith("/admin")) return <AdminApp />;
  if (path === "/docs") return <DocsPage />;

  const incidentMatch = path.match(/^\/incidents\/(\d+)$/);
  if (incidentMatch) {
    return <IncidentDetailPage incidentId={parseInt(incidentMatch[1]!, 10)} />;
  }

  const monitorMatch = path.match(/^\/monitors\/([^/]+)$/);
  if (monitorMatch) {
    return <MonitorDetailPage monitorId={decodeURIComponent(monitorMatch[1]!)} />;
  }

  return <StatusPage />;
}
