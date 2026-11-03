"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
// Types only: the library itself loads in an effect, in its own chunk.
import type { CustomLayerInterface, LayerSpecification, Map as MlMap, MapMouseEvent, StyleSpecification } from "maplibre-gl";
import { legendItems } from "@/lib/map/legend.mjs";
import { basemapStyle } from "@/lib/map/basemap.mjs";
import { overlayColors, overlayData, overlayImages, overlayLayers } from "@/lib/map/overlays.mjs";
import { addOverlays as addOverlaysTo, setOverlayData } from "@/lib/map/maplibre-overlays.mjs";
import { footprintFeature, footprintRadiusDeg, trackDetailFor } from "@/lib/map/geometry.mjs";
import { createFootprintLayer, drawsGlobeCap } from "@/lib/map/footprint-layer.mjs";
import { PROJECTIONS, MAX_ZOOM, effectiveView as effectiveViewOf, homeCamera, homeCentresFocus as homeCentresFocusOf, minZoomFor, presetCamera, easeZoom as easeZoomOf, zoomForAltitude as zoomForAltitudeOf } from "@/lib/map/view.mjs";
import { trueNow } from "@/lib/pass-finder/clock-sync.js";
import { useFollow } from "@/lib/map/follow-store";

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
}

export interface MapObserver {
  name: string;
  latDeg: number;
  lonDeg: number;
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
  onSelect: (noradId: number) => void;
  /** Shown above the map, inside the full screen frame (the focus bar). */
  top?: React.ReactNode;
  /** Laid over the top of the map, left of the view menu (the chips). */
  chips?: React.ReactNode;
  /** Subpoint and altitude of the selected satellite. */
  selectedSub?: SelectedSub | null;
  /** Sized by its container (MapShell): docked full height on desktop, with the
   *  focus bar and a collapsible legend laid over the map. */
  fill?: boolean;
}

export type FlatMapProps = Props;

type View = "flat" | "globe";
type LngLat = [number, number];
type Camera = { center: LngLat; zoom: number };
/** A camera move; no zoom keeps the current zoom. */
type Move = { center: LngLat; zoom?: number };
type Preset = "you" | "sat" | "north" | "south";
type LegendItem = { key: string; kind: string; label: string; color?: string };
const legend = legendItems as (o: { sats: MapSat[]; observer: MapObserver | null; minElevDeg: number }) => LegendItem[];
type SourceData = Record<string, unknown>;
const buildData = overlayData as (o: {
  sats?: MapSat[];
  observer?: MapObserver | null;
  nightDate?: Date | null;
  shortTrackIds?: Set<number>;
  trackDetail?: number;
  tracks?: boolean;
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
  const parts = sats.map((s) => `${s.noradId}:${s.emphasis}:${s.color}:${shapeId(s.trackPast)}:${shapeId(s.trackFuture)}`);
  return `${detail}|${[...short].sort().join(",")}|${parts.join(";")}`;
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
  o: { observer: MapObserver | null; focus: { lonDeg: number; latDeg: number } | null; width: number; height: number },
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
const effectiveView = effectiveViewOf as (projection: string, hasFocus: boolean) => string;
const zoomForAltitude = zoomForAltitudeOf as (altKm: number, heightPx: number) => number;
/** The GeoJSON footprint fill, hidden while the globe layer draws it. */
const FILL_LAYER = "ss-footprint-fill";
type Theme = "dark" | "light";

const NIGHT_REFRESH_MS = 60_000;
/** How often the dots, the focus footprint and a following camera move. */
const DOT_MS = 200;
/** Where MapShell docks the map beside the panel (keep in step with home.css). */
const DOCKED_QUERY = "(min-width: 1100px)";
/** A tap this close to a dot (in px, either axis) selects it. */
const HIT_PX = 22;
/** The satellite dot layers (lib/map/overlays.mjs), focus on top. */
const SAT_LAYERS = ["ss-sats", "ss-sats-focus"];
/** A future track smaller than this on both axes gets no chevron or ticks. */
const SHORT_TRACK_PX = 16;
/** The globe camera buttons, in order. */
const PRESETS: { id: Preset; label: string }[] = [
  { id: "you", label: "On you" },
  { id: "sat", label: "On the satellite" },
  { id: "north", label: "North pole" },
  { id: "south", label: "South pole" },
];
/** Zoom slack before the map counts as zoomed in past its home view. */
const ZOOM_EPS = 0.01;

const viewOf = (id: string): View => (id === "globe" ? "globe" : "flat");
const zoomFloor = minZoomFor as (view: View, size: { width: number; height: number }) => number;
const easeZoom = easeZoomOf as (current: number, target: number) => number;
const wrapLon = (d: number) => d - 360 * Math.round(d / 360);
const readTheme = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
const reducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
  selectedSub = null,
  fill = false,
}: Props) {
  const view = viewOf(projectionId);
  const glRef = useRef<HTMLDivElement>(null);
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
  // Docked beside the panel the page never scrolls, so the map owns wheel and drag.
  const docked = useRef(false);
  // Entering a focus moves once to centre it (the effect near the end).
  const centreOn = useRef<number | null>(null);
  // "On the satellite": the camera stays on the focus until a gesture, Reset
  // view, another preset or a new focus stops it. A shared store, so other
  // controls can show and toggle it; the dot loop reads it with getState.
  const followOn = useFollow((s) => s.following);
  const setFollowing = useFollow((s) => s.setFollowing);
  const [legendOpen, setLegendOpen] = useState(false);
  const legendId = useId();

  // Latest props, read by map event handlers without re-binding them.
  const latest = useRef({ sats, observer, view, projectionId, onSelect, selectedSub, minElevDeg });
  latest.current = { sats, observer, view, projectionId, onSelect, selectedSub, minElevDeg };

  /** The satellites as of now: props arrive about once a second, so each dot
   *  and the focus footprint move to trueNow(). A satellite the track cannot
   *  place now is left out. */
  const liveSats = useCallback((): MapSat[] => {
    const { sats: s, minElevDeg: elev } = latest.current;
    const ms = trueNow();
    const out: MapSat[] = [];
    for (const x of s) {
      const sub = x.positionAt(ms);
      if (!sub) continue;
      out.push({
        ...x,
        position: { lonDeg: sub.lonDeg, latDeg: sub.latDeg },
        footprint: x.footprint ? footprintOf(sub, sub.altKm, elev) : null,
      });
    }
    return out;
  }, []);
  /** The focused satellite's sub-point now, or null. */
  const liveFocus = useCallback((s: MapSat[]): (SelectedSub & { color: string; footprint: boolean }) | null => {
    const f = s.find((x) => x.emphasis === "focus");
    const sub = f?.positionAt(trueNow());
    return f && sub ? { ...sub, color: f.color, footprint: f.footprint != null } : null;
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
  const pushFootprint = useCallback(() => {
    const f = liveFocus(latest.current.sats);
    capLayer.current?.setFootprint(f?.footprint
      ? { center: [f.lonDeg, f.latDeg], radiusDeg: radiusFor(f.altKm, latest.current.minElevDeg), color: f.color }
      : null);
  }, [liveFocus]);

  const homeView = useCallback((map: MlMap): Camera => {
    const { sats: s, observer: o, view: v } = latest.current;
    const el = map.getContainer();
    return home(v, { observer: o, focus: focusOf(s), points: dotsOf(s), width: el.clientWidth || 1, height: el.clientHeight || 1 });
  }, []);
  /** Zoom out no further than the whole Earth: the floor follows the
   *  container. On the globe MapLibre adds its own latitude term, so the
   *  floor holds through moves. */
  const limitZoom = useCallback((map: MlMap) => {
    const el = map.getContainer();
    map.setMinZoom(zoomFloor(latest.current.view, { width: el.clientWidth || 1, height: el.clientHeight || 1 }));
  }, []);
  const moveTo = useCallback((map: MlMap, cam: Move) => {
    if (reducedMotion()) map.jumpTo(cam);
    else map.easeTo(cam);
  }, []);
  /** Following (or in Satellite's view), jump to the focus now: no easing, and
   *  no originalEvent, so movestart does not take it for a gesture. Waits for a
   *  running ease (a preset's) to end. True when it jumped; its moveend pushes
   *  the overlays. */
  const followJump = useCallback((map: MlMap): boolean => {
    const { sats: s, projectionId: p } = latest.current;
    const f = liveFocus(s);
    if (!f || map.isMoving()) return false;
    const satview = effectiveView(p, true) === "satview";
    if (!satview && !useFollow.getState().following) return false;
    const cam: Move = { center: [f.lonDeg, f.latDeg] };
    if (satview) {
      const z = zoomForAltitude(f.altKm, map.getContainer().clientHeight || 1);
      cam.zoom = Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), z));
    }
    map.jumpTo(cam);
    return true;
  }, [liveFocus]);

  /** Night bands, rebuilt at most every NIGHT_REFRESH_MS; true when rebuilt. */
  const refreshNight = useCallback((): boolean => {
    const now = Date.now();
    if (night.current && now - night.current.at < NIGHT_REFRESH_MS) return false;
    night.current = { at: now, data: buildData({ nightDate: new Date(now) })["ss-night"] };
    return true;
  }, []);
  const sentTrackKey = useRef<string | null>(null);
  /** Source data for the map. Tracks change once a minute (or on a zoom that
   *  changes their detail) while the dots change every second, so unless all
   *  is set the track sources are only built when their key has changed. */
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
  const push = useCallback(() => {
    const map = mapRef.current;
    if (!map || !styleReady.current) return;
    const data = sourceData(map, false);
    if (refreshNight()) data["ss-night"] = night.current?.data;
    else delete data["ss-night"];
    setOverlayData(map, data);
  }, [sourceData, refreshNight]);

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
          cooperativeGestures: !(docked.current || fullRef.current),
        });
      } catch {
        setNoMap("gl");
        return;
      }
      made = map;
      mapRef.current = map;
      capLayer.current = makeFootprintLayer({
        // It fails inside a frame: change the style after it.
        onFail: () => {
          capFailed.current = true;
          queueMicrotask(syncFill);
        },
      });
      pushFootprint();
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      const canvas = map.getCanvas();
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "Map of followed satellites");
      canvas.tabIndex = 0;
      // MapLibre opens the compact attribution at start and folds it only on a
      // drag, which cooperative gestures never send on a phone. Fold it once the
      // map has drawn, as its info button does; that button still opens it.
      map.once("idle", () => {
        const attrib = map.getContainer().querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show");
        if (!attrib) return;
        attrib.classList.remove("maplibregl-compact-show");
        attrib.setAttribute("open", "");
      });
      // A flat home camera already centres on a focus that exists now; the
      // globe's centres on the observer, so it still eases to the focus.
      const { observer: o, view: v, sats: s0 } = latest.current;
      if (homeCentresFocus(v, { observer: o, focus: focusOf(s0) })) centreOn.current = null;

      map.on("style.load", () => {
        styleReady.current = true;
        const colors = overlayColors(themeRef.current);
        refreshNight();
        const data = sourceData(map, true);
        data["ss-night"] = night.current?.data;
        addOverlays(map, {
          images: overlayImages(colors),
          layers: overlayLayers(colors) as LayerSpecification[],
          data,
          custom: capLayer.current ? [capLayer.current] : [],
        });
        map.setProjection({ type: latest.current.view === "globe" ? "globe" : "mercator" });
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
        for (const f of hits) {
          if (f.geometry.type !== "Point") continue;
          const [lon, lat] = f.geometry.coordinates;
          // The world copy nearest the tap.
          const p = map.project([e.lngLat.lng + wrapLon(lon - e.lngLat.lng), lat]);
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < bestD) {
            bestD = d;
            best = Number(f.properties?.noradId);
          }
        }
        if (best != null && Number.isFinite(best)) latest.current.onSelect(best);
      });
      // Moves by hand (drag, wheel, touch, keys) leave the home view and stop
      // following the satellite; ours carry no originalEvent. A single wheel
      // tick starts its move without one, so the wheel handler is asked too.
      map.on("movestart", (e: { originalEvent?: Event }) => {
        if (!e.originalEvent && !map.scrollZoom.isActive()) return;
        atHome.current = false;
        if (useFollow.getState().following) setFollowing(false);
      });
      // Zoomed in past home, a stacked map takes one-finger and wheel gestures.
      map.on("zoomend", syncGestures);
      // Past zoom 11 the globe flattens toward Mercator and the GeoJSON fill takes over.
      map.on("zoom", syncFill);
      // Zooming changes which tracks are too short for direction marks.
      map.on("moveend", push);
      // MapLibre follows its container; an untouched home view refits to it.
      map.on("resize", () => {
        limitZoom(map);
        if (atHome.current) map.jumpTo(homeView(map));
      });
    })();
    return () => {
      alive = false;
      styleReady.current = false;
      mapRef.current = null;
      capLayer.current = null;
      made?.remove();
    };
    // Made once (the callbacks are stable); later props reach it through
    // latest and the effects below.
  }, [refreshNight, sourceData, push, homeView, syncGestures, setFollowing, limitZoom, syncFill, pushFootprint]);

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
      if (e.key === "Escape" && fallback) {
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
    if (shownView.current === view) return;
    shownView.current = view;
    setFollowing(false);
    const map = mapRef.current;
    if (!map) return;
    // Before the style loads, style.load applies the projection.
    if (styleReady.current) map.setProjection({ type: view === "globe" ? "globe" : "mercator" });
    atHome.current = true;
    // The old view's floor could hold the new home view back.
    map.setMinZoom(null);
    map.jumpTo(homeView(map));
    limitZoom(map);
    syncFill();
  }, [view, homeView, setFollowing, limitZoom, syncFill]);

  // An untouched home view follows the observer (it arrives after mount, once prefs load).
  const obsLon = observer?.lonDeg ?? null;
  const obsLat = observer?.latDeg ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (map && atHome.current) map.jumpTo(homeView(map));
  }, [obsLon, obsLat, homeView]);
  // An untouched flat home view refits when the dots first arrive or the set
  // shown changes, so they are in view; not on every tick as they move.
  const dotsKey = sats.filter((s) => s.emphasis !== "hidden").map((s) => s.noradId).join(",");
  useEffect(() => {
    const map = mapRef.current;
    if (map && atHome.current && view === "flat") map.jumpTo(homeView(map));
  }, [dotsKey, view, homeView]);

  // Entering a focus moves once to centre it, keeping the zoom. It waits for
  // the satellite to have a position, then leaves the camera alone.
  useEffect(() => {
    centreOn.current = selectedId;
    setFollowing(false);
  }, [selectedId, setFollowing]);
  // The parent's clock tick passes new props each second.
  useEffect(() => {
    pushFootprint();
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
        moveTo(map, { center: [sat.position.lonDeg, sat.position.latDeg] });
      }
    }
    // Following jumps without easing; a preset's own ease runs to its end first.
    // The jump's moveend pushes the overlays.
    if (map && followJump(map)) return;
    push();
  }, [sats, observer, selectedId, selectedSub, minElevDeg, push, pushFootprint, moveTo, followJump]);

  // Between props, move the dots, the focus footprint and a following camera
  // every DOT_MS. Nothing here sets React state. It stops while the tab is hidden.
  useEffect(() => {
    let id: number | undefined;
    const tick = () => {
      const map = mapRef.current;
      if (!map || !styleReady.current) return;
      pushFootprint();
      if (followJump(map)) return;
      const data = buildData({ sats: liveSats(), observer: latest.current.observer, tracks: false });
      // Night bands are not dots: push() refreshes them once a minute.
      delete data["ss-night"];
      setOverlayData(map, data);
    };
    const stop = () => {
      if (id !== undefined) window.clearInterval(id);
      id = undefined;
    };
    const start = () => {
      stop();
      if (!document.hidden) id = window.setInterval(tick, DOT_MS);
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      document.removeEventListener("visibilitychange", start);
      stop();
    };
  }, [pushFootprint, followJump, liveSats]);

  const reset = () => {
    const map = mapRef.current;
    if (!map) return;
    atHome.current = true;
    setFollowing(false);
    moveTo(map, homeView(map));
  };
  const focusNow = focusOf(sats);
  const goTo = (p: Preset) => {
    const map = mapRef.current;
    if (!map) return;
    const el = map.getContainer();
    const cam = preset(p, { observer, focus: focusNow, width: el.clientWidth || 1, height: el.clientHeight || 1 });
    if (!cam) return;
    atHome.current = false;
    setFollowing(p === "sat");
    moveTo(map, { center: cam.center, zoom: easeZoom(map.getZoom(), cam.zoom) });
  };
  const zoomBy = (delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    atHome.current = false;
    map.zoomTo(map.getZoom() + delta, { animate: !reducedMotion() });
  };

  const chipRow = (
    <div className="flat-map__top">
      {chips}
      <select
        className="flat-map__menu"
        aria-label="Map view"
        value={view}
        onChange={(e) => onProjectionChange(e.target.value)}
      >
        {PROJECTIONS.map((p: { id: string; label: string }) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
    </div>
  );
  const legendList = (
    <ul className="map-legend" id={legendId} aria-label="Map legend">
      {legend({ sats, observer, minElevDeg }).map((item) => (
        <li key={item.key}>
          <span
            className={`map-legend__swatch map-legend__swatch--${item.kind}`}
            style={item.color ? ({ "--swatch": item.color } as React.CSSProperties) : undefined}
            aria-hidden="true"
          >
            {/* The map's observer mark (lib/map/overlays.mjs observerImage):
                a 5 px ring with 9 px crosshair arms, 2 px strokes. */}
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
  const shellClass = `flat-map-shell${fill ? " flat-map-shell--fill" : ""}${full ? " flat-map-shell--full" : ""}`;

  return (
    <div className={shellClass} ref={shellRef}>
    {fill ? (
      // Docked (home.css, 1100 px and up) these lay over the top of the map;
      // narrower, the wrapper dissolves and the focus bar sits above the map.
      <div className="flat-map__over">
        {top ? <div className="flat-map__head">{top}</div> : null}
        {chipRow}
      </div>
    ) : top}
    <div className={`flat-map${view === "globe" ? " flat-map--globe" : ""}`}>
      {/* MapLibre owns this element and its children. */}
      <div className="flat-map__gl" ref={glRef} />
      {noMap ? (
        <p className="flat-map__nogl">
          {noMap === "gl" ? "This browser can't draw the map." : "The map couldn't load."} Passes and charts still work.
        </p>
      ) : null}
      {fill ? null : chipRow}
      {view === "globe" ? (
        <div className="flat-map__presets" role="group" aria-label="Globe camera">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={(p.id === "you" && !observer) || (p.id === "sat" && !focusNow)}
              aria-pressed={p.id === "sat" ? followOn : undefined}
              onClick={() => goTo(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flat-map__zoom">
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1)}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(-1)}>{"−"}</button>
        <button type="button" aria-label="Reset view" onClick={reset}>Reset view</button>
        <button
          type="button"
          aria-label={full ? "Exit full screen" : "Full screen"}
          onClick={toggleFull}
        >
          {"⛶"}
        </button>
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
    {fill ? (
      // The toggle shows only when docked; narrower, the legend is always open below the map.
      <div className={`map-legend-box${legendOpen ? " map-legend-box--open" : ""}`}>
        <button
          type="button"
          className="map-legend__toggle"
          aria-expanded={legendOpen}
          aria-controls={legendId}
          onClick={() => setLegendOpen((v) => !v)}
        >
          Legend
        </button>
        {legendList}
      </div>
    ) : legendList}
    </div>
  );
}
