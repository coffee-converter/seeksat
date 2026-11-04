"use client";

import { useEffect, useState, type ReactNode } from "react";
import { dashboardValues, formatNumber } from "@/lib/sat/numbers.mjs";
import { useFlash } from "@/lib/ui/use-flash";
import StatTile from "@/components/ui/StatTile";
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

/**
 * "Orbit check": a sentence saying how closely the live speed and distance fit
 * the orbit, then the vis-viva formulas set as code. It sits with the
 * technical sections rather than the live tiles, as a check for those who
 * want it.
 */
export function OrbitCheck({ live }: { live: Live }) {
  const a = formatNumber(live.v2rOverGM, 4);
  const b = formatNumber(live.visViva, 4);
  const diff = (Math.abs(live.v2rOverGM - live.visViva) / Math.abs(live.visViva)) * 100;
  // Enough digits that a close match never reads "0.00%".
  const within = diff < 0.001 ? "better than 0.001%" : `within ${formatNumber(diff, diff >= 1 ? 1 : diff >= 0.1 ? 2 : 3)}%`;
  return (
    <section className="sat-orbit-check" aria-labelledby="sat-orbit-check-title">
      <h2 id="sat-orbit-check-title" className="home-heading">Orbit check</h2>
      <p className="sat-orbit-check__lead">
        The live speed and distance fit this orbit to{" "}
        <Flashing className="sat-orbit-check__pct num" value={within} />.
      </p>
      <p className="sat-orbit-check__math">
        Vis-viva: <code className="sat-formula">v²r/GM = <Flashing className="" value={a} /></code>
        {" "}and <code className="sat-formula">2 − r/a = <Flashing className="" value={b} /></code>
      </p>
    </section>
  );
}

/**
 * The live tile grid: the seven live numbers. The next pass is the line
 * under the title; the vis-viva check is the Orbit check section.
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
