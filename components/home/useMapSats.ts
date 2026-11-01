// components/home/useMapSats.ts - turn focus layers and tracks into the
// FlatMap's MapSat list. Shared by the home and satellite pages.
import { useMemo } from "react";
import type { Emphasis, MapSat } from "./FlatMap";
import { footprintFeature, splitTrack, subpoint } from "@/lib/map/geometry.mjs";
import { SAT_PALETTE } from "@/lib/map/draw.mjs";

export interface Layer {
  noradId: number;
  emphasis: Emphasis;
}
/** The parts of a Track (lib/sat/track.mjs) the map uses. */
export interface MapTrack {
  shortName: string;
  orbitClass: string;
  ecefAt: (d: Date) => number[] | null;
}
type Shape = MapSat["trackPast"];
type Split = Pick<MapSat, "trackPast" | "trackFuture" | "trackTicks">;
export type Sub = { latDeg: number; lonDeg: number; altKm: number };

const subOf = subpoint as (ecef: number[]) => Sub;
const footprintOf = footprintFeature as (sub: Sub, altKm: number, minElevDeg: number) => Shape;
const splitOf = splitTrack as (track: unknown, nowMs: number) => { past: Shape; future: Shape; ticks: MapSat["trackTicks"] };
const NO_LINE: Shape = { type: "MultiLineString", coordinates: [] };
const NO_TRACK: Split = { trackPast: NO_LINE, trackFuture: NO_LINE, trackTicks: [] };

const TRACK_REFRESH_MS = 60_000;

export function useMapSats({
  layers, tracks, colors, nowMs, minElevDeg,
}: {
  layers: Layer[];
  tracks: ReadonlyMap<number, MapTrack>;
  colors: ReadonlyMap<number, string>;
  nowMs: number | null;
  minElevDeg: number;
}): { sats: MapSat[]; focusSub: Sub | null } {
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
        const s = splitOf(t, trackMinute * TRACK_REFRESH_MS);
        out.set(id, { trackPast: s.past, trackFuture: s.future, trackTicks: s.ticks });
      } catch {
        // a track that cannot be sampled is drawn as a dot only
      }
    }
    return out;
  }, [tracks, tracked, trackMinute]);

  // Positions every second.
  return useMemo(() => {
    const sats: MapSat[] = [];
    let focusSub: Sub | null = null;
    if (nowMs == null) return { sats, focusSub };
    const at = new Date(nowMs);
    for (const { noradId, emphasis } of layers) {
      if (emphasis === "hidden") continue;
      const t = tracks.get(noradId);
      const ecef = t?.ecefAt(at);
      if (!t || !ecef) continue;
      const sub = subOf(ecef);
      const focus = emphasis === "focus";
      if (focus) focusSub = sub;
      sats.push({
        noradId,
        name: t.shortName,
        color: colors.get(noradId) ?? SAT_PALETTE[0],
        ...(ground.get(noradId) ?? NO_TRACK),
        position: { lonDeg: sub.lonDeg, latDeg: sub.latDeg },
        footprint: focus ? footprintOf(sub, sub.altKm, minElevDeg) : null,
        selected: focus,
        emphasis,
        orbitClass: t.orbitClass,
      });
    }
    return { sats, focusSub };
  }, [nowMs, layers, tracks, ground, colors, minElevDeg]);
}
