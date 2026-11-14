// components/home/useMapSats.ts - turn focus layers and tracks into the
// FlatMap's MapSat list. Shared by the home and satellite pages.
import { useMemo } from "react";
import type { Emphasis, MapSat } from "./FlatMap";
import { footprintFeature, footprintRadiusDeg, passLine, splitTrack, subpoint, trackTicks, tickStepMin } from "@/lib/map/geometry.mjs";
import { SAT_PALETTES } from "@/lib/map/palette.mjs";
import { geometricElevFor, splitBySun } from "@/lib/map/pass-arc.mjs";

export interface Layer {
  noradId: number;
  emphasis: Emphasis;
}
/** The parts of a Track (lib/sat/track.mjs) the map uses. */
export interface MapTrack {
  shortName: string;
  orbitClass: string;
  periodMs: number;
  ecefAt: (d: Date) => number[] | null;
  /** Known radio downlinks (lib/catalog.mjs downlinksFor). */
  downlinks: ReadonlyArray<unknown>;
}
type Shape = MapSat["trackPast"];
type Split = Pick<MapSat, "trackPast" | "trackFuture" | "trackTicks" | "ticksAt">;
export type Sub = { latDeg: number; lonDeg: number; altKm: number };

const subOf = subpoint as (ecef: number[]) => Sub;
const footprintOf = footprintFeature as (sub: Sub, altKm: number, minElevDeg: number) => Shape;
const splitOf = splitTrack as (track: unknown, nowMs: number) => { past: Shape; future: Shape; ticks: MapSat["trackTicks"] };
type TimedLine = { type: string; coordinates: number[][][]; times: number[][] };
const passLineOf = passLine as (track: unknown, startMs: number, endMs: number) => TimedLine;
const splitSun = splitBySun as (line: TimedLine, ecefAt: (d: Date) => number[] | null) => { sunlit: Shape; shadow: Shape };
const ticksOf = trackTicks as (track: unknown, nowMs: number, lineFromMs: number) => MapSat["trackTicks"];
const NO_LINE: Shape = { type: "MultiLineString", coordinates: [] };
const NO_TRACK: Split = { trackPast: NO_LINE, trackFuture: NO_LINE, trackTicks: [] };

const TRACK_REFRESH_MS = 60_000;
/** Past this radius (a satellite above about 5,000 km) the visibility circle
 *  covers so much of the Earth that it wraps round the globe and says
 *  nothing; it is left out and the map frames the pass path instead. */
const MAX_RING_DEG = 40;

/** An opened pass row: its whole arc is drawn on the map (lib/map/pass-arc.mjs). */
export interface MapPass {
  noradId: number;
  /** Rise and set above the lowest pass setting. */
  startMs: number;
  endMs: number;
  /** The closest approach (highest point). */
  peakMs: number;
  /** The visibility circle around the observer, as a closed [lon, lat] line. */
  ring?: number[][] | null;
  /** With a lowest pass setting above 0: the horizon's circle, drawn faint. */
  ringHorizon?: number[][] | null;
  /** The map is paused at peakMs: the satellite's own circle and track ticks go. */
  paused?: boolean;
  /** "5:41 PM" and "5:48 PM", in the place's zone, for the rise and set marks. */
  riseLabel?: string;
  setLabel?: string;
}

export function useMapSats({
  layers, tracks, colors, nowMs, minElevDeg, radio, pass = null, liveId = null,
}: {
  layers: Layer[];
  tracks: ReadonlyMap<number, MapTrack>;
  colors: ReadonlyMap<number, string>;
  nowMs: number | null;
  minElevDeg: number;
  /** Radio mode: dots with known downlinks get the radio mark. */
  radio: boolean;
  /** The opened pass, drawn bold with a sight line to its highest point. */
  pass?: MapPass | null;
  /** The satellite a live view is open on: it gets the live sight line even
   *  with no pass open (however the live view was opened). */
  liveId?: number | null;
}): { sats: MapSat[] } {
  // Ground tracks are the costly part: once a minute, and only for the
  // satellites that draw one (not ghosts or hidden ones).
  const trackMinute = nowMs == null ? null : Math.floor(nowMs / TRACK_REFRESH_MS);
  const tracked = layers
    .filter((l) => l.emphasis === "focus" || l.emphasis === "normal")
    .map((l) => l.noradId)
    .join(",");
  const ground = useMemo(() => {
    const out = new Map<number, Split>();
    if (trackMinute == null) return out;
    for (const id of tracked ? tracked.split(",").map(Number) : []) {
      const t = tracks.get(id);
      if (!t) continue;
      try {
        const from = trackMinute * TRACK_REFRESH_MS;
        // The line turns from dashed (flown) to solid (ahead) at the END of
        // this minute, past the dot; the map draws the solid piece from the
        // dot to there every frame (FlatMap drawLeads), so the change of
        // style always sits on the dot however far it has moved this minute.
        const at = from + TRACK_REFRESH_MS;
        const s = splitOf(t, at);
        out.set(id, {
          trackPast: s.past, trackFuture: s.future, trackTicks: ticksOf(t, from, at),
          // Ticks glide with the clock but stop where this line ends.
          ticksAt: (ms: number) => ticksOf(t, ms, at),
        });
      } catch {
        // a track that cannot be sampled is drawn as a dot only
      }
    }
    return out;
  }, [tracks, tracked, trackMinute]);

  // The opened pass's path, rise to set, and where it peaks.
  const passTrack = pass ? tracks.get(pass.noradId) : undefined;
  const passShape = useMemo(() => {
    if (!pass || !passTrack) return null;
    try {
      const path = passLineOf(passTrack, pass.startMs, pass.endMs);
      // Visual: solid in sunlight, dashed in Earth's shadow. Radio: sunlight
      // does not matter, so the whole pass is solid.
      const { sunlit, shadow } = radio
        ? { sunlit: path as Shape, shadow: null as unknown as Shape }
        : splitSun(path, passTrack.ecefAt);
      const first = path.coordinates[0]?.[0];
      const last = path.coordinates.at(-1)?.at(-1);
      const ends = [
        first && { lonDeg: first[0], latDeg: first[1], label: pass.riseLabel ?? "" },
        last && { lonDeg: last[0], latDeg: last[1], label: pass.setLabel ?? "" },
      ].filter(Boolean) as NonNullable<MapSat["passEnds"]>;
      const ecef = passTrack.ecefAt(new Date(pass.peakMs));
      const peak = ecef ? subOf(ecef) : null;
      // How far from the observer a satellite at the peak's height is above
      // the lowest pass setting: the visibility circle the map frames.
      // Its height where it rises and sets (where the circle meets the
      // path), and the horizon refraction allows, as the pass search uses.
      const endAlts = [pass.startMs, pass.endMs]
        .map((ms) => passTrack.ecefAt(new Date(ms)))
        .filter((e): e is number[] => e != null)
        .map((e) => subOf(e).altKm);
      const reachAlt = endAlts.length ? endAlts.reduce((a, b) => a + b, 0) / endAlts.length : peak?.altKm;
      const radius = reachAlt != null
        ? (footprintRadiusDeg as (altKm: number, minElevDeg: number) => number)(reachAlt, (geometricElevFor as (d: number) => number)(minElevDeg))
        : null;
      const reachDeg = radius != null && radius <= MAX_RING_DEG ? radius : null;
      return { noradId: pass.noradId, path: path as Shape, sunlit, shadow, ends, peak: peak && { lonDeg: peak.lonDeg, latDeg: peak.latDeg, altKm: peak.altKm }, reachDeg };
    } catch {
      return null;
    }
    // The pass by its times, not its object identity (rows rebuild each minute).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passTrack, pass?.noradId, pass?.startMs, pass?.endMs, pass?.peakMs, pass?.riseLabel, pass?.setLabel, minElevDeg, radio]);
  const pausedId = pass?.paused ? pass.noradId : null;

  // Positions every second.
  return useMemo(() => {
    const sats: MapSat[] = [];
    if (nowMs == null) return { sats };
    const at = new Date(nowMs);
    for (const { noradId, emphasis } of layers) {
      if (emphasis === "hidden") continue;
      const t = tracks.get(noradId);
      const ecef = t?.ecefAt(at);
      if (!t || !ecef) continue;
      const sub = subOf(ecef);
      const focus = emphasis === "focus";
      sats.push({
        noradId,
        name: t.shortName,
        color: colors.get(noradId) ?? SAT_PALETTES.dark[0],
        // Only satellites that draw a track get ticks; none while paused on
        // a pass (they would count from the paused time).
        ...(ground.get(noradId) ?? NO_TRACK),
        ...(pausedId === noradId && { trackTicks: [], ticksAt: undefined }),
        position: { lonDeg: sub.lonDeg, latDeg: sub.latDeg },
        altKm: sub.altKm,
        positionAt: (ms) => {
          const e = t.ecefAt(new Date(ms));
          return e ? subOf(e) : null;
        },
        // Paused on a pass, the visibility circle around you takes its place.
        footprint: focus && pausedId !== noradId ? footprintOf(sub, sub.altKm, minElevDeg) : null,
        selected: focus,
        emphasis,
        orbitClass: t.orbitClass,
        tickMin: tickStepMin(t.periodMs),
        radio: radio && t.downlinks.length > 0,
        ...(passShape?.noradId === noradId && {
          passPath: passShape.path,
          passSunlit: passShape.sunlit,
          passShadow: passShape.shadow,
          passEnds: passShape.ends,
          ...(pass?.ring && passShape.reachDeg != null && { passRing: pass.ring }),
          ...(pass?.ringHorizon && passShape.reachDeg != null && { passRingHorizon: pass.ringHorizon }),
          // Paused, the sight line runs to the closest approach; live, to
          // where it is now (drawn with the marks, while it is up).
          ...(pausedId === noradId && passShape.peak && { passPeak: passShape.peak }),
          ...(pausedId !== noradId && { passLive: true, ...(pass && nowMs >= pass.endMs && { passAfter: true }) }),
          ...(passShape.reachDeg != null && { passReachDeg: passShape.reachDeg }),
        }),
        ...(liveId === noradId && passShape?.noradId !== noradId && pausedId !== noradId && { passLive: true, sightOnly: true }),
      });
    }
    return { sats };
  }, [nowMs, layers, tracks, ground, colors, minElevDeg, radio, passShape, pausedId, pass?.ring, pass?.ringHorizon, liveId]);
}
