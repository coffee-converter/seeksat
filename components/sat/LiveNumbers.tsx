"use client";

import { useEffect, useState, type ReactNode } from "react";
import { dashboardValues, formatNumber } from "@/lib/sat/numbers.mjs";
import { useFlash } from "@/lib/ui/use-flash";
import StatTile from "./StatTile";
import type { SatPageData } from "./SatApp";

export type Live = NonNullable<SatPageData["live"]>;
export type Elements = NonNullable<SatPageData["elements"]>;
type Tile = { key: string; label: string; value: string; unit: string; note: string };
const tilesOf = dashboardValues as (live: unknown, elements: unknown) => Tile[];

export function isoUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19) + "Z";
}

function Flashing({ value, className }: { value: string; className: string }) {
  const flash = useFlash(value);
  return <span className={flash ? `${className} ${flash}` : className}>{value}</span>;
}

/** "v²r/GM 1.0012 vs 2 − r/a 1.0010, within 0.02%", with the numbers large. */
export function VisVivaTile({ live }: { live: Live }) {
  const a = formatNumber(live.v2rOverGM, 4);
  const b = formatNumber(live.visViva, 4);
  const diff = (Math.abs(live.v2rOverGM - live.visViva) / Math.abs(live.visViva)) * 100;
  // Enough digits that a close match never reads "0.00%".
  const pct = diff < 0.001 ? "under 0.001" : formatNumber(diff, diff >= 1 ? 1 : diff >= 0.1 ? 2 : 3);
  return (
    <div className="stat-tile stat-tile--wide">
      <span className="stat-tile__label">Vis-viva check</span>
      <span className="stat-tile__value vis-viva">
        <span className="vis-viva__keep">
          <span className="vis-viva__term">v²r/GM </span>
          <Flashing className="stat-tile__num" value={a} />
        </span>
        {" "}
        <span className="vis-viva__keep">
          <span className="vis-viva__term">vs 2 − r/a </span>
          <Flashing className="stat-tile__num" value={b} />
          <span className="vis-viva__term">,</span>
        </span>
        {" "}
        <span className="vis-viva__keep">
          <span className="vis-viva__term">within </span>
          <Flashing className="stat-tile__num vis-viva__pct" value={`${pct}%`} />
        </span>
      </span>
      <span className="stat-tile__note">live speed and distance against the mean semi-major axis</span>
    </div>
  );
}

/**
 * The live tile grid: the seven live numbers, then the vis-viva check
 * across the remaining width. The next pass is the line under the title.
 */
export default function DashboardTiles({ live, elements }: { live: Live; elements: Elements }) {
  const tiles = tilesOf(live, elements);
  return (
    <section className="sat-dash" aria-label="Right now">
      {tiles.map((t) => (
        <StatTile
          key={t.key}
          className={`sat-dash__${t.key}`}
          label={t.label}
          value={t.value}
          unit={t.unit}
          note={t.note}
        />
      ))}
      <VisVivaTile live={live} />
    </section>
  );
}

const PHONE_QUERY = "(max-width: 599.98px)";

/**
 * The tiles under a "Live numbers" fold: closed by default on phones (under
 * 600 px), always open wider, where the summary is hidden (app/sat.css).
 * It starts closed, so a phone never flashes the tiles; wider, CSS shows
 * the content before the effect opens it.
 */
export function LiveNumbersFold({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const sync = () => setOpen(!mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return (
    <details className="sat-live" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="sat-live__summary">Live numbers</summary>
      {children}
    </details>
  );
}
