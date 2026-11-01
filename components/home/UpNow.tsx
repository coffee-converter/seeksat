"use client";

import { useMemo } from "react";
import { upNow, compassName } from "@/lib/sky/up-now.mjs";
import type { HomeObserver, Track } from "./NextUpList";

interface Props {
  tracks: ReadonlyMap<number, Track>;
  observer: HomeObserver;
  colors: ReadonlyMap<number, string>;
  nowMs: number;
  focusId: number | null;
}

const R = 70;
const C = 90;
const point = (azDeg: number, elDeg: number) => {
  const r = (R * (90 - elDeg)) / 90;
  const a = (azDeg * Math.PI) / 180;
  return { x: C + r * Math.sin(a), y: C - r * Math.cos(a) };
};

// Live SGP4 positions for your location, recomputed from the page clock.
export default function UpNow({ tracks, observer, colors, nowMs, focusId }: Props) {
  const up = useMemo(
    () => upNow({ tracks, observer, nowMs, colors }) as Array<{
      noradId: number; name: string; azDeg: number; elDeg: number; rising: boolean; color?: string;
    }>,
    [tracks, observer, nowMs, colors],
  );
  return (
    <section className="up-now" aria-labelledby="up-now-h">
      <h2 id="up-now-h" className="up-now__title">Up now</h2>
      <div className="up-now__body">
        <svg className="up-now__sky" viewBox="0 0 180 180" role="img" aria-label="Sky view, north up, east right">
          <circle cx={C} cy={C} r={R} className="up-now__horizon" />
          <circle cx={C} cy={C} r={(R * 60) / 90} className="up-now__ring" />
          <circle cx={C} cy={C} r={(R * 30) / 90} className="up-now__ring" />
          <text x={C} y={12} className="up-now__dir" textAnchor="middle">N</text>
          <text x={C} y={176} className="up-now__dir" textAnchor="middle">S</text>
          <text x={174} y={C + 4} className="up-now__dir" textAnchor="middle">E</text>
          <text x={6} y={C + 4} className="up-now__dir" textAnchor="middle">W</text>
          {up.map((s) => {
            const p = point(s.azDeg, s.elDeg);
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
        {up.length === 0 ? (
          <p className="up-now__none">Nothing you follow is above the horizon right now.</p>
        ) : (
          <ul className="up-now__list">
            {up.map((s) => (
              <li key={s.noradId} className="up-now__item">
                <span className="up-now__swatch" style={{ background: s.color ?? "var(--accent)" }} aria-hidden="true" />
                {`${s.name} ${Math.round(s.elDeg)}° up, ${compassName(s.azDeg)}, ${s.rising ? "rising" : "setting"}`}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
