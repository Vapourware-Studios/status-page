// Site footer. Statch is licensed under the GNU GPLv3; the copyright line and
// licence link below are the "Appropriate Legal Notices" GPL asks an interactive
// interface to surface. The brand name and nav links are yours to change.

const VERSION = "1.0.0";

export function Footer({ siteName = "Statch" }: { siteName?: string }) {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-white/10 bg-black/20">
      <div className="max-w-3xl mx-auto px-6 py-10 flex flex-wrap justify-between gap-8 items-start">
        <div>
          <div className="text-lg font-bold mb-4 text-white">{siteName}</div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-500">
            <a href="/" className="hover:text-gray-300 transition-colors">Status</a>
            <a href="/docs" className="hover:text-gray-300 transition-colors">Docs</a>
            <a href="/admin" className="hover:text-gray-300 transition-colors">Admin</a>
            <a href="/rss.xml" className="hover:text-gray-300 transition-colors">RSS</a>
          </div>
        </div>

        <div className="text-right text-sm text-gray-600">
          <p className="mb-1.5">
            © {year}{" "}
            <a
              href="https://chank.dev"
              target="_blank"
              rel="noreferrer"
              className="text-gray-400 hover:text-gray-200 transition-colors"
            >
              Mr_chank
            </a>
          </p>
          <p className="mb-1.5 text-gray-600">
            Built with{" "}
            <a
              href="https://github.com/Vapourware-Studios/status-page"
              target="_blank"
              rel="noreferrer"
              className="text-gray-400 hover:text-gray-200 transition-colors"
            >
              Statch
            </a>{" "}
            ·{" "}
            <a
              href="https://www.gnu.org/licenses/gpl-3.0.html"
              target="_blank"
              rel="noreferrer"
              className="text-gray-500 hover:text-gray-300 transition-colors"
            >
              GPLv3
            </a>
          </p>
          <p className="text-gray-700">v{VERSION} · no warranty</p>
        </div>
      </div>
    </footer>
  );
}
