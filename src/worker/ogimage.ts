import satori, { init as initSatori } from "satori/standalone";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { createElement as h } from "react";
// Statically imported wasm -> pre-compiled WebAssembly.Module (works on Workers,
// unlike fetching bytes and compiling them at runtime, which the runtime blocks).
import yogaWasm from "satori/yoga.wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";

export type OgStatus = "operational" | "partial_outage" | "major_outage" | "maintenance";

const STATUS = {
  operational:   { emoji: "✅", label: "ALL SYSTEMS OPERATIONAL", color: "#22c55e", bg: "rgba(34,197,94,0.15)",  border: "rgba(34,197,94,0.3)"  },
  partial_outage:{ emoji: "⚠️", label: "PARTIAL OUTAGE",          color: "#f59e0b", bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.3)" },
  major_outage:  { emoji: "🔴", label: "MAJOR OUTAGE",            color: "#ef4444", bg: "rgba(239,68,68,0.15)",  border: "rgba(239,68,68,0.3)"  },
  maintenance:   { emoji: "🔧", label: "MAINTENANCE",             color: "#cbd5e1", bg: "rgba(148,163,184,0.18)", border: "rgba(148,163,184,0.35)" },
};

let bootPromise: Promise<void> | null = null;
let fontReg: ArrayBuffer;
let fontBold: ArrayBuffer;

// Static TTFs (satori/opentype can't parse woff2; TTF needs no decompression).
const FONT_REGULAR = "https://cdn.jsdelivr.net/gh/googlefonts/roboto@main/src/hinted/Roboto-Regular.ttf";
const FONT_BOLD = "https://cdn.jsdelivr.net/gh/googlefonts/roboto@main/src/hinted/Roboto-Bold.ttf";

// Memoized so concurrent requests on a cold isolate init the wasm exactly once
// (initWasm/init throw if called twice). Errors here are swallowed because a
// double-init just means it's already ready; real failures surface at render.
async function doBoot() {
  const [, , regBuf, boldBuf] = await Promise.all([
    Promise.resolve(initSatori(yogaWasm)).catch(() => {}),
    Promise.resolve(initWasm(resvgWasm)).catch(() => {}),
    fetch(FONT_REGULAR).then((r) => r.arrayBuffer()),
    fetch(FONT_BOLD).then((r) => r.arrayBuffer()),
  ]);
  fontReg = regBuf;
  fontBold = boldBuf;
}

function boot() {
  if (!bootPromise) bootPromise = doBoot();
  return bootPromise;
}

// Deterministic dot positions for the starfield background
const DOTS = Array.from({ length: 55 }, (_, i) => ({
  x: `${((i * 37 + 13) * 19) % 100}%`,
  y: `${((i * 53 + 7) * 23) % 100}%`,
  size: i % 5 === 0 ? 3 : 2,
  opacity: 0.15 + (i % 4) * 0.08,
}));

export async function generateOgImage(status: OgStatus, title: string, subtitle: string): Promise<Uint8Array> {
  await boot();
  const cfg = STATUS[status];

  const dot = ({ x, y, size, opacity }: typeof DOTS[number]) =>
    h("div", {
      style: {
        position: "absolute",
        left: x,
        top: y,
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "50%",
        background: `rgba(255,255,255,${opacity})`,
      },
    });

  const element = h(
    "div",
    {
      style: {
        display: "flex",
        width: "100%",
        height: "100%",
        background: "#0a0910",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
        fontFamily: "Roboto",
      },
    },
    // Starfield layer (needs display:flex — satori requires it on multi-child
    // nodes; the dots are position:absolute so flow layout is irrelevant).
    h("div", { style: { display: "flex", position: "absolute", inset: "0" } }, ...DOTS.map(dot)),
    // Subtle vignette gradient overlay
    h("div", {
      style: {
        position: "absolute",
        inset: "0",
        background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.6) 100%)",
      },
    }),
    // Main content
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "40px",
          padding: "0 60px",
        },
      },
      // Status badge
      h(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: "18px",
            background: cfg.bg,
            border: `1px solid ${cfg.border}`,
            borderRadius: "999px",
            padding: "22px 52px",
          },
        },
        // Colored status dot (emoji fonts aren't available to satori).
        h("div", { style: { width: "26px", height: "26px", borderRadius: "50%", background: cfg.color } }),
        h(
          "span",
          {
            style: {
              fontSize: "36px",
              fontWeight: 600,
              color: cfg.color,
              letterSpacing: "0.08em",
            },
          },
          cfg.label,
        ),
      ),
      // Title
      h(
        "div",
        {
          style: {
            fontSize: "140px",
            fontWeight: 700,
            color: "#ffffff",
            textAlign: "center",
            lineHeight: 1.02,
            maxWidth: "1100px",
          },
        },
        title,
      ),
      // Subtitle
      subtitle
        ? h(
            "div",
            {
              style: {
                fontSize: "48px",
                fontWeight: 400,
                color: "rgba(255,255,255,0.45)",
                textAlign: "center",
                maxWidth: "1040px",
              },
            },
            subtitle,
          )
        : null,
    ),
  );

  const svg = await satori(element, {
    width: 1200,
    height: 630,
    fonts: [
      { name: "Roboto", data: fontReg,  weight: 400, style: "normal" },
      { name: "Roboto", data: fontBold, weight: 700, style: "normal" },
    ],
  });

  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } });
  return resvg.render().asPng();
}
