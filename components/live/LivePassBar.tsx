import type { CSSProperties } from "react";
import { barPositions } from "@/lib/live/progress.mjs";
import { clockFormat } from "@/lib/clock.mjs";
import { otherClock, zoneAbbr } from "@/components/passes/PassStats";

const positions = barPositions as (o: { startMs: number; peakMs: number | null; endMs: number; nowMs: number }) => {
  nowFrac: number; peakFrac: number | null; peakLabelFrac: number | null;
};
const clockOf = clockFormat as (locale: string | undefined, timeZone: string | undefined) => Intl.DateTimeFormat;

interface Props {
  /** The bar's left end in time, and what it says: "Rise" with a time, or
   *  "Up" with none for a pass whose rise is unknown. */
  startMs: number;
  startLabel: string;
  startShownMs: number | null;
  peakMs: number | null;
  endMs: number;
  nowMs: number;
  timeZone?: string;
}

const pct = (f: number) => `${(f * 100).toFixed(2)}%`;

/** Rise, peak and set along a thin line, with a marker at now: the flown
 *  part dim, the part to come bright. */
export default function LivePassBar({ startMs, startLabel, startShownMs, peakMs, endMs, nowMs, timeZone }: Props) {
  const { nowFrac, peakFrac, peakLabelFrac } = positions({ startMs, peakMs, endMs, nowMs });
  const clock = clockOf(undefined, timeZone);
  // The zone, when the place's clock differs from the viewer's, only on the
  // last time: on all three the labels ran into each other.
  const mark = (label: string, ms: number | null, zoned = false) => (
    <>
      <span className="live-bar__label">{label}</span>
      {ms != null && <span className="live-bar__time num">{zoned && otherClock(ms, timeZone) ? `${clock.format(ms)} ${zoneAbbr(ms, timeZone!)}` : clock.format(ms)}</span>}
    </>
  );
  return (
    <div className="live-bar" style={{ "--now": pct(nowFrac) } as CSSProperties}>
      <div className="live-bar__line" aria-hidden="true">
        {peakFrac != null && <span className="live-bar__tick" style={{ left: pct(peakFrac) }} />}
        <span className="live-bar__now" />
      </div>
      <ol className="live-bar__marks" aria-label="Pass times">
        <li className="live-bar__mark live-bar__mark--start">{mark(startLabel, startShownMs)}</li>
        {peakLabelFrac != null && peakMs != null && (
          <li className="live-bar__mark live-bar__mark--peak" style={{ left: pct(peakLabelFrac) }}>{mark("Peak", peakMs)}</li>
        )}
        <li className="live-bar__mark live-bar__mark--end">{mark("Set", endMs, true)}</li>
      </ol>
    </div>
  );
}
