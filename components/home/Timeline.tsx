"use client";

import { useMemo } from "react";
import { TIMELINE_HOURS } from "@/lib/home/next-up.mjs";
import { barSpan, hourTicks, nightSpans, stripLanes, timelineRows } from "@/lib/home/timeline.mjs";
import { passKey } from "@/lib/home/pass-list.mjs";
import { passTime } from "@/components/passes/PassStats";
import { passQuality } from "@/lib/passes/quality.mjs";
import type { CloudBadge } from "@/lib/sky/cloud-badge.mjs";
import { peakMagText, ratingText, visualRating } from "@/components/passes/QualityBadge";
import type { Card, HomeObserver, Pass, Track } from "./NextUpList";

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
  /** The sky type for the visual rating (prefs `skyType`). */
  skyType: string;
}

type Span = { x0: number; x1: number };
type Tick = { x: number; label: string; dayLabel: string | null };
type Quality = { level: "good" | "ok" | "low"; label: string };

const rowsOf = timelineRows as (cards: Card[], nowMs: number) => Array<{ noradId: number; name: string; passes: Pass[] }>;
const lanesOf = stripLanes as (spans: Span[], minW: number) => { lanes: number[]; count: number };
const keyOf = passKey as (noradId: number, pass: Pass) => string;
const spanOf = barSpan as (pass: Pass, nowMs: number, hours: number) => Span | null;
/** A tick this close to either end is pinned inward rather than centred, so
 *  its label never hangs past the strip. */
const EDGE = 0.03;
const ticksOf = hourTicks as (nowMs: number, timeZone: string | undefined, o: { every: number; hours: number }) => Tick[];
const nightOf = nightSpans as (observer: HomeObserver, nowMs: number, o: { hours: number }) => Span[];
const qualityOf = passQuality as (pass: Pass) => Quality;

const HOURS = TIMELINE_HOURS as number;
const W = 1000;
const H = 18;
/** The narrowest a bar is drawn, as a share of the strip (8 px of the
 *  panel's strip, with a little room): overlap is judged at this width. */
const MIN_BAR = 0.03;

// "Next 24 hours", the desktop pass panel's strip (hidden under 1100 px by
// app/home.css): every followed satellite's passes on one 16 px track, with
// night shaded, tick labels under it, and a bar per pass that opens its card.
// Passes that overlap in time go to lanes stacked down the strip, so no bar
// covers another.
export default function Timeline({ cards, tracks, colors, observer, mode, nowMs, onOpenPass, cloudFor, skyType }: Props) {
  // The layout moves once a minute; a second is far below a pixel.
  const windowMs = Math.floor(nowMs / 60_000) * 60_000;
  const { latDeg: lat, lonDeg: lon, tz } = observer;
  const night = useMemo(
    () => nightOf({ latDeg: lat, lonDeg: lon } as HomeObserver, windowMs, { hours: HOURS }),
    [lat, lon, windowMs],
  );
  const ticks = useMemo(() => ticksOf(windowMs, tz, { every: 3, hours: HOURS }), [windowMs, tz]);
  const { items, laneCount } = useMemo(() => {
    const list = rowsOf(cards, windowMs)
      .filter((row) => tracks.has(row.noradId))
      .flatMap((row) => row.passes.map((pass) => ({ row, pass, span: spanOf(pass, windowMs, HOURS) })))
      .filter((it): it is { row: typeof it.row; pass: Pass; span: Span } => it.span != null);
    const { lanes, count } = lanesOf(list.map((it) => it.span), MIN_BAR);
    return { items: list.map((it, i) => ({ ...it, lane: lanes[i] })), laneCount: count };
  }, [cards, windowMs, tracks]);

  if (items.length === 0) return null;
  const visual = mode === "visual";
  const clouds = visual ? cloudFor : undefined;
  const colorOf = (id: number) => colors.get(id) ?? "var(--map-muted)";

  const bars = items.map(({ row, pass, span, lane }) => {
    const cloud = clouds?.(pass) ?? null;
    const q = visual ? visualRating(pass, { skyType, cloud }) : qualityOf(pass);
    const mag = visual ? peakMagText(pass) : null;
    const from = pass.riseUnknown ? "up now" : passTime(pass.riseMs ?? pass.startMs, tz);
    const label = `${row.name}, ${from} to ${passTime(pass.endMs, tz)}, `
      + `max ${Math.round(pass.maxElevDeg)}°, ${ratingText(q, pass, visual)}${cloud ? `, ${cloud.label}` : ""}${mag ? `, ${mag}` : ""}`;
    return (
      <button
        // The row's key: it stays put across card refreshes, so focus
        // survives (and a chart opened from it can return it).
        key={keyOf(row.noradId, pass)}
        type="button"
        className={`timeline__bar timeline__bar--${q.level}${cloud?.level === "cloudy" ? " timeline__bar--cloudy" : ""}`}
        style={{
          "--mid": (span.x0 + span.x1) / 2,
          "--w": span.x1 - span.x0,
          "--sat-color": colorOf(row.noradId),
          "--lane": lane,
        } as React.CSSProperties}
        aria-label={label}
        title={label}
        onClick={(e) => onOpenPass(row.noradId, pass, e)}
      />
    );
  });
  return (
    <section className="timeline" aria-label="Next 24 hours">
      <div className="timeline__strip" style={{ "--lanes": laneCount, "--lane-h": laneCount > 1 ? "11px" : "16px" } as React.CSSProperties}>
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
        {bars}
      </div>
      <div className="timeline__axis" aria-hidden="true">
        <div className="timeline__ticks">
          {ticks.map((t) => (
            <span
              key={t.x}
              className={`timeline__tick${t.dayLabel ? " timeline__day" : ""}${t.x < EDGE ? " timeline__tick--start" : t.x > 1 - EDGE ? " timeline__tick--end" : ""}`}
              style={{ "--x": t.x } as React.CSSProperties}
            >
              {t.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
