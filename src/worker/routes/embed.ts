import type { Context } from "hono";
import type { Env } from "../types";

// Serves /embed.js — a tiny, dependency-free script any external site can drop
// in with a single <script> tag. It renders a live status badge that links back
// to this status page (or straight to the open incident, if there is one).
//
//   <script src="https://status.example.com/embed.js" async></script>
//
// The script discovers its own origin from its src, so there is nothing to
// configure. Optional attributes: data-theme="light|dark", data-compact.
export function handleEmbed(c: Context<{ Bindings: Env }>): Response {
  return new Response(EMBED_SCRIPT, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

const EMBED_SCRIPT = `(function () {
  "use strict";
  var script =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName("script");
      for (var i = all.length - 1; i >= 0; i--) {
        if (all[i].src && all[i].src.indexOf("/embed.js") !== -1) return all[i];
      }
      return null;
    })();
  if (!script || !script.parentNode) return;

  var base = script.src.replace(/\\/embed\\.js.*$/, "");
  var theme = (script.getAttribute("data-theme") || "dark").toLowerCase();
  var compact = script.hasAttribute("data-compact");
  var dark = theme !== "light";

  var colors = {
    operational: "#22c55e",
    maintenance: "#3b82f6",
    partial_outage: "#f59e0b",
    major_outage: "#ef4444",
    unknown: "#9ca3af"
  };

  var box = document.createElement("a");
  box.target = "_blank";
  box.rel = "noopener noreferrer";
  box.href = base;
  box.style.cssText =
    "display:inline-flex;align-items:center;gap:10px;box-sizing:border-box;" +
    "text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" +
    "font-size:14px;line-height:1.3;padding:10px 14px;border-radius:10px;border:1px solid " +
    (dark ? "#2a2740" : "#e5e7eb") + ";background:" + (dark ? "#1a1825" : "#ffffff") +
    ";color:" + (dark ? "#e5e7eb" : "#111827") + ";max-width:360px;";

  var dot = document.createElement("span");
  dot.style.cssText = "flex:0 0 auto;width:10px;height:10px;border-radius:50%;background:" + colors.unknown + ";";

  var textWrap = document.createElement("span");
  textWrap.style.cssText = "display:flex;flex-direction:column;min-width:0;";

  var line1 = document.createElement("span");
  line1.style.cssText = "font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
  line1.textContent = "Loading status\\u2026";

  var line2 = document.createElement("span");
  line2.style.cssText =
    "font-size:12px;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;display:none;";

  textWrap.appendChild(line1);
  textWrap.appendChild(line2);
  box.appendChild(dot);
  box.appendChild(textWrap);
  script.parentNode.insertBefore(box, script.nextSibling);

  function fmtTime(ms) {
    try {
      return new Date(ms).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
      });
    } catch (e) { return ""; }
  }

  function render(d) {
    var status = d.status || "unknown";
    var color = colors[status] || colors.unknown;
    dot.style.background = color;
    line1.style.color = color;
    line1.textContent = d.description || "Status";

    // Click target: the open issue page if there is one, otherwise the main page.
    if (d.incidents && d.incidents.length) box.href = d.incidents[0].url || d.url || base;
    else box.href = d.url || base;

    var detail = "";
    if (d.incidents && d.incidents.length) {
      var inc = d.incidents[0];
      detail = inc.title;
      if (inc.affected && inc.affected.length) detail += " \\u00b7 " + inc.affected.join(", ");
      detail += " \\u00b7 since " + fmtTime(inc.startedAt);
    } else if (d.affected && d.affected.length) {
      detail = "Affected: " + d.affected.map(function (a) { return a.name; }).join(", ");
    }

    if (detail && !compact) {
      line2.textContent = detail;
      line2.style.display = "";
    } else {
      line2.style.display = "none";
    }
  }

  function load() {
    fetch(base + "/api/v1/summary", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () {
        line1.textContent = "Status unavailable";
        line1.style.color = colors.unknown;
        dot.style.background = colors.unknown;
        line2.style.display = "none";
      });
  }

  load();
  setInterval(load, 60000);
})();
`;
