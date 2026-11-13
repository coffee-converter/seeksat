"use client";

import { useCallback, useEffect, useRef, useState } from "react";
// Types only: the library itself loads in an effect, in its own chunk.
import type { CustomLayerInterface, LayerSpecification, Map as MlMap, MapMouseEvent, MapTouchEvent, Marker, StyleSpecification } from "maplibre-gl";
import { legendItems } from "@/lib/map/legend.mjs";
import { basemapStyle } from "@/lib/map/basemap.mjs";
import { altText, awayText, overlayColors, overlayData, overlayImages, overlayLayers, sightFeatures as sightFeaturesOf, sightFrom } from "@/lib/map/overlays.mjs";
import { addOverlays as addOverlaysTo, setOverlayData } from "@/lib/map/maplibre-overlays.mjs";
import { footprintFeature, footprintRadiusDeg, greatCircle as greatCircleOf, trackDetailFor } from "@/lib/map/geometry.mjs";
import { sightPathD } from "@/lib/map/sight-path.mjs";
import { edgeCrossings, gridCovers, labelSteps, viewGrid } from "@/lib/map/grid.mjs";
import { createFootprintLayer, drawsGlobeCap } from "@/lib/map/footprint-layer.mjs";
import { MAX_ZOOM, nightRefreshMs, homeCamera, homeCentresFocus as homeCentresFocusOf, minZoomFor, presetCamera, easeZoom as easeZoomOf } from "@/lib/map/view.mjs";
import { mapNow, useMapClock } from "@/lib/map/map-clock";
import { useUnits } from "@/lib/ui/use-units";
import { currentUnits } from "@/lib/units.mjs";
import { canvasMismatch } from "@/lib/map/canvas-check.mjs";
import { reportNotice } from "@/lib/site/report.mjs";
import { useFollow } from "@/lib/map/follow-store";
import { peekPendingCamera, registerCameraReader, setPendingCamera } from "@/lib/map/share-camera";
import Button from "@/components/ui/Button";
import MapLayers from "@/components/map/MapLayers";
import Icon from "@/components/ui/Icon";

// Minimal GeoJSON shapes; the geometry helpers produce these.
type GeoShape = { type: string; coordinates: unknown };
/** How loudly the map draws a satellite (lib/home/focus.mjs mapLayers). */
export type Emphasis = "focus" | "normal" | "ghost" | "hidden";

export interface MapSat {
  noradId: number;
  name: string;
  color: string;
  trackPast: GeoShape;
  trackFuture: GeoShape;
  trackTicks: { lonDeg: number; latDeg: number; minutes: number }[];
  /** The time ticks relative to a time (ms); the map refreshes them every second. */
  ticksAt?(ms: number): MapSat["trackTicks"];
  position: { lonDeg: number; latDeg: number };
  /** The sub-point at a time (ms), or null when the track cannot place it. */
  positionAt(ms: number): SelectedSub | null;
  footprint: GeoShape | null;
  /** True for the focused satellite. */
  selected: boolean;
  emphasis: Emphasis;
  orbitClass: string;
  /** Minutes between the track's time ticks (geometry.mjs tickStepMin). */
  tickMin: number;
  /** Known radio downlinks: the dot gets the radio mark. */
  radio?: boolean;
  /** Height above the ellipsoid, km: shown under the name. */
  altKm?: number;
  /** An opened pass's ground path, rise to set, drawn bold. */
  passPath?: GeoShape;
  /** That path split by light: solid in sunlight, dashed in Earth's shadow. */
  passSunlit?: GeoShape;
  passShadow?: GeoShape;
  /** The rise and set points, with their times. */
  passEnds?: { lonDeg: number; latDeg: number; label: string }[];
  /** Paused: where that pass comes closest (its highest point), the sight line's end. */
  passPeak?: { lonDeg: number; latDeg: number; altKm?: number };
  /** Live with its pass open: a sight line to where it is now, while it is up. */
  passLive?: boolean;
  /** That pass has set: below the horizon now reads "already set". */
  passAfter?: boolean;
  /** The visibility circle's radius around the observer, in degrees. */
  passReachDeg?: number;
  /** That circle traced on the ellipsoid (a closed [lon, lat] line), when known. */
  passRing?: number[][];
  /** The horizon's circle, when the lowest pass setting is above 0 (drawn faint). */
  passRingHorizon?: number[][];
}

export interface MapObserver {
  name: string;
  latDeg: number;
  lonDeg: number;
  /** The ground's height in metres, when known: distances and the sight line use it. */
  elevM?: number;
}

export interface SelectedSub {
  latDeg: number;
  lonDeg: number;
  altKm: number;
}

interface Props {
  sats: MapSat[];
  observer: MapObserver | null;
  /** 'flat' or 'globe' (lib/map/view.mjs). */
  projectionId: string;
  onProjectionChange: (id: string) => void;
  /** The focused satellite. Entering a focus pans to centre it. */
  selectedId: number | null;
  minElevDeg: number;
  /** A tap on a dot, ghosts included. */
  /** A tap on a dot; null when the tap was on the focused one (leave it). */
  onSelect: (noradId: number | null) => void;
  /** Shown above the map, inside the full screen frame (the focus bar). */
  top?: React.ReactNode;
  /** Laid over the top of the map, left of the layers and full screen buttons (the chips). */
  chips?: React.ReactNode;
  /** Sized by its container (MapShell): docked full height on desktop, with the
   *  focus bar laid over the map. */
  fill?: boolean;
  /** The Share button for the whole view, in the layers menu. */
  share?: React.ReactNode;
}

export type FlatMapProps = Props;

type View = "flat" | "globe";
/** The MapLibre projection each view draws with (as basemapStyle names it). */
const PROJECTION_OF = { flat: "mercator", globe: "globe" } as const;
type LngLat = [number, number];
type Camera = { center: LngLat; zoom: number };
/** A camera move; no zoom keeps the current zoom. */
type Move = { center: LngLat; zoom?: number };
export type Preset = "you" | "sat" | "north" | "south" | "night";
type LegendItem = { key: string; kind: string; label: string; color?: string };
const altLine = altText as (altKm: number) => string;
const awayLabel = awayText as (rangeKm: number) => string;
const greatCircle = greatCircleOf as (a: [number, number], b: [number, number], n?: number) => [number, number][];
/** The live sight line starts this far (px) from your location's centre: at its icon's edge. */
const SIGHT_TRIM_PX = 7;
const sightFeatures = sightFeaturesOf as (s: MapSat, observer: MapObserver | null) => unknown[];
const sightOf = sightFrom as (o: { latDeg: number; lonDeg: number; elevM?: number }, lon: number, lat: number, altKm: number) => { rangeKm: number; elDeg: number };
/** The distance label's width per character (9.5 px text) and the room the
 *  icons at the line's ends take (your crosshair, the dot and its radio arcs). */
const SIGHT_CHAR_PX = 5.4;
const SIGHT_ICON_ROOM_PX = 40;
const legend = legendItems as (o: { sats: MapSat[]; observer: MapObserver | null; minElevDeg: number }) => LegendItem[];
type SourceData = Record<string, unknown>;
const buildData = overlayData as (o: {
  sats?: MapSat[];
  observer?: MapObserver | null;
  nightDate?: Date | null;
  shortTrackIds?: Set<number>;
  trackDetail?: number;
  tracks?: boolean;
  marks?: boolean;
  graticule?: boolean;
}) => SourceData;
const detailFor = trackDetailFor as (zoom: number, latDeg: number) => number;
// A stable id per track shape object, so an unchanged minute's tracks are not
// re-sent to the map every second.
const shapeIds = new WeakMap<object, number>();
let nextShapeId = 1;
const shapeId = (o: object | null | undefined) => {
  if (!o) return 0;
  let id = shapeIds.get(o);
  if (!id) shapeIds.set(o, (id = nextShapeId++));
  return id;
};
function trackKey(sats: MapSat[], short: Set<number>, detail: number): string {
  // The units too: the pass's sight label is built with the tracks.
  const parts = sats.map((s) => `${s.noradId}:${s.emphasis}:${s.color}:${shapeId(s.trackPast)}:${shapeId(s.trackFuture)}:${shapeId(s.passPath)}:${shapeId(s.passSunlit)}:${shapeId(s.passRing)}`);
  return `${detail}|${(currentUnits as () => string)()}|${[...short].sort().join(",")}|${parts.join(";")}`;
}
const home = homeCamera as (
  view: View,
  o: {
    observer: MapObserver | null;
    focus: { lonDeg: number; latDeg: number } | null;
    width: number;
    height: number;
    points?: { lonDeg: number; latDeg: number }[];
  },
) => Camera;
const preset = presetCamera as (
  p: Preset,
  o: {
    observer: MapObserver | null;
    focus: { lonDeg: number; latDeg: number } | null;
    width: number;
    height: number;
    date?: Date;
  },
) => { center: LngLat; zoom: number } | null;
const homeCentresFocus = homeCentresFocusOf as (
  view: View,
  o: { observer: MapObserver | null; focus: { lonDeg: number; latDeg: number } | null },
) => boolean;
const addOverlays = addOverlaysTo as (
  map: MlMap,
  o: { images: unknown[]; layers: LayerSpecification[]; data: SourceData; custom?: CustomLayerInterface[] },
) => void;
/** The globe footprint fill (lib/map/footprint-layer.mjs). */
type FootprintLayer = CustomLayerInterface & {
  setFootprint(f: { center: LngLat; radiusDeg: number; color: string } | null): void;
};
const makeFootprintLayer = createFootprintLayer as (o: { onFail?: () => void }) => FootprintLayer;
const capShown = drawsGlobeCap as (o: { view: View; zoom: number; failed?: boolean }) => boolean;
const radiusFor = footprintRadiusDeg as (altKm: number, minElevDeg: number) => number;
const footprintOf = footprintFeature as (sub: SelectedSub, altKm: number, minElevDeg: number) => GeoShape;
/** The GeoJSON footprint fill, hidden while the globe layer draws it. */
const FILL_LAYER = "ss-footprint-fill";
type Theme = "dark" | "light";
/** The focused satellite now, as its dot, the footprint and the follow jump need it. */
type LiveFocus = SelectedSub & { name: string; color: string; footprint: boolean; radio: boolean };
/** The focused satellite's dot and name: a marker the frame loop moves. */
type FocusMark = { marker: Marker; el: HTMLElement; name: HTMLElement; nameText: HTMLElement; alt: HTMLElement; shown: boolean; label: string; color: string; radio: boolean };
/** A Lock on zoom, eased by the frame loop's jump: from and to zoom, start (ms) and length. */
type ZoomGoal = { from: number; to: number; t0: number; dur: number };
/** The frame loop's controls while a satellite is focused (the frame effect). */
type Frames = {
  running: () => boolean;
  wake: () => void;
  tick: () => void;
  measure: () => void;
};

/** How often the other dots and the GeoJSON footprint move; the focus moves every frame. */
const DOT_MS = 200;
/** Where MapShell docks the map beside the panel (keep in step with home.css). */
const DOCKED_QUERY = "(min-width: 1100px)";
/** A tap this close to a dot (in px, either axis) selects it. */
const HIT_PX = 22;
// How long a tap on the focused dot waits to see if it is a double-click:
// MapLibre's double-tap window, and about the usual double-click setting.
const DBLCLICK_MS = 500;
// The lat/lon labels sit this far in from the map's left and bottom edges,
// placed where lines cross those edges, sampled this often along them.
const GRID_INSET_PX = 6;
const GRID_SAMPLE_PX = 12;
// What a label must not sit under: the map's buttons and panels.
const GRID_BLOCKERS = "button, .flat-map__head, .maplibregl-ctrl-attrib";
// A 9 px label's rough size, for the overlap test.
const GRID_CHAR_PX = 5.6;
const GRID_LINE_PX = 11;
/** Folds MapLibre's compact attribution to its info button, as its own drag
 *  and button do; the button still opens it. */
function foldAttribution(map: MlMap | null) {
  const attrib = map?.getContainer().querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show");
  if (!attrib) return;
  attrib.classList.remove("maplibregl-compact-show");
  attrib.setAttribute("open", "");
}
/** The satellite dot layer tapped through (lib/map/overlays.mjs). The focus
 *  layer draws nothing (the focus marker does), so the marker is tested apart. */
const SAT_LAYERS = ["ss-sats"];
/** A future track smaller than this on both axes gets no chevron or ticks. */
const SHORT_TRACK_PX = 16;
/** The globe camera buttons, in order. */
const PRESETS: { id: Preset; label: string }[] = [
  { id: "you", label: "On you" },
  { id: "sat", label: "On satellite" },
  { id: "north", label: "North pole" },
  { id: "south", label: "South pole" },
  { id: "night", label: "Night side" },
];
/** Zoom slack before the map counts as zoomed in past its home view. */
const ZOOM_EPS = 0.01;
/** The sky turns 0.25 deg a minute, about 0.1 px a second at the globe's
 *  field of view on a screen 800 px tall: a redraw this often keeps each
 *  step under half a pixel. */
const STAR_TICK_MS = 5_000;
/** How often the map canvas is checked against its box, and how long a
 *  mismatch may last (a resize in flight) before the map is refitted. */
const CANVAS_CHECK_MS = 5_000;
const CANVAS_RECHECK_MS = 500;
/** How strongly it shows: subtle, the core no more than a soft grey cloud. */
const MILKY_WAY_ALPHA = 0.2;
/** How long a shared link's camera waits for the map and its satellite. */
const SHARED_CAMERA_MS = 20_000;
/** How long a Lock on zoom (buttons, keys, double-click, mouse wheel) eases. */
const LOCK_ZOOM_MS = 250;
/** After a Lock on zoom arrives, how long to wait for another (a trackpad
 *  pinch is a stream of them) before the end-of-zoom work runs once. */
const LOCK_SETTLE_MS = 150;
/** How long turning Lock on eases to the satellite before following it. */
const LOCK_EASE_MS = 600;
/** Lock on starts with an ease only when the satellite is this far (px) off centre. */
const LOCK_EASE_PX = 4;
/** Not following, the focus moves every frame only when it moves more than
 *  this (px) per DOT_MS; slower, the DOT_MS tick places it. */
const FRAME_PX = 1;
/** MapLibre's mouse wheel step and zoom rates (scroll_zoom.ts), for Lock on's wheel. */
const WHEEL_STEP = 4.000244140625;
const WHEEL_RATE = 1 / 450;
const TRACKPAD_RATE = 1 / 100;

const zoomFloor = minZoomFor as (view: View, size: { width: number; height: number }) => number;
const easeZoom = easeZoomOf as (current: number, target: number) => number;
const wrapLon = (d: number) => d - 360 * Math.round(d / 360);
const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const readTheme = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
const reducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** A wheel event's zoom change, as MapLibre's scroll zoom works it out, and
 *  whether it came from a mouse wheel (eased) or a trackpad (applied at once). */
function wheelZoom(e: WheelEvent): { dz: number; wheel: boolean } {
  let d = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 40 : e.deltaY;
  if (e.shiftKey) d /= 4;
  if (!d) return { dz: 0, wheel: false };
  const wheel = Math.abs(d) > WHEEL_STEP && (d % WHEEL_STEP === 0 || Math.abs(d) >= 50);
  const scale = 2 / (1 + Math.exp(-Math.abs(d * (wheel ? WHEEL_RATE : TRACKPAD_RATE))));
  return { dz: d < 0 ? Math.log2(scale) : -Math.log2(scale), wheel };
}
/** A Lock on zoom at a time: the zoom, and whether it has arrived. */
function goalAt(g: ZoomGoal, now: number): { zoom: number; done: boolean } {
  const t = g.dur > 0 ? Math.min(1, Math.max(0, (now - g.t0) / g.dur)) : 1;
  return { zoom: g.from + (g.to - g.from) * (1 - (1 - t) ** 3), done: t >= 1 };
}
/** A zoom comparable across centres: at a fixed zoom the globe's disc grows
 *  by 1 / cos(centre latitude), clamped where MapLibre clamps it. */
const discZoom = (view: View, zoom: number, lat: number) =>
  view === "globe" ? zoom - Math.log2(Math.cos((Math.min(Math.abs(lat), 85.05) * Math.PI) / 180)) : zoom;
const focusOf = (sats: MapSat[]) => sats.find((s) => s.emphasis === "focus")?.position ?? null;
/** Where the dots on the map are now, ghosts included. */
const dotsOf = (sats: MapSat[]) => sats.filter((s) => s.emphasis !== "hidden").map((s) => s.position);

/** Satellites whose future track spans under SHORT_TRACK_PX on screen (GEO). */
function shortTracks(map: MlMap, sats: MapSat[]): Set<number> {
  const out = new Set<number>();
  for (const s of sats) {
    const shape = s.trackFuture;
    if (!shape || s.emphasis === "ghost" || s.emphasis === "hidden") continue;
    const lines = (shape.type === "LineString" ? [shape.coordinates] : shape.coordinates) as LngLat[][];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const line of lines ?? []) {
      for (const pt of line) {
        const p = map.project(pt);
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
        y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
    }
    if (x1 >= x0 && x1 - x0 < SHORT_TRACK_PX && y1 - y0 < SHORT_TRACK_PX) out.add(s.noradId);
  }
  return out;
}

export default function FlatMap({
  sats,
  observer,
  projectionId,
  onProjectionChange,
  selectedId,
  minElevDeg,
  onSelect,
  top = null,
  chips = null,
  fill = false,
  share = null,
}: Props) {
  const view: View = projectionId === "flat" ? "flat" : "globe";
  const glRef = useRef<HTMLDivElement>(null);
  const starsRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  // True between a style's load and the next setStyle: the overlay sources exist.
  const styleReady = useRef(false);
  // Read after mount (the server and first render draw dark).
  const themeRef = useRef<Theme>("dark");
  const night = useRef<{ at: number; data: unknown } | null>(null);
  // Why there is no map: no WebGL, or the MapLibre chunk did not load (offline).
  const [noMap, setNoMap] = useState<null | "gl" | "load">(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const fullRef = useRef(false);
  fullRef.current = full;
  const nativeFull = useRef(false);
  // True while the camera is the home view (not moved by hand since), so a
  // resize or a new observer refits it.
  const atHome = useRef(true);
  // True once the map has first drawn: home refits after that ease (a new
  // location, a hidden dot); before it, they jump into the first frame.
  const settled = useRef(false);
  // Docked beside the panel the page never scrolls, so the map owns wheel and drag.
  const docked = useRef(false);
  // Entering a focus moves once to centre it (the effect near the end).
  const centreOn = useRef<number | null>(null);
  // "Satellite GP": the camera stays on the focus until a pan (zooms
  // keep it), Reset view, another preset or a new focus stops it. A shared
  // store, so other controls can show and toggle it; the dot loop reads it
  // with getState.
  // The units the labels read in; a change re-renders, so they rebuild.
  useUnits();
  const followOn = useFollow((s) => s.following);
  const setFollowing = useFollow((s) => s.setFollowing);
  const paused = useMapClock((s) => s.paused);
  const backToLive = useMapClock((s) => s.backToLive);

  // Latest props, read by map event handlers without re-binding them.
  const latest = useRef({ sats, observer, view, onSelect, minElevDeg });
  latest.current = { sats, observer, view, onSelect, minElevDeg };

  /** The satellites as of now: props arrive about once a second, so each dot
   *  and the focus footprint move to mapNow(). A satellite the track cannot
   *  place now stays where the props put it, so a failed sample never drops
   *  it (or changes the track key). */
  const liveSats = useCallback((withTicks = true): MapSat[] => {
    const { sats: s, minElevDeg: elev } = latest.current;
    const ms = mapNow();
    const out: MapSat[] = [];
    for (const x of s) {
      const sub = x.positionAt(ms);
      if (!sub) {
        out.push(x);
        continue;
      }
      out.push({
        ...x,
        position: { lonDeg: sub.lonDeg, latDeg: sub.latDeg },
        altKm: sub.altKm,
        footprint: x.footprint ? footprintOf(sub, sub.altKm, elev) : null,
        ...(withTicks && x.ticksAt && { trackTicks: x.ticksAt(ms) }),
      });
    }
    return out;
  }, []);
  // The live sight line, drawn over the canvas (lib/map/sight-path.mjs).
  const sightSvg = useRef<{ svg: SVGSVGElement; path: SVGPathElement; key: string } | null>(null);
  /** Draw the live sight line to where the satellite's dot is now: the focus
   *  marker's own placed sample when it is the focus, so the two match in
   *  the same frame. Cleared when no live pass is open. */
  const drawSight = useCallback((map: MlMap) => {
    const el = sightSvg.current;
    if (!el) return;
    const { sats: s, observer: o, view: v } = latest.current;
    const live = o ? s.find((x) => x.passLive) : undefined;
    let pos: { lonDeg: number; latDeg: number; altKm: number } | null = null;
    if (live && o) {
      const last = lastFocus.current;
      pos = live.emphasis === "focus" && last && last.noradId === live.noradId ? last.focus : live.positionAt(mapNow());
    }
    if (!live || !o || !pos) {
      if (el.key) {
        el.path.setAttribute("d", "");
        el.key = "";
      }
      return;
    }
    const below = sightOf(o, pos.lonDeg, pos.latDeg, pos.altKm).elDeg < 0;
    const key = `${live.color}|${below}`;
    if (key !== el.key) {
      el.key = key;
      el.path.setAttribute("stroke", live.color);
      el.path.classList.toggle("flat-map__sight--below", below);
    }
    const globe = v === "globe";
    // MapLibre's own occlusion test, as its markers use (internal: guarded).
    type Occl = { isLocationOccluded?: (ll: { lng: number; lat: number }) => boolean };
    const tr = (map as unknown as { _camera?: { transform?: Occl } })._camera?.transform;
    const occluded = globe && typeof tr?.isLocationOccluded === "function" ? tr.isLocationOccluded.bind(tr) : null;
    const points = greatCircle([o.lonDeg, o.latDeg], [pos.lonDeg, pos.latDeg], 48).map(([lon, lat]) => {
      const p = map.project([lon, lat]);
      return { x: p.x, y: p.y, hidden: occluded ? occluded({ lng: lon, lat }) : false };
    });
    el.path.setAttribute("d", sightPathD(points, SIGHT_TRIM_PX));
  }, []);
  // The focus's last placed sample, kept for a sample that fails.
  const lastFocus = useRef<{ noradId: number; focus: LiveFocus } | null>(null);
  /** The focused satellite's sub-point at ms (now by default), or null.
   *  Worked out once per update and shared by the dot, the footprint and the
   *  follow jump. A sample the track cannot place keeps the last one, as
   *  liveSats keeps the dot, so the dot and the globe cap do not blink off. */
  const liveFocus = useCallback((s: MapSat[], ms = mapNow()): LiveFocus | null => {
    const f = s.find((x) => x.emphasis === "focus");
    if (!f) {
      lastFocus.current = null;
      return null;
    }
    const sub = f.positionAt(ms);
    const last = lastFocus.current;
    if (!sub) return last && last.noradId === f.noradId ? last.focus : null;
    const focus = { ...sub, name: f.name, color: f.color, footprint: f.footprint != null, radio: f.radio === true };
    lastFocus.current = { noradId: f.noradId, focus };
    return focus;
  }, []);

  // The focus footprint's fill: on a full globe a custom layer draws it as a
  // true spherical cap (the GeoJSON fill stops at 85 degrees); otherwise the
  // GeoJSON fill does. Exactly one shows.
  const capLayer = useRef<FootprintLayer | null>(null);
  const capFailed = useRef(false);
  // Whether the current style's GeoJSON fill is hidden; a new style shows it.
  const fillHidden = useRef(false);
  const syncFill = useCallback(() => {
    const map = mapRef.current;
    if (!map || !styleReady.current) return;
    const hide = capShown({ view: latest.current.view, zoom: map.getZoom(), failed: capFailed.current });
    if (hide === fillHidden.current) return;
    fillHidden.current = hide;
    map.setLayoutProperty(FILL_LAYER, "visibility", hide ? "none" : "visible");
  }, []);
  /** The focus satellite's footprint for the globe layer, as overlayData draws it. */
  const pushFootprint = useCallback((f: LiveFocus | null) => {
    capLayer.current?.setFootprint(f?.footprint
      ? { center: [f.lonDeg, f.latDeg], radiusDeg: radiusFor(f.altKm, latest.current.minElevDeg), color: f.color }
      : null);
  }, []);

  const homeView = useCallback((map: MlMap): Camera => {
    const { sats: s, observer: o, view: v } = latest.current;
    const el = map.getContainer();
    return home(v, { observer: o, focus: focusOf(s), points: dotsOf(s), width: el.clientWidth || 1, height: el.clientHeight || 1 });
  }, []);
  /** Zoom out no further than the whole Earth: the floor follows the
   *  container. On the globe MapLibre adds its own latitude term, so the floor holds through moves. */
  const limitZoom = useCallback((map: MlMap) => {
    const el = map.getContainer();
    const v = latest.current.view;
    map.setMinZoom(zoomFloor(v, { width: el.clientWidth || 1, height: el.clientHeight || 1 }));
  }, []);
  const moveTo = useCallback((map: MlMap, cam: Move) => {
    if (reducedMotion()) map.jumpTo(cam);
    else map.easeTo(cam);
  }, []);
  /** Refit an untouched home view: eased once the map is on screen, a jump before. */
  const refitHome = useCallback((map: MlMap) => {
    if (settled.current) moveTo(map, homeView(map));
    else map.jumpTo(homeView(map));
  }, [moveTo, homeView]);
  /** While following, the wheel, double-click and +/- keys are ours (the
   *  handlers in the map effect, eased in the frame loop's jump) and pinch
   *  zooms about the centre (the satellite); otherwise MapLibre's zoom about
   *  the pointer. The +/- buttons always zoom about the centre. */
  const syncZoomAround = useCallback((map: MlMap, centre: boolean) => {
    const opts = centre ? { around: "center" as const } : undefined;
    if (centre) map.scrollZoom.disable();
    else map.scrollZoom.enable();
    map.touchZoomRotate.enable(opts);
    if (centre) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
  }, []);
  // True while a mouse button or a finger is down on the map. A jump then
  // would stop MapLibre's handlers and lose a drag that has not yet moved
  // far enough to start.
  const handHeld = useRef(false);
  // True while followJump's own jumpTo runs (it fires its events at once), so
  // moveend and zoomend skip the work a hand move needs.
  const selfJump = useRef(false);
  // Lock on's zoom in progress: the frame loop eases it in its follow jump, so
  // the satellite stays centred through the zoom.
  const zoomGoal = useRef<ZoomGoal | null>(null);
  const frames = useRef<Frames | null>(null);
  /** Following, zoom by dz through the frame loop rather than a MapLibre ease
   *  (followJump waits out an ease, so the satellite would drift off centre). */
  const lockZoomBy = useCallback((map: MlMap, dz: number, ms = LOCK_ZOOM_MS) => {
    const g = zoomGoal.current;
    // The globe's minimum zoom is set for the equator; MapLibre lowers it by
    // the centre's latitude (the same disc needs less zoom there), so near a
    // pole the raw minimum would be a zoom in.
    const lat = Math.min(Math.abs(map.getCenter().lat), 85.051129);
    const floor = map.getMinZoom() + (latest.current.view === "globe" ? Math.log2(Math.cos((lat * Math.PI) / 180)) : 0);
    const to = Math.min(map.getMaxZoom(), Math.max(floor, (g?.to ?? map.getZoom()) + dz));
    atHome.current = false;
    zoomGoal.current = { from: map.getZoom(), to, t0: performance.now(), dur: reducedMotion() ? 0 : ms };
    frames.current?.wake();
  }, []);
  /** Following, jump to the focus f (and to zoom, when given): no easing, and
   *  no originalEvent, so movestart does not take it for a gesture. Waits for a
   *  running ease or gesture (a preset's, a held pointer or pinch) to end, so a
   *  pinch still lets the satellite drift until the fingers lift. True when it jumped. */
  const followJump = useCallback((map: MlMap, f: LiveFocus | null, zoom?: number): boolean => {
    if (!f || handHeld.current || map.isMoving() || !useFollow.getState().following) return false;
    selfJump.current = true;
    try {
      const center: LngLat = [f.lonDeg, f.latDeg];
      map.jumpTo(zoom === undefined ? { center } : { center, zoom });
    } finally {
      selfJump.current = false;
    }
    return true;
  }, []);
  // The focused dot and name, made with the map. A DOM marker moves at once
  // when told (and on every camera move), so it lands in the same frame as a
  // follow jump; a GeoJSON source re-tiles in the worker and lands later.
  const focusMark = useRef<FocusMark | null>(null);
  // The lat/lon lines past globe level, built
  // over an area around the view; rebuilt once the view leaves it or wants
  // other steps. Cheap to check, so on every move (Lock on moves each frame).
  const gridBuilt = useRef<ReturnType<typeof viewGrid> | null>(null);
  const syncGrid = useCallback((map: MlMap, force = false) => {
    const b = map.getBounds();
    const v = { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth(), zoom: map.getZoom() };
    if (!force && gridCovers(gridBuilt.current, v)) return;
    gridBuilt.current = viewGrid(v);
    setOverlayData(map, { "ss-grid-view": gridBuilt.current.data });
  }, []);
  // One label per line, where it meets the left edge (parallels) or the
  // bottom (meridians), as on a printed map. Screen-placed, so they stay on
  // the edges through every move; redone on each camera move.
  const gridLabelsRef = useRef<HTMLDivElement>(null);
  const layoutGridLabels = useCallback((map: MlMap) => {
    const box = gridLabelsRef.current;
    if (!box) return;
    const gl = map.getContainer();
    const w = gl.clientWidth;
    const h = gl.clientHeight;
    const b = map.getBounds();
    const step = labelSteps({ west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth(), zoom: map.getZoom() });
    // The edge point's longitude or latitude, or null where it misses the Earth.
    const sample = (x: number, y: number, meridian: boolean) => {
      const ll = map.unproject([x, y]);
      const p = map.project(ll);
      if (Math.hypot(p.x - x, p.y - y) > 1.5 || Math.abs(ll.lat) > 85) return null;
      return meridian ? { px: x, deg: ll.lng } : { px: y, deg: ll.lat };
    };
    const bottom = h - GRID_INSET_PX;
    const across: ({ px: number; deg: number } | null)[] = [];
    for (let x = 0; x <= w; x += GRID_SAMPLE_PX) across.push(sample(x, bottom, true));
    const down: ({ px: number; deg: number } | null)[] = [];
    for (let y = 0; y <= h; y += GRID_SAMPLE_PX) down.push(sample(GRID_INSET_PX, y, false));
    const origin = gl.getBoundingClientRect();
    const blocks = [...(shellRef.current?.querySelectorAll(GRID_BLOCKERS) ?? [])]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0)
      .map((r) => ({ l: r.left - origin.left - 4, r: r.right - origin.left + 4, t: r.top - origin.top - 4, b: r.bottom - origin.top + 4 }));
    // Each label's box: bottom ones centred above their point, left ones beside it.
    const labels = [
      ...(edgeCrossings(across, "meridian", step.lon) as { px: number; label: string }[]).map((c) => {
        const half = (c.label.length * GRID_CHAR_PX) / 2;
        return { label: c.label, x: c.px, y: bottom, anchor: "translate(-50%, -100%)", l: c.px - half, r: c.px + half, t: bottom - GRID_LINE_PX, b: bottom };
      }),
      ...(edgeCrossings(down, "parallel", step.lat) as { px: number; label: string }[]).map((c) => ({
        label: c.label, x: GRID_INSET_PX, y: c.px, anchor: "translate(0, -50%)",
        l: GRID_INSET_PX, r: GRID_INSET_PX + c.label.length * GRID_CHAR_PX, t: c.px - GRID_LINE_PX / 2, b: c.px + GRID_LINE_PX / 2,
      })),
    ].filter((g) => g.l >= 0 && g.r <= w && g.t >= 0 && g.b <= h
      // Clear of the corner the two rows share, and of every button.
      && !(g.l < 60 && g.b > bottom - GRID_LINE_PX - 4 && g.anchor.startsWith("translate(0"))
      && !blocks.some((k) => g.l < k.r && g.r > k.l && g.t < k.b && g.b > k.t));
    let n = 0;
    for (const g of labels) {
      let el = box.children[n] as HTMLElement | undefined;
      if (!el) {
        el = document.createElement("span");
        el.className = "flat-map__grid-label";
        box.appendChild(el);
      }
      if (el.textContent !== g.label) el.textContent = g.label;
      el.style.transform = `translate(${g.x}px, ${g.y}px) ${g.anchor}`;
      el.hidden = false;
      n++;
    }
    for (; n < box.children.length; n++) (box.children[n] as HTMLElement).hidden = true;
  }, []);
  // A pending leave from a tap on the focused dot; a double-click cancels it.
  const leaveTimer = useRef<number | undefined>(undefined);
  // Whether the map is on screen (a stacked map scrolls away on phones), and
  // whether a props push waited for it to come back.
  const mapInView = useRef(true);
  const pushWaiting = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  // The star field behind the globe, with the Sun, Moon and bright planets:
  // true positions for the camera and the moment (lib/map/stars.mjs),
  // loaded only when a spherical view shows.
  // Redrawn as the camera moves, and every STAR_TICK_MS as the Earth turns.
  useEffect(() => {
    const map = mapRef.current;
    const canvas = starsRef.current;
    if (!mapReady || !map || !canvas || view === "flat") return;
    let alive = true;
    let draw: (() => void) | null = null;
    let frame: number | undefined;
    const schedule = () => {
      if (frame !== undefined || !draw) return;
      frame = requestAnimationFrame(() => { frame = undefined; draw?.(); });
    };
    void Promise.all([
      import("@/lib/map/stars.mjs"), import("@/lib/map/star-data.mjs"), import("@/lib/coords.js"),
      import("@/lib/pass-finder/sun.js"), import("@/lib/pass-finder/moon.js"), import("@/lib/pass-finder/planets.js"),
    ]).then(([stars, data, coords, sun, moon, planets]) => {
      if (!alive) return;
      const field = stars.starField(data.STARS);
      // The Milky Way image, read once into pixels; drawn when it arrives.
      let milky: { data: Uint8ClampedArray; width: number; height: number; floor: number } | null = null;
      const low = document.createElement("canvas");
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        if (!alive) return;
        const c2 = document.createElement("canvas");
        c2.width = img.naturalWidth;
        c2.height = img.naturalHeight;
        const x2 = c2.getContext("2d", { willReadFrequently: true });
        if (!x2) return;
        x2.drawImage(img, 0, 0);
        const px = x2.getImageData(0, 0, c2.width, c2.height);
        milky = { data: px.data, width: px.width, height: px.height, floor: stars.skyFloor(px.data) };
        schedule();
      };
      img.src = "/sky/milkyway.jpg";
      draw = () => {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return;
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
          canvas.width = Math.round(w * dpr);
          canvas.height = Math.round(h * dpr);
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const c = map.getCenter();
        const now = new Date(mapNow());
        const cam = { lonDeg: c.lng, latDeg: c.lat, bearingDeg: map.getBearing(), fovDeg: map.getVerticalFieldOfView(), width: w, height: h };
        const gmstRad = coords.gmstFromDate(now);
        // Light theme: the sky as a printed atlas (dark dots, no Milky Way).
        const atlas = readTheme() === "light";
        // Camera distance from public values, as MapLibre derives it: half the
        // height over tan(fov / 2) to the map's centre, and a 512 px tile world.
        const camToCenterPx = h / 2 / Math.tan((cam.fovDeg * Math.PI) / 360);
        const camDistKm = stars.cameraDistanceKm(camToCenterPx, 512 * 2 ** map.getZoom(), c.lat);
        if (milky && !atlas) {
          // Sampled as finely as the image has detail, smoothed up; nothing
          // computed behind the globe (a little inside its edge).
          const step = stars.milkyWayStep(camToCenterPx, milky.width);
          const hide = Math.max(0, stars.globeRadiusPx(camDistKm, camToCenterPx) - step * 1.5);
          const ow = Math.ceil(w / step), oh = Math.ceil(h / step);
          if (low.width !== ow || low.height !== oh) { low.width = ow; low.height = oh; }
          const lctx = low.getContext("2d");
          if (lctx) {
            const buf = lctx.createImageData(ow, oh);
            stars.renderMilkyWay(milky, milky.floor, buf.data, ow, oh, step, cam, gmstRad, hide);
            lctx.putImageData(buf, 0, 0);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.globalAlpha = MILKY_WAY_ALPHA;
            ctx.drawImage(low, 0, 0, ow, oh, 0, 0, ow * step, oh * step);
            ctx.globalAlpha = 1;
          }
        }
        const placed = stars.projectStars(field, { ...cam, gmstRad });
        stars.drawStars(ctx, field, placed, atlas ? "atlas" : "sky");
        // The Moon, the Sun and the bright planets, over the stars.
        stars.drawBodies(ctx, stars.skyBodies({
          sunEcef: sun.sunPositionEcef(now),
          sunAu: sun.sunDistanceAu(now),
          moonEcef: moon.moonPositionEcef(now),
          moonKm: moon.moonDistanceKm(now),
          camDistKm,
          planets: planets.PLANET_NAMES.map((n: string) => ({
            name: n,
            dirEcef: planets.planetPositionEcef(n, now),
            mag: planets.planetApparentMagnitude(n, now) ?? 99,
            color: (planets.PLANET_STYLE as Record<string, { color: string }>)[n].color,
          })),
        }, cam), atlas ? "atlas" : "sky");
      };
      draw();
    });
    map.on("move", schedule);
    map.on("resize", schedule);
    window.addEventListener("seeksat:theme", schedule);
    const tick = window.setInterval(schedule, STAR_TICK_MS);
    return () => {
      alive = false;
      map.off("move", schedule);
      map.off("resize", schedule);
      window.removeEventListener("seeksat:theme", schedule);
      window.clearInterval(tick);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [mapReady, view]);

  // The canvas drawn at its box's size and shape. MapLibre keeps them
  // together; an iPhone once showed the globe stretched into an egg on a first
  // visit anyway. Checked once settled, every CANVAS_CHECK_MS, and when the
  // page or the phone's view changes: a mismatch still there a moment later
  // refits the map and is reported (once), as is a lost WebGL context.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const canvas = map.getCanvas();
    let reported = false;
    let recheck: number | undefined;
    const tell = (message: string) => {
      if (reported) return;
      reported = true;
      reportNotice(`${message}; dpr ${window.devicePixelRatio}, view ${window.innerWidth}x${window.innerHeight}`);
    };
    const measure = () => {
      const box = map.getContainer();
      const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
      return canvasMismatch({
        boxW: box.clientWidth, boxH: box.clientHeight,
        cssW: canvas.clientWidth, cssH: canvas.clientHeight,
        bufW: canvas.width, bufH: canvas.height,
        drawW: gl?.drawingBufferWidth ?? null, drawH: gl?.drawingBufferHeight ?? null,
      });
    };
    const check = () => {
      if (recheck !== undefined || !measure()) return;
      recheck = window.setTimeout(() => {
        recheck = undefined;
        const wrong = measure();
        if (!wrong) return;
        tell(wrong);
        map.resize();
      }, CANVAS_RECHECK_MS);
    };
    const onLost = () => tell("Map WebGL context lost");
    map.once("idle", check);
    map.on("webglcontextlost", onLost);
    const tick = window.setInterval(check, CANVAS_CHECK_MS);
    window.addEventListener("pageshow", check);
    window.addEventListener("orientationchange", check);
    window.visualViewport?.addEventListener("resize", check);
    return () => {
      map.off("idle", check);
      map.off("webglcontextlost", onLost);
      window.clearInterval(tick);
      window.clearTimeout(recheck);
      window.removeEventListener("pageshow", check);
      window.removeEventListener("orientationchange", check);
      window.visualViewport?.removeEventListener("resize", check);
    };
  }, [mapReady]);
  /** Set the focus name beside its dot, square to the way it is moving, so it
   *  never sits on the track; paused on a pass, on the side away from you (the
   *  sight line). Rechecked at most twice a second. */
  const labelAt = useRef<{ t: number; nx: number; ny: number }>({ t: 0, nx: 1, ny: 0 });
  const placeLabel = useCallback((map: MlMap, mark: FocusMark, f: LiveFocus) => {
    const now = performance.now();
    if (now - labelAt.current.t < 500) return;
    labelAt.current.t = now;
    const sat = latest.current.sats.find((s) => s.selected);
    const ms = mapNow();
    const ahead = sat?.positionAt(ms + 60_000);
    if (!ahead) return;
    const p0 = map.project([f.lonDeg, f.latDeg]);
    const p1 = map.project([ahead.lonDeg, ahead.latDeg]);
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    // The perpendicular on the right of travel, or the left one when that
    // side faces the observer (the sight line) or the label would go up-left
    // of a mostly level track (names read best to the right).
    let nx = -dy / len;
    let ny = dx / len;
    const o = latest.current.observer;
    if (o && useMapClock.getState().paused) {
      const po = map.project([o.lonDeg, o.latDeg]);
      if (nx * (po.x - p0.x) + ny * (po.y - p0.y) > 0) { nx = -nx; ny = -ny; }
    } else if (f.radio ? nx + ny < 0 : nx < 0) {
      // Live: names read best to the right; a dot with the radio mark (its
      // arcs up and to the left) takes the side toward down-right instead.
      nx = -nx; ny = -ny;
    }
    const prev = labelAt.current;
    if (Math.abs(prev.nx - nx) < 0.05 && Math.abs(prev.ny - ny) < 0.05) return;
    labelAt.current = { t: now, nx, ny };
    mark.el.style.setProperty("--label-nx", nx.toFixed(3));
    mark.el.style.setProperty("--label-ny", ny.toFixed(3));
  }, []);
  /** Put the focus marker at f, or hide it when the track cannot place it. */
  const placeMark = useCallback((map: MlMap, f: LiveFocus | null) => {
    const mark = focusMark.current;
    if (!mark) return;
    if (!f) {
      mark.el.style.visibility = "hidden";
      return;
    }
    mark.el.style.visibility = "";
    if (f.color !== mark.color) {
      mark.color = f.color;
      mark.el.style.setProperty("--focus-color", f.color);
    }
    const alt = altLine(f.altKm);
    if (`${f.name}|${alt}` !== mark.label) {
      mark.label = `${f.name}|${alt}`;
      mark.nameText.textContent = f.name;
      mark.alt.textContent = alt;
    }
    if (f.radio !== mark.radio) {
      mark.radio = f.radio;
      mark.el.classList.toggle("flat-map__focus--radio", f.radio);
    }
    mark.marker.setLngLat([f.lonDeg, f.latDeg]);
    placeLabel(map, mark, f);
    if (!mark.shown) {
      mark.marker.addTo(map);
      mark.shown = true;
    }
  }, []);

  /** Night bands, rebuilt once they would have moved about a pixel at this
   *  zoom (nightRefreshMs); true when rebuilt. */
  const refreshNight = useCallback((zoom: number): boolean => {
    // The map's clock: a paused pass jumps it, so the gap can be either way.
    const now = mapNow();
    if (night.current && Math.abs(now - night.current.at) < nightRefreshMs(zoom)) return false;
    night.current = { at: now, data: buildData({ nightDate: new Date(now) })["ss-night"] };
    return true;
  }, []);
  const sentTrackKey = useRef<string | null>(null);
  /** Source data for the map. Tracks change once a minute (or on a zoom that
   *  changes their detail) while the dots and the marks (chevron and time
   *  ticks) change every second, so unless all is set the track line sources
   *  are only built when their key has changed; ss-marks goes every push. */
  const sourceData = useCallback((map: MlMap, all: boolean): SourceData => {
    const s = liveSats();
    const o = latest.current.observer;
    const short = shortTracks(map, s);
    const detail = detailFor(map.getZoom(), map.getCenter().lat);
    const key = trackKey(s, short, detail);
    const tracks = all || key !== sentTrackKey.current;
    sentTrackKey.current = key;
    // The lat/lon grid never changes: it goes in only when the style loads.
    return buildData({ sats: s, observer: o, shortTrackIds: short, trackDetail: detail, tracks, graticule: all });
  }, [liveSats]);

  // Push the latest props into the overlay sources.
  /** The sight line's distance label shows while its text fits between the
   *  two icons at the line's ends, and hides once it would not: the line's
   *  length on screen against the text's width plus the icons' room. Run as
   *  the camera moves and as the data updates. */
  const syncSightLabels = useCallback((map: MlMap) => {
    if (!styleReady.current) return;
    const o = latest.current.observer;
    let livePos: { lonDeg: number; latDeg: number; altKm?: number } | null = null;
    let liveAfter = false;
    const show = (layer: string, target: { lonDeg: number; latDeg: number; altKm?: number } | null) => {
      if (!map.getLayer(layer)) return;
      let fits = false;
      if (o && target) {
        const a = map.project([o.lonDeg, o.latDeg]);
        const b = map.project([target.lonDeg, target.latDeg]);
        const sight = sightOf(o, target.lonDeg, target.latDeg, target.altKm ?? 0);
        const below = target === livePos && liveAfter ? "already set" : "not up yet";
        const text = sight.elDeg < 0 ? `${awayLabel(sight.rangeKm)}, ${below}` : awayLabel(sight.rangeKm);
        fits = Math.hypot(b.x - a.x, b.y - a.y) >= text.length * SIGHT_CHAR_PX + SIGHT_ICON_ROOM_PX;
      }
      const want = fits ? 1 : 0;
      if (map.getPaintProperty(layer, "text-opacity") !== want) map.setPaintProperty(layer, "text-opacity", want);
    };
    const sats = latest.current.sats;
    show("ss-pass-sight-label", sats.find((x) => x.passPeak)?.passPeak ?? null);
    const live = sats.find((x) => x.passLive);
    livePos = live ? live.positionAt(mapNow()) : null;
    liveAfter = live?.passAfter === true;
    show("ss-live-sight-label", livePos);
  }, []);
  const push = useCallback(() => {
    const map = mapRef.current;
    if (!map || !styleReady.current) return;
    const data = sourceData(map, false);
    if (refreshNight(map.getZoom())) data["ss-night"] = night.current?.data;
    else delete data["ss-night"];
    setOverlayData(map, data);
    syncSightLabels(map);
  }, [sourceData, refreshNight, syncSightLabels]);

  const syncGestures = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    // Stacked under the panel the page scrolls past the map, so the map wants
    // ctrl+wheel or two fingers; docked, full screen or zoomed in past the
    // home view it takes plain gestures.
    const homeCam = homeView(map);
    const zoomedIn =
      discZoom(latest.current.view, map.getZoom(), map.getCenter().lat) >
        discZoom(latest.current.view, homeCam.zoom, homeCam.center[1]) + ZOOM_EPS;
    if (docked.current || fullRef.current || zoomedIn) map.cooperativeGestures.disable();
    else map.cooperativeGestures.enable();
  }, [homeView]);

  // The theme: read once on mount, then follow the toggle by swapping the
  // style. style.load re-adds the overlays; the style carries the current
  // projection, so the camera is untouched.
  useEffect(() => {
    themeRef.current = readTheme();
    const onTheme = () => {
      const next = readTheme();
      if (next === themeRef.current) return;
      themeRef.current = next;
      const map = mapRef.current;
      if (!map) return;
      styleReady.current = false;
      map.setStyle(basemapStyle(next, latest.current.view) as StyleSpecification, { diff: false });
    };
    window.addEventListener("seeksat:theme", onTheme);
    return () => window.removeEventListener("seeksat:theme", onTheme);
  }, []);

  // Load MapLibre and make the map. Until it arrives the frame shows the water colour.
  useEffect(() => {
    let alive = true;
    let made: MlMap | null = null;
    let detach: (() => void) | null = null;
    // A mouse button can come up off the map (MapLibre's drag listens on the
    // window too). A context menu can swallow the mouseup, so it lets go too,
    // as does any move with no button down.
    const letGo = () => {
      handHeld.current = false;
    };
    const onMove = (e: MouseEvent) => {
      if (handHeld.current && e.buttons === 0) handHeld.current = false;
    };
    window.addEventListener("mouseup", letGo);
    window.addEventListener("blur", letGo);
    window.addEventListener("contextmenu", letGo);
    window.addEventListener("mousemove", onMove);
    // The map can take a while to go idle (moving satellites, a slow phone),
    // so the credit may still be open. Scrolling the page down folds it: on
    // phones the list then slides over the map, and the open credit would
    // fill the strip left showing. A scroll event at the top leaves it open.
    const onScroll = () => {
      if (window.scrollY > 0) foldAttribution(made);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    (async () => {
      let gl: typeof import("maplibre-gl");
      try {
        [gl] = await Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl.css")]);
      } catch {
        // The chunk did not load (offline): say so rather than leave a blank frame.
        if (alive) setNoMap("load");
        return;
      }
      const el = glRef.current;
      if (!alive || !el) return;
      // The bundler rewrites import.meta.url inside the library, so it cannot
      // find its worker by itself; this URL makes the build emit the file.
      gl.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
      if ((gl as unknown as { supported?: () => boolean }).supported?.() === false) {
        setNoMap("gl");
        return;
      }
      const cam = home(latest.current.view, {
        observer: latest.current.observer,
        focus: focusOf(latest.current.sats),
        points: dotsOf(latest.current.sats),
        width: el.clientWidth || 1,
        height: el.clientHeight || 1,
      });
      let map: MlMap;
      try {
        map = new gl.Map({
          container: el,
          style: basemapStyle(themeRef.current, latest.current.view) as StyleSpecification,
          center: cam.center,
          zoom: cam.zoom,
          attributionControl: { compact: true },
          renderWorldCopies: true,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          maxZoom: MAX_ZOOM,
          // Labels and dots switch at once instead of fading: the fade also
          // delays hiding dots that turn to the far side of the globe.
          fadeDuration: 0,
          // Keep tiles from many zoom levels in memory (MapLibre's default is
          // about 5 levels' worth), so zooming far in and back out again
          // redraws from what is loaded instead of fetching it all again; and
          // let half-loaded tiles finish while zooming, so detail fills in as
          // it goes rather than all at the end.
          maxTileCacheZoomLevels: 12,
          cancelPendingTileRequestsWhileZooming: false,
          cooperativeGestures: !(docked.current || fullRef.current),
        });
      } catch {
        setNoMap("gl");
        return;
      }
      made = map;
      mapRef.current = map;
      // The focused dot and name (app/home.css .flat-map__focus). Hidden, not
      // faded, on the globe's far side; taps reach the canvas through it.
      const markEl = document.createElement("div");
      markEl.className = "flat-map__focus";
      markEl.setAttribute("aria-hidden", "true");
      const markDot = document.createElement("span");
      markDot.className = "flat-map__focus-dot";
      const markName = document.createElement("span");
      markName.className = "flat-map__focus-name";
      const markNameText = document.createElement("span");
      const markAlt = document.createElement("span");
      markAlt.className = "flat-map__focus-alt";
      markName.append(markNameText, markAlt);
      markEl.append(markDot, markName);
      markerOf.current = gl.Marker;
      focusMark.current = {
        marker: new gl.Marker({ element: markEl, subpixelPositioning: true, opacityWhenCovered: "0" }),
        el: markEl,
        name: markName,
        nameText: markNameText,
        alt: markAlt,
        shown: false,
        label: "",
        color: "",
        radio: false,
      };
      // Over the canvas, under the markers (added later, so after it).
      const svgNs = "http://www.w3.org/2000/svg";
      const sightEl = document.createElementNS(svgNs, "svg");
      sightEl.setAttribute("class", "flat-map__sight");
      sightEl.setAttribute("aria-hidden", "true");
      const sightPath = document.createElementNS(svgNs, "path");
      sightEl.append(sightPath);
      map.getCanvasContainer().append(sightEl);
      sightSvg.current = { svg: sightEl, path: sightPath, key: "" };
      setMapReady(true);
      capLayer.current = makeFootprintLayer({
        // It fails inside a frame: change the style after it.
        onFail: () => {
          capFailed.current = true;
          queueMicrotask(syncFill);
        },
      });
      pushFootprint(liveFocus(latest.current.sats));
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      syncZoomAround(map, useFollow.getState().following);
      syncGestures();
      const canvas = map.getCanvas();
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "Map of followed satellites");
      canvas.tabIndex = 0;
      // MapLibre opens the compact attribution at start and folds it only on a
      // drag, which cooperative gestures never send on a phone. Fold it once the
      // map has drawn, as its info button does; that button still opens it.
      map.once("idle", () => {
        settled.current = true;
        foldAttribution(map);
      });
      // A flat home camera already centres on a focus that exists now; the
      // globe's centres on the observer, so it still eases to the focus.
      const { observer: o, view: v, sats: s0 } = latest.current;
      if (homeCentresFocus(v, { observer: o, focus: focusOf(s0) })) centreOn.current = null;

      map.on("style.load", () => {
        styleReady.current = true;
        const colors = overlayColors(themeRef.current);
        refreshNight(map.getZoom());
        const data = sourceData(map, true);
        data["ss-night"] = night.current?.data;
        addOverlays(map, {
          images: overlayImages(colors),
          layers: overlayLayers(colors) as LayerSpecification[],
          data,
          custom: capLayer.current ? [capLayer.current] : [],
        });
        map.setProjection({ type: PROJECTION_OF[latest.current.view] });
        syncGrid(map, true);
        layoutGridLabels(map);
        fillHidden.current = false;
        syncFill();
        limitZoom(map);
      });
      // A tap on a dot (or its name) selects the nearest one; hidden satellites are not in the layers.
      map.on("click", (e: MapMouseEvent) => {
        if (!styleReady.current) return;
        const { x, y } = e.point;
        const hits = map.queryRenderedFeatures([[x - HIT_PX, y - HIT_PX], [x + HIT_PX, y + HIT_PX]], { layers: SAT_LAYERS });
        let best: number | null = null;
        let bestD = Infinity;
        // The world copy nearest the tap.
        const nearest = (lon: number, lat: number) => map.project([e.lngLat.lng + wrapLon(lon - e.lngLat.lng), lat]);
        for (const f of hits) {
          if (f.geometry.type !== "Point") continue;
          const [lon, lat] = f.geometry.coordinates;
          const p = nearest(lon, lat);
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < bestD) {
            bestD = d;
            best = Number(f.properties?.noradId);
          }
        }
        // The focus marker, as the layers count a dot: the tap box reaching
        // its dot or its name. Not on the far side of the globe.
        const mark = focusMark.current;
        const focusId = latest.current.sats.find((s) => s.emphasis === "focus")?.noradId;
        if (mark?.shown && focusId != null && mark.el.style.visibility !== "hidden" && !mark.el.classList.contains("maplibregl-marker-covered")) {
          const ll = mark.marker.getLngLat();
          const p = nearest(ll.lng, ll.lat);
          const c = map.getCanvas().getBoundingClientRect();
          const r = mark.name.getBoundingClientRect();
          const onDot = Math.abs(p.x - x) <= HIT_PX && Math.abs(p.y - y) <= HIT_PX;
          const onName = r.width > 0
            && x + HIT_PX >= r.left - c.left && x - HIT_PX <= r.right - c.left
            && y + HIT_PX >= r.top - c.top && y - HIT_PX <= r.bottom - c.top;
          const d = Math.hypot(p.x - x, p.y - y);
          if ((onDot || onName) && d < bestD) {
            bestD = d;
            best = focusId;
          }
        }
        // Your location marker, when no satellite was hit: pan to it, at
        // the zoom you are at.
        if (best == null) {
          const you = map.queryRenderedFeatures([[x - HIT_PX, y - HIT_PX], [x + HIT_PX, y + HIT_PX]], { layers: ["ss-observer"] });
          if (you.length) {
            panToYou.current?.();
            return;
          }
        }
        if (best == null || !Number.isFinite(best)) return;
        // A tap on the focused satellite leaves it, unless it was the first
        // click of a double-click (a zoom): MapLibre sends a click for each.
        if (best === focusId) {
          // The second click of a double that already cancelled the leave.
          if (performance.now() - leaveCancelledAt < DBLCLICK_MS) return;
          window.clearTimeout(leaveTimer.current);
          leaveTimer.current = window.setTimeout(() => {
            leaveTimer.current = undefined;
            latest.current.onSelect(null);
          }, DBLCLICK_MS);
        } else latest.current.onSelect(best);
      });
      // A pointing hand over what a click acts on (a satellite or your
      // location marker), checked at most once a frame.
      let hoverRaf = 0;
      let hoverAt: { x: number; y: number } | null = null;
      map.on("mousemove", (e: MapMouseEvent) => {
        hoverAt = e.point;
        if (hoverRaf) return;
        hoverRaf = requestAnimationFrame(() => {
          hoverRaf = 0;
          if (!styleReady.current || !hoverAt) return;
          const { x, y } = hoverAt;
          const hits = map.queryRenderedFeatures([[x - HIT_PX, y - HIT_PX], [x + HIT_PX, y + HIT_PX]], { layers: [...SAT_LAYERS, "ss-observer"] });
          map.getCanvas().style.cursor = hits.length ? "pointer" : "";
        });
      });
      map.on("mouseout", () => { map.getCanvas().style.cursor = ""; });
      // A second click or tap, or a zoom by hand, means it was not a plain
      // tap: on touch MapLibre's double-tap zoom stops the second click and
      // dblclick, and with Lock on no double-tap zoom stops the second click.
      // Lock on's own jumps change the globe's zoom with latitude, so only a
      // zoom with an originalEvent counts.
      let leaveCancelledAt = -Infinity;
      const cancelLeave = () => {
        if (leaveTimer.current === undefined) return;
        window.clearTimeout(leaveTimer.current);
        leaveTimer.current = undefined;
        leaveCancelledAt = performance.now();
      };
      map.on("dblclick", cancelLeave);
      map.on("zoomstart", (e: { originalEvent?: Event }) => {
        if (e.originalEvent) cancelLeave();
      });
      map.on("touchstart", cancelLeave);
      // Moves by hand (drag, wheel, touch, keys) leave the home view; ours
      // carry no originalEvent. A single wheel tick starts its move without
      // one, so the wheel handler is asked too.
      const release = () => {
        if (useFollow.getState().following) setFollowing(false);
      };
      map.on("movestart", (e: { originalEvent?: Event }) => {
        if (!e.originalEvent && !map.scrollZoom.isActive()) return;
        atHome.current = false;
        // Only a pan lets go of Lock on: zooms keep the satellite centred.
        // Keyboard panning (the arrows) arrives as an ease, not a drag.
        const ev = e.originalEvent;
        if (ev instanceof KeyboardEvent && ev.key.startsWith("Arrow")) release();
      });
      // A mouse or one-finger drag is a pan. Two fingers may be a pinch, whose
      // centre drifts a little, so that touch decides when the last finger
      // lifts: a pan unless it zoomed.
      // (A touch's inertia can zoom after the lift; it belongs to no gesture.)
      const touch = { down: false, panned: false, zoomed: false };
      const isTouch = (ev?: Event): ev is TouchEvent => typeof TouchEvent !== "undefined" && ev instanceof TouchEvent;
      map.on("touchstart", (e: MapTouchEvent) => {
        const t = e.originalEvent;
        if (t.touches.length === t.changedTouches.length) Object.assign(touch, { down: true, panned: false, zoomed: false });
        handHeld.current = true;
      });
      map.on("dragstart", (e: { originalEvent?: Event }) => {
        const ev = e.originalEvent;
        if (isTouch(ev) && ev.touches.length > 1) touch.panned = true;
        else release();
      });
      map.on("zoomstart", (e: { originalEvent?: Event }) => {
        if (touch.down && isTouch(e.originalEvent)) touch.zoomed = true;
      });
      const lift = (e: MapTouchEvent) => {
        if (e.originalEvent.touches.length > 0) return;
        handHeld.current = false;
        if (!touch.down) return;
        touch.down = false;
        if (e.type === "touchend" && touch.panned && !touch.zoomed) release();
      };
      map.on("touchend", lift);
      map.on("touchcancel", lift);
      // Only the primary button drags (ctrl-click on a Mac is a right click).
      map.on("mousedown", (e: MapMouseEvent) => {
        const ev = e.originalEvent;
        if (ev.button !== 0 || (ev.ctrlKey && isMac())) return;
        handHeld.current = true;
      });
      // MapLibre's double-click zoom centres on the pointer, so while
      // following it is off (syncZoomAround) and this zooms about the centre.
      // It starts after MapLibre's own handling of the event, which stops any
      // camera move begun inside a listener while a handler is active.
      map.on("dblclick", (e: MapMouseEvent) => {
        if (!useFollow.getState().following) return;
        lockZoomBy(map, e.originalEvent.shiftKey ? -1 : 1);
      });
      // Following, the wheel and the +/- keys zoom through the frame loop too
      // (MapLibre's scroll zoom is off then; its keyboard handler is skipped).
      const box = map.getCanvasContainer();
      const onWheel = (e: WheelEvent) => {
        if (!useFollow.getState().following) return;
        // Cooperative gestures: a plain wheel scrolls the page, as MapLibre's does.
        const coop = map.cooperativeGestures;
        if (coop.isEnabled() && !e.ctrlKey && !coop.isBypassed(e)) {
          coop.notifyGestureBlocked("wheel_zoom", e);
          return;
        }
        e.preventDefault();
        const { dz, wheel } = wheelZoom(e);
        // A trackpad pinch sends a stream of small steps: each lands on the
        // next frame, as MapLibre's own trackpad zoom does. Easing each one
        // left the zoom trailing the fingers.
        if (dz) lockZoomBy(map, dz, wheel ? LOCK_ZOOM_MS : 0);
      };
      const onKey = (e: KeyboardEvent) => {
        if (!useFollow.getState().following || e.altKey || e.ctrlKey || e.metaKey) return;
        const dir = e.key === "+" || e.key === "=" ? 1 : e.key === "-" || e.key === "_" ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        e.stopPropagation();
        lockZoomBy(map, dir * (e.shiftKey ? 2 : 1));
      };
      box.addEventListener("wheel", onWheel, { passive: false });
      box.addEventListener("keydown", onKey, { capture: true });
      detach = () => {
        box.removeEventListener("wheel", onWheel);
        box.removeEventListener("keydown", onKey, { capture: true });
      };
      // Zoomed in past home, a stacked map takes one-finger and wheel gestures.
      // A follow jump keeps the Earth's size, so it skips this and the push.
      map.on("zoomend", () => {
        if (!selfJump.current) syncGestures();
      });
      map.on("move", () => layoutGridLabels(map));
      // The camera moved or the map drew: the line follows in the same frame.
      map.on("render", () => drawSight(map));
      let sightRaf = 0;
      map.on("move", () => {
        if (!sightRaf) sightRaf = requestAnimationFrame(() => { sightRaf = 0; syncSightLabels(map); });
      });
      // Past zoom 11 the globe flattens toward Mercator and the GeoJSON fill takes over.
      map.on("zoom", syncFill);
      // Zooming changes which tracks are too short for direction marks.
      map.on("moveend", () => {
        if (styleReady.current) syncGrid(map);
        if (!selfJump.current) push();
      });
      // MapLibre follows its container; an untouched home view refits to it.
      map.on("resize", () => {
        limitZoom(map);
        if (atHome.current) map.jumpTo(homeView(map));
        layoutGridLabels(map);
      });
    })();
    return () => {
      alive = false;
      window.clearTimeout(leaveTimer.current);
      window.removeEventListener("mouseup", letGo);
      window.removeEventListener("blur", letGo);
      window.removeEventListener("contextmenu", letGo);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("scroll", onScroll);
      detach?.();
      styleReady.current = false;
      mapRef.current = null;
      capLayer.current = null;
      focusMark.current?.marker.remove();
      focusMark.current = null;
      sightSvg.current?.svg.remove();
      sightSvg.current = null;
      setMapReady(false);
      made?.remove();
    };
    // Made once (the callbacks are stable); later props reach it through
    // latest and the effects below.
  }, [refreshNight, sourceData, push, homeView, syncGestures, setFollowing, limitZoom, syncFill, pushFootprint, liveFocus, syncZoomAround, lockZoomBy]);

  // Docked or not: switches the gesture mode.
  useEffect(() => {
    if (!fill || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(DOCKED_QUERY);
    const sync = () => {
      docked.current = mq.matches;
      syncGestures();
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [fill, syncGestures]);
  useEffect(() => {
    syncGestures();
  }, [full, syncGestures]);
  // Lock on keeps zooms about the satellite; off, they follow the pointer again.
  // Turned on from the focus bar, it first eases to where the satellite will
  // be when the ease ends, then the frame loop's jumps take over (they wait
  // for the ease). The Satellite GP preset is already easing there.
  useEffect(() => {
    if (!followOn) zoomGoal.current = null;
    const map = mapRef.current;
    if (map) syncZoomAround(map, followOn);
    if (map && followOn && !map.isMoving() && !reducedMotion()) {
      const f = liveFocus(latest.current.sats, mapNow() + LOCK_EASE_MS);
      if (f) {
        const c = map.project(map.getCenter());
        const p = map.project([f.lonDeg, f.latDeg]);
        if (Math.hypot(p.x - c.x, p.y - c.y) > LOCK_EASE_PX) {
          atHome.current = false;
          map.easeTo({ center: [f.lonDeg, f.latDeg], duration: LOCK_EASE_MS });
        }
      }
    }
    frames.current?.wake();
  }, [followOn, syncZoomAround, liveFocus]);

  const toggleFull = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (fullRef.current) {
      if (nativeFull.current && document.fullscreenElement) document.exitFullscreen().catch(() => setFull(false));
      else setFull(false);
      return;
    }
    if (document.fullscreenEnabled && shell.requestFullscreen) {
      nativeFull.current = true;
      shell.requestFullscreen().then(
        () => setFull(true),
        () => {
          nativeFull.current = false;
          setFull(true);
        },
      );
    } else {
      nativeFull.current = false;
      setFull(true);
    }
  }, []);

  // Keep state in step with the browser (Esc in native full screen) and
  // handle the CSS fallback: Esc exits, and the page behind stops scrolling.
  useEffect(() => {
    const onChange = () => {
      const active = document.fullscreenElement === shellRef.current;
      if (active || nativeFull.current) {
        setFull(active);
        if (!active) nativeFull.current = false;
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  useEffect(() => {
    if (!full) return;
    const fallback = !nativeFull.current;
    const onKey = (e: KeyboardEvent) => {
      // An open dialog over the map (the layers menu) takes Esc first.
      if (e.key === "Escape" && fallback && !(e.target as Element | null)?.closest?.('[role="dialog"]')) {
        // Leaving full screen is all this Esc does (it does not also clear focus).
        e.preventDefault();
        setFull(false);
      }
    };
    if (fallback) document.body.style.overflow = "hidden";
    // Capture, so this runs (and marks Esc handled) before any bubble listener.
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      if (fallback) document.body.style.overflow = "";
    };
  }, [full]);

  // A new view starts from its home camera.
  const shownView = useRef(view);
  useEffect(() => {
    const prev = shownView.current;
    if (prev === view) return;
    shownView.current = view;
    setFollowing(false);
    const map = mapRef.current;
    if (!map) return;
    // Before the style loads, style.load applies the projection.
    if (styleReady.current) map.setProjection({ type: PROJECTION_OF[view] });
    // The old view's floor could hold the new camera back.
    map.setMinZoom(null);
    atHome.current = true;
    map.jumpTo(homeView(map));
    limitZoom(map);
    syncFill();
    syncGestures();
    // With the live view open, frame it again as it framed on opening (a
    // paused pass reframes itself).
    if (useMapClock.getState().liveView) useFollow.getState().fitFootprint();
  }, [view, homeView, setFollowing, limitZoom, syncFill, syncGestures]);

  // An untouched home view follows the observer (it arrives after mount, once
  // prefs load). Choosing a new place moves there even if the map was moved:
  // it is a deliberate change of where you are.
  const obsLon = observer?.lonDeg ?? null;
  const obsLat = observer?.latDeg ?? null;
  const lastObs = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    const key = obsLon == null || obsLat == null ? null : `${obsLon},${obsLat}`;
    const moved = lastObs.current != null && key != null && key !== lastObs.current;
    if (key != null) lastObs.current = key;
    if (!map) return;
    if (moved) {
      // The open pass closes with the new place (and the map goes live): do
      // not go back to the camera from before it.
      beforePause.current = null;
      atHome.current = true;
      setFollowing(false);
    }
    if (atHome.current) refitHome(map);
  }, [obsLon, obsLat, refitHome, setFollowing]);
  // An untouched flat home view refits when the dots first arrive or the set
  // shown changes, so they are in view; not on every tick as they move.
  const dotsKey = sats.filter((s) => s.emphasis !== "hidden").map((s) => s.noradId).join(",");
  useEffect(() => {
    const map = mapRef.current;
    if (map && atHome.current && view === "flat") refitHome(map);
  }, [dotsKey, view, refitHome]);

  // The opened pass's rise and set: a dot and its time each, as HTML markers
  // (like the focus name), which MapLibre hides on the far side of the globe;
  // its own text labels there showed through the Earth.
  const centreOnYou = useRef<(() => void) | null>(null);
  /** A tap on your location marker: pan to it, keeping the zoom. */
  const panToYou = useRef<(() => void) | null>(null);
  const markerOf = useRef<(typeof import("maplibre-gl"))["Marker"] | null>(null);
  const endMarks = useRef<{ marker: Marker; el: HTMLElement; time: HTMLElement }[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    const MarkerCtor = markerOf.current;
    if (!map || !mapReady || !MarkerCtor) return;
    const sat = sats.find((s) => s.passEnds?.length);
    const ends = sat?.passEnds ?? [];
    const marks = endMarks.current;
    while (marks.length > ends.length) marks.pop()?.marker.remove();
    ends.forEach((end, i) => {
      let m = marks[i];
      if (!m) {
        const el = document.createElement("div");
        el.className = "flat-map__end";
        el.setAttribute("aria-hidden", "true");
        const dot = document.createElement("span");
        dot.className = "flat-map__end-dot";
        const time = document.createElement("span");
        time.className = "flat-map__end-time";
        el.append(dot, time);
        m = { marker: new MarkerCtor({ element: el, subpixelPositioning: true, opacityWhenCovered: "0" }), el, time };
        marks.push(m);
        m.marker.setLngLat([end.lonDeg, end.latDeg]).addTo(map);
      }
      if (sat) m.el.style.setProperty("--end-color", sat.color);
      if (m.time.textContent !== end.label) m.time.textContent = end.label;
      m.marker.setLngLat([end.lonDeg, end.latDeg]);
    });
    // Each time sits on the outer side of its dot, away from the observer
    // (the ends lie on the visibility circle), so it clears the pass line
    // and the satellite's own label. Kept as the camera moves.
    const o = latest.current.observer;
    if (!marks.length || !o) return;
    let raf = 0;
    const place = () => {
      raf = 0;
      const po = map.project([o.lonDeg, o.latDeg]);
      marks.forEach((m, i) => {
        const end = ends[i];
        if (!end) return;
        const p = map.project([end.lonDeg, end.latDeg]);
        const dx = p.x - po.x;
        const dy = p.y - po.y;
        const len = Math.hypot(dx, dy) || 1;
        m.el.style.setProperty("--label-nx", (dx / len).toFixed(3));
        m.el.style.setProperty("--label-ny", (dy / len).toFixed(3));
      });
    };
    const onMove = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };
    place();
    map.on("move", onMove);
    return () => {
      map.off("move", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [sats, mapReady]);
  useEffect(() => () => {
    for (const m of endMarks.current) m.marker.remove();
    endMarks.current = [];
  }, []);

  /** The zoom at which a ring (a closed [lon, lat] line) around `center`
   *  fills the view inside `pad`: the camera is tried at a zoom, the ring
   *  measured on screen and the zoom corrected, then put back. Those trial
   *  jumps are ours (selfJump), so nothing else reacts to them. */
  const fitRingZoom = useCallback((
    map: MlMap, center: LngLat, ring: number[][],
    pad: { top: number; bottom: number; left: number; right: number }, start: number,
  ): number => {
    const el = map.getContainer();
    const availW = (el.clientWidth || 1) - pad.left - pad.right;
    const availH = (el.clientHeight || 1) - pad.top - pad.bottom;
    const was = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
    let zoom = start;
    selfJump.current = true;
    try {
      for (let i = 0; i < 4; i++) {
        map.jumpTo({ center, zoom });
        const o = map.project(center);
        let mx = 0;
        let my = 0;
        for (const [lon, lat] of ring) {
          const q = map.project([lon, lat]);
          mx = Math.max(mx, Math.abs(q.x - o.x));
          my = Math.max(my, Math.abs(q.y - o.y));
        }
        const scale = Math.min(availW / (2 * mx), availH / (2 * my));
        if (!Number.isFinite(scale) || scale <= 0) break;
        const next = Math.min(7, Math.max(map.getMinZoom(), zoom + Math.log2(scale)));
        const done = Math.abs(next - zoom) < 0.01;
        zoom = next;
        if (done) break;
      }
    } finally {
      map.jumpTo(was);
      selfJump.current = false;
    }
    return zoom;
  }, []);

  // The docked live view asks for a framing as it opens. With its pass open
  // (a visibility circle known), the circle centred on you, widened to take
  // in the satellite before it rises: you, the satellite and its whole pass
  // in view, with no lock (the circle holds the pass while it is up).
  // Otherwise (a high orbit, or opened from the Up now line) it stays locked
  // on, zoomed so the satellite's footprint fills the map.
  const fitTick = useFollow((s) => s.fitTick);
  const fitDone = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || fitTick === fitDone.current) return;
    const f = liveFocus(latest.current.sats);
    const sat = latest.current.sats.find((x) => x.selected);
    const o = latest.current.observer;
    const el = map.getContainer();
    const h = el.clientHeight || 1;
    const w = el.clientWidth || 1;
    const pad = { top: Math.min(60, h / 4), bottom: Math.min(48, h / 4), left: Math.min(24, w / 6), right: Math.min(24, w / 6) };
    const passRing = sat?.passRing;
    if (f && o && passRing && passRing.length > 2) {
      fitDone.current = fitTick;
      setFollowing(false);
      const center: LngLat = [o.lonDeg, o.latDeg];
      const zoom = fitRingZoom(map, center, [...passRing, [f.lonDeg, f.latDeg]], pad, map.getZoom());
      atHome.current = false;
      moveTo(map, { center, zoom });
      return;
    }
    // No circle (a high orbit, whose circle would cover half the planet) but
    // its pass known: frame you, the satellite and the pass track together.
    const path = sat?.passPath ? (sat.passPath.coordinates as number[][][]).flat() : [];
    if (f && o && path.length > 1) {
      fitDone.current = fitTick;
      setFollowing(false);
      const pts = [...path, [o.lonDeg, o.latDeg], [f.lonDeg, f.latDeg]];
      // Longitudes unwrapped around you, so a track over the date line frames as one piece.
      const lons = pts.map(([lon]) => lon + 360 * Math.round((o.lonDeg - lon) / 360));
      const lats = pts.map(([, lat]) => lat);
      const cam = map.cameraForBounds(
        [[Math.min(...lons), Math.max(-85, Math.min(...lats))], [Math.max(...lons), Math.min(85, Math.max(...lats))]],
        { padding: pad, maxZoom: 7 },
      );
      if (!cam?.center) return;
      const c = cam.center as { lng: number; lat: number } | [number, number];
      atHome.current = false;
      moveTo(map, { center: Array.isArray(c) ? c : [c.lng, c.lat], zoom: cam.zoom ?? map.getZoom() });
      return;
    }
    const ring = (sat?.footprint?.coordinates as number[][][] | undefined)?.[0];
    if (!f || !ring || ring.length < 3) return;
    fitDone.current = fitTick;
    const center: LngLat = [f.lonDeg, f.latDeg];
    const zoom = fitRingZoom(map, center, ring, pad, map.getZoom());
    atHome.current = false;
    moveTo(map, { center, zoom });
  }, [fitTick, sats, mapReady, liveFocus, fitRingZoom, moveTo, setFollowing]);

  // A paused pass frames its path and the observer, again after a switch
  // between the globe and Mercator; Back to live (or closing the row) returns
  // the camera to where it was (or the new view's home, after a switch).
  const framedKey = useRef<string | null>(null);
  // Stacked, the map grows while paused (MapLayoutShell): frame again once
  // it has settled at its new size.
  const [reframe, setReframe] = useState(0);
  // The satellite whose pass is open (paused on it, or live while it is up).
  const openSat = sats.find((x) => x.passPath && (x.passPath.coordinates as unknown[]).length) ?? null;
  const passOpen = openSat != null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !passOpen) return;
    let t: number | undefined;
    const onResize = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        framedKey.current = null;
        setReframe((n) => n + 1);
      }, 150);
    };
    map.on("resize", onResize);
    return () => {
      window.clearTimeout(t);
      map.off("resize", onResize);
    };
  }, [mapReady, passOpen]);
  const beforePause = useRef<{ cam: Camera; atHome: boolean; view: View } | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    // An opened pass is framed whether the map is paused on it or it is up
    // now (live); closing it puts the camera back.
    const sat = openSat;
    if (!sat?.passPath) {
      framedKey.current = null;
      const b = beforePause.current;
      beforePause.current = null;
      if (b) {
        const sameView = b.view === view;
        atHome.current = b.atHome || !sameView;
        if (atHome.current) refitHome(map);
        else moveTo(map, b.cam);
      }
      return;
    }
    const passKey = paused ? paused.key : `${sat.noradId}:${shapeId(sat.passPath)}`;
    const frameKey = `${passKey}|${view}`;
    if (framedKey.current === frameKey) return;
    // A projection switch jumps to the new view's home first: frame from
    // there at once rather than easing across it.
    const switched = framedKey.current != null && framedKey.current.startsWith(`${passKey}|`);
    framedKey.current = frameKey;
    if (!beforePause.current) {
      const c = map.getCenter();
      beforePause.current = { cam: { center: [c.lng, c.lat], zoom: map.getZoom() }, atHome: atHome.current, view };
    }
    setFollowing(false);
    // Frame the visibility circle, centred on the observer: every visible
    // pass runs inside it, so you and the whole pass are in view. Without it,
    // the path and the observer.
    let lons: number[];
    let lats: number[];
    const reach = sat.passReachDeg;
    if (observer && reach && reach > 0) {
      const dLon = Math.min(179, reach / Math.max(0.05, Math.cos((observer.latDeg * Math.PI) / 180)));
      lons = [observer.lonDeg - dLon, observer.lonDeg + dLon];
      lats = [Math.max(-89, observer.latDeg - reach), Math.min(89, observer.latDeg + reach)];
    } else {
      const pts = (sat.passPath.coordinates as number[][][]).flat();
      if (observer) pts.push([observer.lonDeg, observer.latDeg]);
      // Live, where the satellite is now too.
      if (!paused) pts.push([sat.position.lonDeg, sat.position.latDeg]);
      // Longitudes unwrapped around the first point, so a path over the date
      // line frames as one piece.
      const ref = pts[0][0];
      lons = pts.map(([lon]) => lon + 360 * Math.round((ref - lon) / 360));
      lats = pts.map(([, lat]) => lat);
    }
    const el = map.getContainer();
    const h = el.clientHeight || 1;
    const w = el.clientWidth || 1;
    // Room for the chips row on top and the paused chip below.
    // Even top and bottom, so the observer stays in the middle.
    const pad = { top: Math.min(60, h / 4), bottom: Math.min(60, h / 4), left: Math.min(24, w / 6), right: Math.min(24, w / 6) };
    const cam = map.cameraForBounds(
      [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: pad, maxZoom: 7 },
    );
    if (!cam?.center) return;
    const c = cam.center as { lng: number; lat: number } | [number, number];
    const ring = sat.passRing;
    let zoom: number = cam.zoom ?? map.getZoom();
    let center: LngLat = Array.isArray(c) ? c : [c.lng, c.lat];
    if (observer && reach && reach > 0) {
      // Centred on you, zoomed so the circle's own outline fills the view: a
      // box around it leaves room at the corners, more so on the globe. The
      // camera is tried at a zoom, the circle measured on screen and the zoom
      // corrected, then put back before the eased move. Those trial jumps are
      // ours (selfJump), so nothing else reacts to them.
      center = [observer.lonDeg, observer.latDeg];
      // Live, take in the satellite too (before it rises it is outside).
      if (ring && ring.length > 2) zoom = fitRingZoom(map, center, paused ? ring : [...ring, [sat.position.lonDeg, sat.position.latDeg]], pad, zoom);
    }
    atHome.current = false;
    if (switched) map.jumpTo({ center, zoom });
    else moveTo(map, { center, zoom });
  }, [paused, openSat, observer, view, mapReady, moveTo, refitHome, setFollowing, reframe, fitRingZoom]);

  // Entering a focus moves once to centre it, keeping the zoom. It waits for
  // the satellite to have a position, then leaves the camera alone.
  useEffect(() => {
    centreOn.current = selectedId;
    setFollowing(false);
    // A pending leave was for the previous selection.
    window.clearTimeout(leaveTimer.current);
  }, [selectedId, setFollowing]);
  // The parent's clock tick passes new props each second. The frame loop
  // moves the cap while it runs; paused, or with no focus, this does.
  useEffect(() => {
    if (!frames.current?.running()) pushFootprint(liveFocus(latest.current.sats));
    const map = mapRef.current;
    const id = centreOn.current;
    if (map && id != null) {
      const sat = sats.find((s) => s.noradId === id && s.emphasis === "focus");
      if (sat) {
        centreOn.current = null;
        // Off home now, so a resize or a new observer leaves the satellite centred.
        atHome.current = false;
        // No zoom: on the globe MapLibre then keeps the Earth the same size as
        // the centre's latitude changes; passing the current zoom number
        // shrank it far out when the focus was nearer the equator.
        // The live position, not the props one: a satellite page's first
        // props come from its cached render time, up to an hour old.
        const at = sat.positionAt(mapNow()) ?? sat.position;
        moveTo(map, { center: [at.lonDeg, at.latDeg] });
      }
    }
    // Out of view (a phone scrolled down to the list), the push waits until
    // the map shows again.
    if (mapInView.current) push();
    else pushWaiting.current = true;
  }, [sats, observer, selectedId, minElevDeg, push, pushFootprint, moveTo, liveFocus]);

  // A Share button reads the camera: none while it is the untouched home view
  // (each visitor gets their own), else the zoom and, unless locked, the centre.
  useEffect(() => registerCameraReader(() => {
    const map = mapRef.current;
    if (!map) return null;
    const lock = useFollow.getState().following;
    if (atHome.current && !lock) return { zoom: null, center: null, lock: false };
    const c = map.getCenter().wrap();
    return { zoom: discZoom(latest.current.view, map.getZoom(), c.lat), center: [c.lng, c.lat], lock };
  }), []);
  // A shared link's camera, once the map shows its view (and, to lock on,
  // the focus has a position). Dropped if that takes too long.
  useEffect(() => {
    const cam = peekPendingCamera();
    const map = mapRef.current;
    if (!cam || !map || !mapReady) return;
    if (Date.now() - cam.at > SHARED_CAMERA_MS) {
      setPendingCamera(null);
      return;
    }
    if (cam.view !== view) return;
    const f = cam.lock ? liveFocus(latest.current.sats) : null;
    if (cam.lock && !f) return;
    const center: [number, number] | null = f ? [f.lonDeg, f.latDeg] : cam.center;
    if (!center) {
      setPendingCamera(null);
      return;
    }
    setPendingCamera(null);
    centreOn.current = null;
    atHome.current = false;
    const zoom = cam.zoom == null ? map.getZoom()
      : view === "globe" ? cam.zoom + Math.log2(Math.cos((Math.min(Math.abs(center[1]), 85.05) * Math.PI) / 180)) : cam.zoom;
    map.jumpTo({ center, zoom });
    if (cam.lock) setFollowing(true);
  }, [sats, view, mapReady, liveFocus, setFollowing]);

  // Between props, move the other dots and the GeoJSON footprint every
  // DOT_MS, and the focus while the frame loop idles. Nothing here sets
  // React state. It stops while the tab is hidden or the map is out of view.
  useEffect(() => {
    let id: number | undefined;
    const tick = () => {
      frames.current?.tick();
      const map = mapRef.current;
      if (!map || !styleReady.current) return;
      // Only what moves: the dots, the focus footprint while there is one,
      // and the night bands when due. The observer and an emptied footprint
      // go with push().
      const moved = liveSats(false);
      const data = buildData({ sats: moved, tracks: false, marks: false });
      const footprint = data["ss-footprint"] as { features: unknown[] };
      // A live pass's sight line label, at the line's middle. The line itself
      // is drawn with the dot (drawSight).
      const live = moved.filter((x) => x.passLive);
      const sight = live.length > 0
        ? { type: "FeatureCollection", features: live.flatMap((x) => sightFeatures(x, latest.current.observer)) }
        : null;
      setOverlayData(map, {
        "ss-sats": data["ss-sats"],
        ...(footprint.features.length > 0 && { "ss-footprint": footprint }),
        ...(sight ? { "ss-sight": sight } : {}),
        ...(refreshNight(map.getZoom()) && { "ss-night": night.current?.data }),
      });
      if (live.length > 0) syncSightLabels(map);
    };
    const stop = () => {
      if (id !== undefined) window.clearInterval(id);
      id = undefined;
    };
    // On phones the stacked map scrolls away under the list: no ticks then.
    const start = () => {
      stop();
      if (document.hidden || !mapInView.current) return;
      // Back in view: catch up now rather than on the next tick.
      if (pushWaiting.current) {
        pushWaiting.current = false;
        push();
      }
      tick();
      id = window.setInterval(tick, DOT_MS);
    };
    const el = glRef.current;
    const io = el && typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
        mapInView.current = entries[entries.length - 1].isIntersecting;
        start();
      })
      : null;
    if (el) io?.observe(el);
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      document.removeEventListener("visibilitychange", start);
      io?.disconnect();
      stop();
    };
  }, [liveSats, refreshNight, push, syncSightLabels]);

  // Every frame while a satellite is focused, the map is made and in view, the
  // tab shows, and the dot moves visibly per frame (or Lock on is on): place
  // the focus once at the frame's time, and from it the marker, the globe cap
  // and a following camera, with Lock on's zoom. A jump draws the map at once,
  // so the canvas and the marker show the same instant. Otherwise the DOT_MS
  // tick places the focus. Nothing here sets React state.
  const hasFocus = sats.some((s) => s.emphasis === "focus");
  useEffect(() => {
    const map = mapRef.current;
    if (!hasFocus || !mapReady || !map) return;
    let id: number | undefined;
    let settle: number | undefined;
    // On phones the stacked map scrolls away: no frames then.
    let inView = true;
    // Whether the dot moves over FRAME_PX per DOT_MS at this camera.
    let fast = true;
    const measure = () => {
      const f = latest.current.sats.find((x) => x.emphasis === "focus");
      const ms = mapNow();
      const a = f?.positionAt(ms);
      const b = f?.positionAt(ms + DOT_MS);
      if (!a || !b) {
        fast = false;
        return;
      }
      const pa = map.project([a.lonDeg, a.latDeg]);
      const pb = map.project([a.lonDeg + wrapLon(b.lonDeg - a.lonDeg), b.latDeg]);
      fast = Math.hypot(pb.x - pa.x, pb.y - pa.y) > FRAME_PX;
    };
    const frame = (at?: number) => {
      // Asked first, so next frame this runs ahead of the map's own render.
      id = requestAnimationFrame(frame);
      // The frame's own time rather than the moment this runs, which wanders
      // by a few ms: the dot then steps evenly.
      const now = performance.now();
      const ms = at === undefined ? mapNow() : mapNow() + at - now;
      const f = liveFocus(latest.current.sats, ms);
      pushFootprint(f);
      placeMark(map, f);
      // A live sight line ends on the dot: drawn with it, in the same frame.
      drawSight(map);
      if (zoomGoal.current && !useFollow.getState().following) zoomGoal.current = null;
      const z = zoomGoal.current ? goalAt(zoomGoal.current, at ?? now) : null;
      if (followJump(map, f, z?.zoom)) {
        map.redraw();
        if (z?.done) {
          // Its own jumps skip zoomend's and moveend's work: do it once, when
          // no further zoom follows.
          zoomGoal.current = null;
          window.clearTimeout(settle);
          settle = window.setTimeout(() => {
            if (zoomGoal.current) return;
            syncGestures();
            push();
            measure();
          }, LOCK_SETTLE_MS);
        }
      }
    };
    const stop = () => {
      if (id !== undefined) cancelAnimationFrame(id);
      id = undefined;
    };
    /** Place the focus now, as a frame would. */
    const place = () => {
      const f = liveFocus(latest.current.sats);
      pushFootprint(f);
      placeMark(map, f);
    };
    const wanted = () =>
      !document.hidden && inView && (fast || useFollow.getState().following || zoomGoal.current != null);
    const sync = () => {
      if (!wanted()) {
        if (id !== undefined) {
          stop();
          place();
        }
      } else if (id === undefined) frame();
    };
    const remeasure = () => {
      measure();
      sync();
    };
    frames.current = {
      running: () => id !== undefined,
      wake: sync,
      measure: remeasure,
      tick: () => {
        remeasure();
        if (id === undefined) place();
      },
    };
    measure();
    if (wanted()) frame();
    else place();
    const io = typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
        inView = entries[entries.length - 1].isIntersecting;
        sync();
      })
      : null;
    io?.observe(map.getContainer());
    map.on("zoomend", remeasure);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearTimeout(settle);
      document.removeEventListener("visibilitychange", sync);
      map.off("zoomend", remeasure);
      io?.disconnect();
      frames.current = null;
      stop();
      const mark = focusMark.current;
      if (mark?.shown) {
        mark.marker.remove();
        mark.shown = false;
      }
    };
  }, [hasFocus, mapReady, liveFocus, pushFootprint, placeMark, followJump, syncGestures, push, drawSight]);
  // A new focus moves at its own speed.
  const focusKey = sats.find((s) => s.emphasis === "focus")?.noradId ?? null;
  useEffect(() => {
    frames.current?.measure();
  }, [focusKey]);

  const reset = () => {
    const map = mapRef.current;
    if (!map) return;
    atHome.current = true;
    setFollowing(false);
    moveTo(map, homeView(map));
  };
  const focusNow = focusOf(sats);
  // Only the views that can go somewhere: On you needs a location, Satellite
  // GP a satellite.
  const presetsNow = PRESETS.filter((p) => (p.id !== "you" || observer) && (p.id !== "sat" || focusNow));
  const goTo = (p: Preset) => {
    const map = mapRef.current;
    if (!map) return;
    const el = map.getContainer();
    const cam = preset(p, {
      observer,
      focus: focusNow,
      width: el.clientWidth || 1,
      height: el.clientHeight || 1,
      date: new Date(mapNow()),
    });
    if (!cam) return;
    atHome.current = false;
    setFollowing(p === "sat");
    moveTo(map, { center: cam.center, zoom: easeZoom(map.getZoom(), cam.zoom) });
  };
  // Picking your place again: On you on the globe, the home view on Mercator.
  centreOnYou.current = () => (view === "globe" && observer ? goTo("you") : reset());
  panToYou.current = () => {
    const map = mapRef.current;
    if (!map || !observer) return;
    atHome.current = false;
    setFollowing(false);
    moveTo(map, { center: [observer.lonDeg, observer.latDeg] });
  };
  // Picking the place you are already on (the location sheet) centres on it too.
  const homeTick = useFollow((s) => s.homeTick);
  const homeSeen = useRef(homeTick);
  useEffect(() => {
    if (homeTick === homeSeen.current) return;
    homeSeen.current = homeTick;
    centreOnYou.current?.();
  }, [homeTick]);
  const zoomBy = (delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    if (useFollow.getState().following) {
      lockZoomBy(map, delta);
      return;
    }
    atHome.current = false;
    map.zoomTo(map.getZoom() + delta, { animate: !reducedMotion() });
  };

  const legendList = (
    <ul className="map-legend" aria-label="Map legend">
      {legend({ sats, observer, minElevDeg }).map((item) => (
        <li key={item.key}>
          <span
            className={`map-legend__swatch map-legend__swatch--${item.kind}`}
            style={item.color ? ({ "--swatch": item.color } as React.CSSProperties) : undefined}
            aria-hidden="true"
          >
            {/* The map's observer mark (lib/map/overlays.mjs observerImage):
                a 5 px ring with 9 px crosshair arms, 2 px strokes. */}
            {/* The radio mark (lib/map/overlays.mjs radioImage): two arcs up and to the left of a dot. */}
            {item.kind === "radio" && (
              <svg viewBox="0 0 30 30" width="22" height="22">
                <circle cx="15" cy="15" r="4" fill="currentColor" />
                <path d="M8.03 14.39A7 7 0 0 1 14.39 8.03M5.04 14.13A10 10 0 0 1 14.13 5.04" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            )}
            {item.kind === "observer" && (
              <svg viewBox="0 0 22 22" width="18" height="18">
                <circle cx="11" cy="11" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M2 11h18M11 2v18" stroke="currentColor" strokeWidth="2" />
              </svg>
            )}
          </span>
          {item.label}
        </li>
      ))}
    </ul>
  );
  const focusName = selectedId != null ? sats.find((s) => s.noradId === selectedId)?.name ?? null : null;
  // Chips at the top left; layers and full screen at the top right.
  const chipRow = (
    <div className="flat-map__top">
      {chips}
      <div className="flat-map__tools">
        <MapLayers
          view={view}
          onViewChange={onProjectionChange}
          presets={presetsNow}
          onPreset={goTo}
          followOn={followOn}
          onReset={reset}
          share={share}
          legend={legendList}
        />
        <Button variant="overlay" iconOnly aria-label={full ? "Exit full screen" : "Full screen"} onClick={toggleFull}>
          <Icon name={full ? "exit-fullscreen" : "fullscreen"} />
        </Button>
      </div>
    </div>
  );
  const shellClass = `flat-map-shell${fill ? " flat-map-shell--fill" : ""}${full ? " flat-map-shell--full" : ""}`;

  return (
    <div className={shellClass} ref={shellRef} role="region" aria-label="Satellite map">
    {fill ? (
      // These lay over the top of the map: the chips row first, the focus bar
      // under it, so opening the focus bar never moves the chips.
      <div className="flat-map__over">
        {chipRow}
        {top ? <div className="flat-map__head">{top}</div> : null}
      </div>
    ) : top}
    {/* Both spherical views show space around the Earth. */}
    <div className={`flat-map${view !== "flat" ? " flat-map--globe" : ""}`}>
      {/* MapLibre owns this element and its children. */}
      {/* Stars behind the globe, under MapLibre's canvas (clear in space). */}
      {view !== "flat" ? <canvas className="flat-map__stars" ref={starsRef} aria-hidden="true" /> : null}
      <div className="flat-map__gl" ref={glRef} />
      <div className="flat-map__grid-labels" ref={gridLabelsRef} aria-hidden="true" />
      {noMap ? (
        <p className="flat-map__nogl">
          {noMap === "gl" ? "This browser can't draw the map." : "The map couldn't load."} Passes and charts still work.
        </p>
      ) : null}
      {fill ? null : chipRow}
      {/* Lock on: keep the camera on the focused satellite. A small toggle in
          the corner, in place of a bar across the top of the map. */}
      {paused ? (
        <div className="flat-map__paused" role="status">
          <Icon name="pause" />
          {/* Phones show the short form: the time, and Live. */}
          <span className="flat-map__paused-text"><span className="flat-map__long">Paused at </span>{paused.label}</span>
          <Button size="sm" variant="primary" className="flat-map__live" aria-label="Back to live" onClick={backToLive}>
            <span className="live-dot" aria-hidden="true" /><span className="flat-map__long">Back to live</span><span className="flat-map__short">Live</span>
          </Button>
        </div>
      ) : focusName ? (
        <Button
          variant="overlay"
          size="sm"
          className="flat-map__lock"
          pressed={followOn}
          aria-label={followOn ? `Locked on ${focusName}` : `Lock on ${focusName}`}
          onClick={() => setFollowing(!followOn)}
        >
          {/* A padlock, not the crosshair your own location wears. Room
              allowing, it names the satellite. */}
          <Icon name={followOn ? "lock" : "unlock"} />
          <span className="flat-map__lock-long">{followOn ? `Locked onto ${focusName}` : `Lock onto ${focusName}`}</span>
          <span className="flat-map__lock-short">{followOn ? "Locked on" : "Lock on"}</span>
        </Button>
      ) : null}
      {/* Zoom in and out at the bottom right, desktop only (phones pinch). */}
      <div className="flat-map__zoom">
        <Button variant="overlay" iconOnly aria-label="Zoom in" onClick={() => zoomBy(1)}>+</Button>
        <Button variant="overlay" iconOnly aria-label="Zoom out" onClick={() => zoomBy(-1)}>{"−"}</Button>
      </div>
      <table className="sr-only">
        <caption>Current satellite positions</caption>
        <thead>
          <tr>
            <th scope="col">Satellite</th>
            <th scope="col">Latitude</th>
            <th scope="col">Longitude</th>
          </tr>
        </thead>
        <tbody>
          {sats.filter((s) => s.emphasis !== "hidden").map((s) => (
            <tr key={s.noradId}>
              <th scope="row">{s.name}{s.noradId === selectedId ? " (focused)" : ""}</th>
              <td>{s.position.latDeg.toFixed(1)} degrees</td>
              <td>{s.position.lonDeg.toFixed(1)} degrees</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </div>
  );
}
