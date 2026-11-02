"use client";

import { useMemo } from "react";
import { TIMELINE_HOURS } from "@/lib/home/next-up.mjs";
import { barSpan, hourTicks, nightSpans, timelineRows } from "@/lib/home/timeline.mjs";
import { passQuality } from "@/lib/passes/quality.mjs";
import type { Card, HomeObserver, Pass, Track } from "./NextUpList";

/** The cloud badge Task 4's `cloudFor` gives for a pass. */
export interface CloudBadge {
  level: "clear" | "some" | "cloudy";
  label: string;
  title?: string;
}

interface Props {
  cards: Card[];
  tracks: ReadonlyMap<number, Track>;
  colors: ReadonlyMap<number, string>;
  observer: HomeObserver;
  mode: "radio" | "visual";
  nowMs: number;
  onOpenPass: (noradId: number, pass: Pass, e: React.MouseEvent<HTMLButtonElement>) => void;
  /** The cloud badge for a pass, or null; used in visual mode only. */
  cloudFor?: (pass: Pass) => CloudBadge | null;
}

type Span = { x0: number; x1: number };
type Tick = { x: number; label: string; dayLabel: string | null };
type Quality = { level: "good" | "ok" | "low"; label: string };

const rowsOf = timelineRows as (cards: Card[], nowMs: number) => {
  rows: Array<{ noradId: number; name: string; passes: Pass[] }>;
  leftOut: number;
};
const spanOf = barSpan as (pass: Pass, nowMs: number, hours: number) => Span | null;
const ticksOf = hourTicks as (nowMs: number, timeZone: string | undefined, o: { every: number; hours: number }) => Tick[];
const nightOf = nightSpans as (observer: HomeObserver, nowMs: number, o: { hours: number }) => Span[];
const qualityOf = passQuality as (pass: Pass) => Quality;

const HOURS = TIMELINE_HOURS as number;
const W = 1000;
const H = 18;

function clockFormat(timeZone: string | undefined): Intl.DateTimeFormat {
  const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23", numberingSystem: "latn" };
  try {
    return new Intl.DateTimeFormat(undefined, { ...opts, timeZone });
  } catch {
    return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: "UTC" });
  }
}

const othersLine = (n: number) => (n === 1
  ? "1 other has no pass in the next 24 hours."
  : `${n} others have no pass in the next 24 hours.`);

// "Next 24 hours": every followed satellite's passes on one strip, with
// night shaded and a bar per pass that opens its sky chart.
export default function Timeline({ cards, tracks, colors, observer, mode, nowMs, onOpenPass, cloudFor }: Props) {
  // The layout moves once a minute; a second is far below a pixel.
  const windowMs = Math.floor(nowMs / 60_000) * 60_000;
  const { latDeg: lat, lonDeg: lon, tz } = observer;
  const night = useMemo(
    () => nightOf({ latDeg: lat, lonDeg: lon } as HomeObserver, windowMs, { hours: HOURS }),
    [lat, lon, windowMs],
  );
  const ticks = useMemo(() => ticksOf(windowMs, tz, { every: 3, hours: HOURS }), [windowMs, tz]);
  const clock = useMemo(() => clockFormat(tz), [tz]);
  const { rows, leftOut } = useMemo(() => {
    const r = rowsOf(cards, windowMs);
    return { rows: r.rows.filter((row) => tracks.has(row.noradId)), leftOut: r.leftOut };
  }, [cards, windowMs, tracks]);

  if (rows.length === 0) return null;
  const clouds = mode === "visual" ? cloudFor : undefined;

  return (
    <section className="timeline" aria-labelledby="timeline-title">
      <h2 id="timeline-title" className="home-heading">Next 24 hours</h2>
      <ul className="timeline__rows">
        {rows.map((row) => {
          const color = colors.get(row.noradId) ?? "var(--map-muted)";
          return (
            <li key={row.noradId} className="timeline__row" style={{ "--sat-color": color } as React.CSSProperties}>
              <span className="timeline__name" title={row.name}>
                <span className="timeline__swatch" aria-hidden="true" />
                <span className="timeline__name-text">{row.name}</span>
              </span>
              <div className="timeline__strip">
                <svg className="timeline__svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
                  {night.map((s) => (
                    <rect key={s.x0} className="timeline__night" x={s.x0 * W} y={0} width={(s.x1 - s.x0) * W} height={H} />
                  ))}
                  {ticks.map((t) => (
                    <line
                      key={t.x}
                      className={t.dayLabel ? "timeline__grid timeline__grid--day" : "timeline__grid"}
                      x1={t.x * W} x2={t.x * W} y1={0} y2={H}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </svg>
                {row.passes.map((pass) => {
                  const span = spanOf(pass, windowMs, HOURS);
                  if (!span) return null;
                  const q = qualityOf(pass);
                  const cloud = clouds?.(pass) ?? null;
                  const label = `${row.name}, ${clock.format(pass.startMs)} to ${clock.format(pass.endMs)}, `
                    + `max ${Math.round(pass.maxElevDeg)}°, ${q.label}${cloud ? `, ${cloud.label}` : ""}`;
                  return (
                    <button
                      key={pass.startMs}
                      type="button"
                      className={`timeline__bar timeline__bar--${q.level}${cloud?.level === "cloudy" ? " timeline__bar--cloudy" : ""}`}
                      style={{ "--mid": (span.x0 + span.x1) / 2, "--w": span.x1 - span.x0 } as React.CSSProperties}
                      aria-label={label}
                      title={label}
                      onClick={(e) => onOpenPass(row.noradId, pass, e)}
                    />
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="timeline__axis" aria-hidden="true">
        <div className="timeline__ticks">
          {ticks.map((t) => (
            <span key={t.x} className="timeline__tick" style={{ "--x": t.x } as React.CSSProperties}>
              {t.label}
              {t.dayLabel && <span className="timeline__day">{t.dayLabel}</span>}
            </span>
          ))}
        </div>
      </div>
      {leftOut > 0 && <p className="timeline__note">{othersLine(leftOut)}</p>}
    </section>
  );
}
