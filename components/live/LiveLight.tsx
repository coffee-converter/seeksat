import { useMemo } from "react";
import Surface from "@/components/ui/Surface";
import { lightTimeline, lightAt } from "@/lib/live/light.mjs";
import { clockText } from "@/lib/live/live-state.mjs";
import { formatMag } from "@/lib/sky/visual-rating.mjs";

type LightPoint = { tMs: number; lit: number; mag: number | null };
type Observer = { latDeg: number; lonDeg: number; elevM?: number };
type TrackLike = { ecefAt: (d: Date) => number[] | null; standardMag: number | null };
const timelineOf = lightTimeline as (track: TrackLike, obs: Observer, startMs: number, endMs: number) => LightPoint[];
const lightNow = lightAt as (tl: LightPoint[], nowMs: number) => { lit: boolean; mag: number | null; msToShadow: number | null } | null;
const clock = clockText as (ms: number) => string;
const mag = formatMag as (m: number) => string;

interface Props {
  track: TrackLike;
  obs: Observer;
  /** The pass from rise to set. */
  startMs: number;
  endMs: number;
  nowMs: number;
  phase: "before" | "during" | "after";
}

/** Visual mode's panel in place of the radio one: how bright the satellite
 *  is now, whether it is sunlit or in Earth's shadow, and when it fades. */
export default function LiveLight({ track, obs, startMs, endMs, nowMs, phase }: Props) {
  // Worked out once for the pass (2 s steps), read each tick.
  const timeline = useMemo(() => timelineOf(track, obs, startMs, endMs), [track, obs, startMs, endMs]);
  const now = phase === "during" ? lightNow(timeline, nowMs) : null;
  return (
    <Surface as="section" className="live-view__panel" aria-label="Brightness">
      {phase === "before" ? (
        <p className="note">Brightness shows once it rises.</p>
      ) : phase === "after" || !now ? (
        <p className="note">The pass has set.</p>
      ) : (
        <>
          <p className="live-view__tune">
            <span className="live-view__tune-label">{now.lit ? "Brightness" : "Now"}</span>
            <span className="live-view__tune-mhz num">
              {!now.lit ? "In Earth's shadow" : now.mag != null ? `mag ${mag(now.mag)}` : "Sunlit"}
            </span>
          </p>
          <p className="live-view__doppler num">
            {now.lit ? "Sunlit" : "Not lit by the Sun, so it can't be seen."}
            {now.msToShadow != null && ` · Fades into shadow in ${clock(now.msToShadow)}`}
          </p>
          {now.lit && now.mag == null && <p className="note">{"This satellite's brightness isn't known."}</p>}
          {now.lit && now.mag != null && <p className="note">Lower is brighter. Predicted, for a clear sky.</p>}
        </>
      )}
    </Surface>
  );
}
