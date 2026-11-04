import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mapCssVars } from "@/lib/ui/map-tokens.mjs";
import { readTokenBlock } from "@/lib/ui/token-block.mjs";
import { SAT_PALETTES } from "@/lib/map/palette.mjs";
import { CANVAS_COLORS } from "@/lib/map/overlays.mjs";
import { basemapColors } from "@/lib/map/basemap.mjs";
import { POLAR_ARC_COLOR } from "@/lib/passes/charts.js";
import { EVENT_STYLE } from "@/lib/pass-finder/polar-events.js";
import { RADIO_ROLE_COLORS } from "@/lib/pass-finder/radio-chart.js";
import DesignBible, { type BibleData, type Cell, type ColorGroup, type Palette } from "./DesignBible";
import "./bible.css";

// The design bible: every token and every components/ui part, live. Unlisted:
// noindex here and in an X-Robots-Tag header (next.config.ts), absent from the
// sitemap and robots.txt, linked from nowhere.
export const metadata: Metadata = {
  title: "Design bible",
  robots: { index: false, follow: false },
};

// Built once: the token block is read from app/globals.css at build time.
export const dynamic = "force-static";

/** The token sets of app/globals.css (its theme-tokens:begin / theme-tokens:end
 *  region), read at build time. readTokenBlock throws if the block is missing
 *  or parses short, so the build fails rather than rendering a partial page. */
function tokenSets() {
  return readTokenBlock(readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8"));
}

type Vars = Record<string, string>;

function resolve(vars: Vars, value: string, depth = 0): string {
  if (depth > 10) return value;
  return value.replace(/var\((--[\w-]+)\)/g, (whole, name: string) => (name in vars ? resolve(vars, vars[name], depth + 1) : whole));
}

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\))$/i;

function cell(name: string, vars: Vars, own: Vars): Cell {
  const value = vars[name];
  const resolved = resolve(vars, value);
  const kind = name.endsWith("-rgb") ? "channels" : COLOR.test(resolved) ? "color" : /^--shadow-/.test(name) ? "shadow" : "other";
  return { value, resolved, kind, inherited: !(name in own) };
}

// Colour tokens, grouped by the job they do (first match wins).
const GROUPS: [string, RegExp][] = [
  ["Page, cards and text", /^--(bg|panel|popover|code-bg|border|ink|edge|text|muted|faint|wordmark|accent|link)/],
  ["Controls", /^--(primary|btn|seg|input|chip|tile|focus|flash)/],
  ["Status and ratings", /^--(ok|warn|danger|q\d|teal|badge)/],
  ["Elevation", /^--shadow/],
  ["Map and timeline", /^--(map|timeline)/],
  ["Dialogs", /^--modal/],
];

function bibleData(): BibleData {
  const sets = tokenSets();
  const darkOwn: Vars = Object.fromEntries(sets.dark);
  const lightOwn: Vars = Object.fromEntries(sets.light);
  const scale: [string, string][] = sets.scale;
  const scaleVars = Object.fromEntries(scale);
  const mapDark = mapCssVars("dark");
  const mapLight = mapCssVars("light");
  // The dark block also matches :root, so light inherits what it leaves out.
  const dark: Vars = { ...scaleVars, ...darkOwn, ...mapDark };
  const light: Vars = { ...dark, ...lightOwn, ...mapLight };

  const names = [...new Set([...Object.keys(darkOwn), ...Object.keys(lightOwn)])];
  const groups: ColorGroup[] = GROUPS.map(([title]) => ({ title, rows: [] }));
  const other: ColorGroup = { title: "Other", rows: [] };
  for (const name of names) {
    const i = GROUPS.findIndex(([, re]) => re.test(name));
    (i >= 0 ? groups[i] : other).rows.push({ name, source: "globals.css", dark: cell(name, dark, darkOwn), light: cell(name, light, lightOwn) });
  }
  const mapGroup = groups.find((g) => g.title === "Map and timeline")!;
  for (const name of Object.keys(mapDark)) {
    mapGroup.rows.push({ name, source: "map-tokens.mjs", dark: cell(name, dark, mapDark), light: cell(name, light, mapLight) });
  }

  const swatches = (o: Record<string, string | number>) => Object.entries(o).map(([name, value]) => ({ name, value: String(value) }));
  const palettes: Palette[] = [
    {
      title: "Satellite colours",
      source: "lib/map/palette.mjs SAT_PALETTES",
      note: "One hue per slot in both themes; slot 7 is the neutral.",
      columns: (["dark", "light"] as const).map((t) => ({ label: t === "dark" ? "Dark" : "Light", swatches: SAT_PALETTES[t].map((value: string, i: number) => ({ name: `${i + 1}`, value })) })),
    },
    {
      title: "Map overlays",
      source: "lib/map/overlays.mjs CANVAS_COLORS",
      columns: (["dark", "light"] as const).map((t) => ({ label: t === "dark" ? "Dark" : "Light", swatches: swatches(CANVAS_COLORS[t]) })),
    },
    {
      title: "Basemap",
      source: "lib/map/basemap.mjs basemapColors()",
      columns: (["dark", "light"] as const).map((t) => ({ label: t === "dark" ? "Dark" : "Light", swatches: swatches(basemapColors(t)) })),
    },
    {
      title: "Chart colours",
      source: "lib/passes/charts.js, lib/pass-finder/polar-events.js, lib/pass-finder/radio-chart.js",
      note: "The charts are always dark, so one set serves both themes.",
      columns: [
        { label: "Sky chart", swatches: [{ name: "arc", value: POLAR_ARC_COLOR }, ...EVENT_STYLE.map((e: { label: string; color: string }) => ({ name: e.label.toLowerCase(), value: e.color }))] },
        { label: "Radio chart", swatches: swatches(RADIO_ROLE_COLORS) },
      ],
    },
  ];

  return {
    colors: [...groups, other].filter((g) => g.rows.length),
    scale: scale.map(([name, value]) => ({ name, value })),
    reducedMotion: sets.reducedMotion.map(([name, value]: [string, string]) => ({ name, value })),
    nightFilter: Object.fromEntries(sets.night)["--night-filter"] ?? "",
    palettes,
  };
}

export default function DesignPage() {
  return <DesignBible data={bibleData()} />;
}
