"use client";

// The pass card's path strip and radio panel, shared by the home cards and the
// satellite page's pass rows.

import { useMemo } from "react";
import { defaultDownlink } from "@/lib/catalog.mjs";
import { dopplerHzAt, passPath } from "@/lib/passes/pass-words.mjs";
import { formatPassDuration } from "@/lib/passes/format.mjs";
import Surface from "@/components/ui/Surface";
import { passTime as cardTime } from "@/components/passes/PassStats";

type Pass = {
  startMs: number; endMs: number; peakMs: number; inProgress?: boolean; msAbove10?: number | null;
  startAzDeg?: number | null; peakAzDeg?: number | null; endAzDeg?: number | null;
};
type Track = { ecefAt: (d: Date) => number[] | null; downlinks: ReadonlyArray<unknown> };
type Observer = { latDeg: number; lonDeg: number; elevM?: number; tz?: string };
const duration = (ms: number) => (formatPassDuration as (s: number) => string)(ms / 1000);

/** "9m ≥ 10°", under Lasts on a radio card: short enough for a phone's
 *  column. Null when the pass never gets that high. */
export function aboveTenText(pass: Pass): string | null {
  if (!pass.msAbove10) return null;
  const min = Math.round(pass.msAbove10 / 60_000);
  return `${min >= 1 ? `${min}m` : duration(pass.msAbove10)} \u2265 10°`;
}

type PathStep = { key: string; label: string; dir: string; ms: number };
const pathOf = passPath as (pass: Pass, o: { mode: string; minElevDeg: number }) => PathStep[];

// Each step sits under its stat column: rise under Starts, peak under Max,
// set under Lasts, so the strip lines up on every card even when a step is left out.
const COLUMN: Record<string, number> = { start: 1, peak: 2, end: 3 };

/** Where the pass goes, under the stat columns: "Rises N / 4:51 AM". */
export function PassPath({ pass, mode, minElevDeg, timeZone, className }: {
  pass: Pass; mode: string; minElevDeg: number; timeZone?: string; className?: string;
}) {
  const steps = pathOf(pass, { mode, minElevDeg });
  return (
    <dl className={className ? `pass-path ${className}` : "pass-path"}>
      {steps.map((st) => (
        <div key={st.key} className="pass-path__step" style={{ gridColumn: COLUMN[st.key] }}>
          <dt>{st.label} <span className="pass-path__dir">{st.dir}</span></dt>
          <dd className="num">{cardTime(st.ms, timeZone)}</dd>
        </div>
      ))}
    </dl>
  );
}

const khz = (hz: number) => {
  const k = Math.abs(hz / 1000).toFixed(1);
  return `${hz < 0 && k !== "0.0" ? "\u2212" : "+"}${k}`;
};
const mhz = (hz: number) => (hz / 1e6).toFixed(3);
type Uplink = { hz: number; highHz?: number; mode?: string; tone?: number; invert?: boolean };
type Link = { hz: number; mode?: string | null; uplink?: Uplink };
const linkOf = defaultDownlink as (track: Track) => Link | null;

/** Radio mode: what to listen on and transmit on for this pass. The Doppler
 *  runs from rise (or now, for a pass already up) to set; the live view has
 *  the moment-by-moment figures. */
export function RadioPanel({ track, observer, pass, nowMs, banded }: {
  track: Track; observer: Observer; pass: Pass; nowMs: number; banded: boolean;
}) {
  const link = linkOf(track);
  const swing = useMemo(() => {
    if (!link) return null;
    const from = dopplerHzAt(track, observer, pass.inProgress ? Math.max(nowMs, pass.startMs) : pass.startMs, link.hz);
    const to = dopplerHzAt(track, observer, pass.endMs - 1000, link.hz);
    return from == null || to == null ? null : `${khz(from)} \u2192 ${khz(to)} kHz`;
  // nowMs only matters for a pass already up; minute steps are plenty.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, track, observer, pass, pass.inProgress ? Math.floor(nowMs / 60_000) : 0]);
  if (!link) {
    return (
      <Surface padded="sm" className="pass-card__radio">
        <p className="pass-card__radio-none">{banded ? "No known downlink in your bands" : "No known downlink"}</p>
      </Surface>
    );
  }
  const up = link.uplink;
  const upNote = up ? [up.tone != null ? `${up.tone.toFixed(1)} Hz tone` : null, up.invert ? "inverting" : null].filter(Boolean).join(", ") : "";
  return (
    <Surface padded="sm" className="pass-card__radio">
      <dl className="radio-rows">
        <dt>Listen</dt>
        <dd className="radio-rows__freq num">{`${mhz(link.hz)}${link.mode ? ` ${link.mode.toUpperCase()}` : ""}`}</dd>
        <dd className="radio-rows__note num">{swing ?? ""}</dd>
        {up && (
          <>
            <dt>Transmit</dt>
            <dd className="radio-rows__freq num">{`${up.highHz ? `${mhz(up.hz)}\u2013${(up.highHz / 1e6).toFixed(3).slice(-3)}` : mhz(up.hz)}${up.mode ? ` ${up.mode.toUpperCase()}` : ""}`}</dd>
            <dd className="radio-rows__note">{upNote}</dd>
          </>
        )}
      </dl>
    </Surface>
  );
}

