"use client";

import { useMemo } from "react";
import { upNow, upNowPoint, compassName } from "@/lib/sky/up-now.mjs";
import type { HomeObserver, Track } from "./NextUpList";
import { defaultDownlink } from "@/lib/catalog.mjs";
import { dopplerHzAt } from "@/lib/passes/pass-words.mjs";

interface Props {
  tracks: ReadonlyMap<number, Track>;
  observer: HomeObserver;
  colors: ReadonlyMap<number, string>;
  nowMs: number;
  focusId: number | null;
  /** Radio mode: each satellite's main downlink, corrected for Doppler now. */
  radio?: boolean;
}

const R = 70;
const C = 90;
// Live SGP4 positions for your location, recomputed from the page clock.
// Hidden while nothing is up: the Next strip and the first card already say
// what comes next.
const linkOf = defaultDownlink as (t: Track) => { hz: number; mode?: string | null } | null;
const shiftAt = dopplerHzAt as (t: Track, o: HomeObserver, ms: number, hz: number) => number | null;

/** "listen 437.809 FM": where to tune right now, or null without a downlink. */
function listenNow(track: Track | undefined, observer: HomeObserver, nowMs: number): string | null {
  const link = track && linkOf(track);
  if (!track || !link) return null;
  const shift = shiftAt(track, observer, nowMs, link.hz);
  return `listen ${((link.hz + (shift ?? 0)) / 1e6).toFixed(3)}${link.mode ? ` ${link.mode.toUpperCase()}` : ""}`;
}

export default function UpNow({ tracks, observer, colors, nowMs, focusId, radio = false }: Props) {
  const up = useMemo(
    () => upNow({ tracks, observer, nowMs, colors }) as Array<{
      noradId: number; name: string; azDeg: number; elDeg: number; rising: boolean | null; color?: string;
    }>,
    [tracks, observer, nowMs, colors],
  );
  if (up.length === 0) return null;
  return (
    <section className="up-now" aria-labelledby="up-now-h">
      <h2 id="up-now-h" className="up-now__title">Up now</h2>
      <div className="up-now__body">
        <svg className="up-now__sky" viewBox="0 0 180 180" role="img" aria-label="Sky view, north up, east left">
          <circle cx={C} cy={C} r={R} className="up-now__horizon" />
          <circle cx={C} cy={C} r={(R * 60) / 90} className="up-now__ring" />
          <circle cx={C} cy={C} r={(R * 30) / 90} className="up-now__ring" />
          <text x={C} y={12} className="up-now__dir" textAnchor="middle">N</text>
          <text x={C} y={176} className="up-now__dir" textAnchor="middle">S</text>
          <text x={6} y={C + 4} className="up-now__dir" textAnchor="middle">E</text>
          <text x={174} y={C + 4} className="up-now__dir" textAnchor="middle">W</text>
          {up.map((s) => {
            const p = upNowPoint(s.azDeg, s.elDeg, 180);
            return (
              <circle
                key={s.noradId}
                cx={p.x}
                cy={p.y}
                r={s.noradId === focusId ? 6 : 4.5}
                fill={s.color ?? "var(--accent)"}
                className="up-now__dot"
              >
                <title>{s.name}</title>
              </circle>
            );
          })}
        </svg>
        <ul className="up-now__list num">
          {up.map((s) => (
            <li key={s.noradId} className="up-now__item">
              <span className="up-now__swatch" style={{ background: s.color ?? "var(--accent)" }} aria-hidden="true" />
              {`${s.name} ${Math.round(s.elDeg)}° up, ${compassName(s.azDeg)}${s.rising == null ? "" : s.rising ? ", rising" : ", setting"}`}
              {radio && (() => {
                const tune = listenNow(tracks.get(s.noradId), observer, nowMs);
                return tune ? <span className="up-now__tune">{` · ${tune}`}</span> : null;
              })()}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
