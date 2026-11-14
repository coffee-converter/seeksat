import { useMemo } from "react";
import { splitTrack, minuteTicks, labelSpot } from "@/lib/live/dome.mjs";
import { clockFormat } from "@/lib/clock.mjs";

/**
 * A compass seen from above: N up, E right, as when holding a phone flat.
 * Rings mark 0, 30 and 60 degrees of elevation; the centre is straight up.
 * With a phone heading, the dial turns so its top is where the phone points:
 * every point, tick and label goes through point() with the same turn.
 */
const R = 100;
const TICK = 3.5;
const RINGS = [30, 60];

type AzEl = { azDeg: number; elDeg: number };
type Tick = AzEl & { tMs: number; before: AzEl; after: AzEl };
const split = splitTrack as (s: Sample[], nowMs: number) => { flown: AzEl[]; ahead: AzEl[] };
const ticksOf = minuteTicks as (s: Sample[]) => Tick[];
const spotOf = labelSpot as (x: number, y: number, r: number, dx: number, dy: number) => { x: number; y: number; anchor: "start" | "middle" | "end" };
const clockOf = clockFormat as (locale: string | undefined, timeZone: string | undefined) => Intl.DateTimeFormat;

function point(azDeg: number, elDeg: number, rotDeg: number): [number, number] {
  const r = (R * (90 - Math.max(0, Math.min(90, elDeg)))) / 90;
  const a = ((azDeg - rotDeg) * Math.PI) / 180;
  return [r * Math.sin(a), -r * Math.cos(a)];
}

type Sample = AzEl & { tMs: number };
type Mark = Sample & { before: AzEl; after: AzEl };
/** Samples either side of a label's point for the track's direction there. */
const SIDE = 5;

interface Props {
  track: Sample[];
  now: AzEl | null;
  nowMs: number;
  headingDeg: number | null;
  timeZone?: string;
}

export default function LiveDial({ track, now, nowMs, headingDeg, timeZone }: Props) {
  const rot = headingDeg ?? 0;
  const pts = (list: AzEl[]) => list.map((s) => point(s.azDeg, s.elDeg, rot).map((v) => v.toFixed(1)).join(",")).join(" ");
  const { flown, ahead } = split(track, nowMs);
  const ticks = useMemo(() => ticksOf(track), [track]);
  // The peak and the set, labelled with their times; the set only when the
  // track reaches the horizon (a long pass can be cut short). The ring
  // labels sit opposite the peak, where the track is least likely to be.
  const { marks, ringAz } = useMemo(() => {
    if (track.length < 2) return { marks: [] as Mark[], ringAz: 135 };
    let iPeak = 0;
    track.forEach((s, i) => { if (s.elDeg > track[iPeak].elDeg) iPeak = i; });
    const iLast = track.length - 1;
    // Each label knows which way the track runs there, to step off it.
    const mark = (i: number): Mark => ({
      ...track[i], before: track[Math.max(0, i - SIDE)], after: track[Math.min(iLast, i + SIDE)],
    });
    const out: Mark[] = [];
    // The rise too, when the track starts at the horizon.
    if (track[0].elDeg < 1 && iPeak !== 0) out.push(mark(0));
    if (iPeak !== 0 && iPeak !== iLast) out.push(mark(iPeak));
    if (track[iLast].elDeg < 1) out.push(mark(iLast));
    return { marks: out, ringAz: (track[iPeak].azDeg + 180) % 360 };
  }, [track]);
  const clock = clockOf(undefined, timeZone);
  const p = now ? point(now.azDeg, now.elDeg, rot) : null;
  const card = (label: string, az: number) => {
    // Just outside the horizon ring.
    const a = ((az - rot) * Math.PI) / 180;
    const [x, y] = [(R + 12) * Math.sin(a), -(R + 12) * Math.cos(a)];
    return <text key={label} x={x} y={y + 4} textAnchor="middle" className="live-dial__card">{label}</text>;
  };
  return (
    <figure className="live-dial">
      <svg viewBox="-122 -122 244 244" role="img" aria-label={now
        ? `Satellite at azimuth ${Math.round(now.azDeg)} degrees, ${Math.round(now.elDeg)} degrees up`
        : "This pass is over"}>
        <circle r={R} className="live-dial__horizon" />
        {RINGS.map((el) => <circle key={el} r={(R * (90 - el)) / 90} className="live-dial__ring" />)}
        {headingDeg != null && <line x1={0} y1={0} x2={0} y2={-R} className="live-dial__ahead" />}
        {card("N", 0)}{card("E", 90)}{card("S", 180)}{card("W", 270)}
        {RINGS.map((el) => {
          const [x, y] = point(ringAz, el, rot);
          return <text key={el} x={x} y={y + 4} textAnchor="middle" className="live-dial__label live-dial__label--ring">{`${el}°`}</text>;
        })}
        {flown.length > 1 && <polyline points={pts(flown)} className="live-dial__track live-dial__track--flown" />}
        {ahead.length > 1 && <polyline points={pts(ahead)} className="live-dial__track" />}
        {ticks.map((t) => {
          const [x, y] = point(t.azDeg, t.elDeg, rot);
          const [ax, ay] = point(t.before.azDeg, t.before.elDeg, rot);
          const [bx, by] = point(t.after.azDeg, t.after.elDeg, rot);
          const len = Math.hypot(bx - ax, by - ay) || 1;
          // Across the track: the direction of travel turned a quarter.
          const nx = (-(by - ay) / len) * TICK, ny = ((bx - ax) / len) * TICK;
          return (
            <line
              key={t.tMs}
              x1={x - nx} y1={y - ny} x2={x + nx} y2={y + ny}
              className={t.tMs <= nowMs ? "live-dial__tick live-dial__tick--flown" : "live-dial__tick"}
            />
          );
        })}
        {marks.map((m) => {
          const [x, y] = point(m.azDeg, m.elDeg, rot);
          const [ax, ay] = point(m.before.azDeg, m.before.elDeg, rot);
          const [bx, by] = point(m.after.azDeg, m.after.elDeg, rot);
          const at = spotOf(x, y, R, bx - ax, by - ay);
          // A dot on the point the time names, so it is plain which it is.
          return (
            <g key={m.tMs}>
              <circle cx={x} cy={y} r={2.6} className="live-dial__mark-dot" />
              {/* In the dial's own units (it scales with the dial), smaller than the ring labels. */}
              <text x={at.x} y={at.y + 3} textAnchor={at.anchor} style={{ fontSize: 8.5 }} className="live-dial__label live-dial__label--time num">
                {clock.format(m.tMs)}
              </text>
            </g>
          );
        })}
        {p && <line x1={0} y1={0} x2={p[0]} y2={p[1]} className="live-dial__arrow" />}
        {p && (
          <g transform={`translate(${p[0].toFixed(1)} ${p[1].toFixed(1)})`}>
            <circle r={6} className="live-dial__pulse" />
            <circle r={6} className="live-dial__sat" />
          </g>
        )}
      </svg>
      <figcaption className="live-dial__caption">
        {headingDeg != null ? "Compass view (turned to where your phone points)" : "Compass view (north up)"}
      </figcaption>
    </figure>
  );
}
