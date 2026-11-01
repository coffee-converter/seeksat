"use client";

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
  const pct = formatNumber(diff, diff >= 1 ? 1 : diff >= 0.1 ? 2 : 3);
  return (
    <div className="stat-tile stat-tile--wide">
      <span className="stat-tile__label">Vis-viva check</span>
      <span className="stat-tile__value vis-viva">
        <span className="vis-viva__term">v²r/GM </span>
        <Flashing className="stat-tile__num" value={a} />
        <span className="vis-viva__term"> vs 2 − r/a </span>
        <Flashing className="stat-tile__num" value={b} />
        <span className="vis-viva__keep">
          <span className="vis-viva__term">, within </span>
          <Flashing className="stat-tile__num vis-viva__pct" value={`${pct}%`} />
        </span>
      </span>
      <span className="stat-tile__note">live speed and distance against the mean semi-major axis</span>
    </div>
  );
}

export interface NextPassTile {
  value: string;
  note?: string;
}

/**
 * The live tile grid: the next pass, the seven live numbers, then the
 * vis-viva check across the remaining width.
 */
export default function DashboardTiles({
  live, elements, nextPass,
}: { live: Live; elements: Elements; nextPass: NextPassTile }) {
  const tiles = tilesOf(live, elements);
  return (
    <section className="sat-dash" aria-label="Right now">
      <StatTile
        className="sat-dash__next"
        size="lg"
        label="Next pass"
        value={nextPass.value}
        note={nextPass.note}
        href="#passes"
      />
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
