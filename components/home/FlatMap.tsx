"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
// Types only: the library itself loads in an effect, in its own chunk.
import type { CustomLayerInterface, LayerSpecification, Map as MlMap, MapMouseEvent, MapTouchEvent, Marker, StyleSpecification } from "maplibre-gl";
import { legendItems } from "@/lib/map/legend.mjs";
import { basemapStyle } from "@/lib/map/basemap.mjs";
import { overlayColors, overlayData, overlayImages, overlayLayers } from "@/lib/map/overlays.mjs";
import { addOverlays as addOverlaysTo, setOverlayData } from "@/lib/map/maplibre-overlays.mjs";
import { footprintFeature, footprintRadiusDeg, trackDetailFor } from "@/lib/map/geometry.mjs";
import { createFootprintLayer, drawsGlobeCap } from "@/lib/map/footprint-layer.mjs";
import { PROJECTIONS, MAX_ZOOM, homeCamera, homeCentresFocus as homeCentresFocusOf, minZoomFor, presetCamera, easeZoom as easeZoomOf } from "@/lib/map/view.mjs";
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
  /** Laid over the top of the map, left of the view toggle (the chips). */
  chips?: React.ReactNode;
  /** Sized by its container (MapShell): docked full height on desktop, with the
   *  focus bar and a collapsible legend laid over the map. */
  fill?: boolean;
}

export type FlatMapProps = Props;

type View = "flat" | "globe";
/** The MapLibre projection each view draws with (as basemapStyle names it). */
const PROJECTION_OF = { flat: "mercator", globe: "globe" } as const;
type LngLat = [number, number];
type Camera = { center: LngLat; zoom: number };
/** A camera move; no zoom keeps the current zoom. */
type Move = { center: LngLat; zoom?: number };
type Preset = "you" | "sat" | "north" | "south" | "night";
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
type LiveFocus = SelectedSub & { name: string; color: string; footprint: boolean };
/** The focused satellite's dot and name: a marker the frame loop moves. */
type FocusMark = { marker: Marker; el: HTMLElement; name: HTMLElement; shown: boolean; label: string; color: string };

const NIGHT_REFRESH_MS = 60_000;
/** How often the other dots and the GeoJSON footprint move; the focus moves every frame. */
const DOT_MS = 200;
/** Where MapShell docks the map beside the panel (keep in step with home.css). */
const DOCKED_QUERY = "(min-width: 1100px)";
/** A tap this close to a dot (in px, either axis) selects it. */
const HIT_PX = 22;
/** The satellite dot layer tapped through (lib/map/overlays.mjs). The focus
 *  layer draws nothing (the focus marker does), so the marker is tested apart. */
const SAT_LAYERS = ["ss-sats"];
/** A future track smaller than this on both axes gets no chevron or ticks. */
const SHORT_TRACK_PX = 16;
/** The globe camera buttons, in order. */
const PRESETS: { id: Preset; label: string }[] = [
  { id: "you", label: "On you" },
  { id: "sat", label: "On the satellite" },
  { id: "north", label: "North pole" },
  { id: "south", label: "South pole" },
  { id: "night", label: "Night side" },
];
/** Zoom slack before the map counts as zoomed in past its home view. */
const ZOOM_EPS = 0.01;

const zoomFloor = minZoomFor as (view: View, size: { width: number; height: number }) => number;
const easeZoom = easeZoomOf as (current: number, target: number) => number;
const wrapLon = (d: number) => d - 360 * Math.round(d / 360);
const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
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
  fill = false,
}: Props) {
  const view: View = projectionId === "flat" ? "flat" : "globe";
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
  // "On the satellite": the camera stays on the focus until a pan (zooms
  // keep it), Reset view, another preset or a new focus stops it. A shared
  // store, so other controls can show and toggle it; the dot loop reads it
  // with getState.
  const followOn = useFollow((s) => s.following);
  const setFollowing = useFollow((s) => s.setFollowing);
  const [legendOpen, setLegendOpen] = useState(false);
  const legendId = useId();

  // Latest props, read by map event handlers without re-binding them.
  const latest = useRef({ sats, observer, view, onSelect, minElevDeg });
  latest.current = { sats, observer, view, onSelect, minElevDeg };

  /** The satellites as of now: props arrive about once a second, so each dot
   *  and the focus footprint move to trueNow(). A satellite the track cannot
   *  place now stays where the props put it, so a failed sample never drops
   *  it (or changes the track key). */
  const liveSats = useCallback((): MapSat[] => {
    const { sats: s, minElevDeg: elev } = latest.current;
    const ms = trueNow();
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
        footprint: x.footprint ? footprintOf(sub, sub.altKm, elev) : null,
      });
    }
    return out;
  }, []);
  // The focus's last placed sample, kept for a sample that fails.
  const lastFocus = useRef<{ noradId: number; focus: LiveFocus } | null>(null);
  /** The focused satellite's sub-point at ms (now by default), or null.
   *  Worked out once per update and shared by the dot, the footprint and the
   *  follow jump. A sample the track cannot place keeps the last one, as
   *  liveSats keeps the dot, so the dot and the globe cap do not blink off. */
  const liveFocus = useCallback((s: MapSat[], ms = trueNow()): LiveFocus | null => {
    const f = s.find((x) => x.emphasis === "focus");
    if (!f) {
      lastFocus.current = null;
      return null;
    }
    const sub = f.positionAt(ms);
    const last = lastFocus.current;
    if (!sub) return last && last.noradId === f.noradId ? last.focus : null;
    const focus = { ...sub, name: f.name, color: f.color, footprint: f.footprint != null };
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
  /** While following, wheel and pinch zoom about the centre (the satellite)
   *  and double-click zoom is ours (the dblclick handler); otherwise they zoom
   *  about the pointer. The +/- buttons and keys always zoom about the centre. */
  const syncZoomAround = useCallback((map: MlMap, centre: boolean) => {
    const opts = centre ? { around: "center" as const } : undefined;
    // enable() keeps the old options while enabled, so turn it off first.
    map.scrollZoom.disable();
    map.scrollZoom.enable(opts);
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
  /** Following, jump to the focus f: no easing, and no originalEvent, so
   *  movestart does not take it for a gesture. Waits for a running ease or
   *  gesture (a preset's, a zoom, a held pointer) to end. True when it jumped. */
  const followJump = useCallback((map: MlMap, f: LiveFocus | null): boolean => {
    if (!f || handHeld.current || map.isMoving() || !useFollow.getState().following) return false;
    selfJump.current = true;
    try {
      map.jumpTo({ center: [f.lonDeg, f.latDeg] });
    } finally {
      selfJump.current = false;
    }
    return true;
  }, []);
  // The focused dot and name, made with the map. A DOM marker moves at once
  // when told (and on every camera move), so it lands in the same frame as a
  // follow jump; a GeoJSON source re-tiles in the worker and lands later.
  const focusMark = useRef<FocusMark | null>(null);
  const [mapReady, setMapReady] = useState(false);
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
    if (f.name !== mark.label) {
      mark.label = f.name;
      mark.name.textContent = f.name;
    }
    mark.marker.setLngLat([f.lonDeg, f.latDeg]);
    if (!mark.shown) {
      mark.marker.addTo(map);
      mark.shown = true;
    }
  }, []);

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
      // The focused dot and name (app/home.css .flat-map__focus). Hidden, not
      // faded, on the globe's far side; taps reach the canvas through it.
      const markEl = document.createElement("div");
      markEl.className = "flat-map__focus";
      markEl.setAttribute("aria-hidden", "true");
      const markDot = document.createElement("span");
      markDot.className = "flat-map__focus-dot";
      const markName = document.createElement("span");
      markName.className = "flat-map__focus-name";
      markEl.append(markDot, markName);
      focusMark.current = {
        marker: new gl.Marker({ element: markEl, subpixelPositioning: true, opacityWhenCovered: "0" }),
        el: markEl,
        name: markName,
        shown: false,
        label: "",
        color: "",
      };
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
        map.setProjection({ type: PROJECTION_OF[latest.current.view] });
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
        if (best != null && Number.isFinite(best)) latest.current.onSelect(best);
      });
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
        const ev = e.originalEvent;
        queueMicrotask(() => map.zoomTo(map.getZoom() + (ev.shiftKey ? -1 : 1), { animate: !reducedMotion() }, { originalEvent: ev }));
      });
      // Zoomed in past home, a stacked map takes one-finger and wheel gestures.
      // A follow jump keeps the Earth's size, so it skips this and the push.
      map.on("zoomend", () => {
        if (!selfJump.current) syncGestures();
      });
      // Past zoom 11 the globe flattens toward Mercator and the GeoJSON fill takes over.
      map.on("zoom", syncFill);
      // Zooming changes which tracks are too short for direction marks.
      map.on("moveend", () => {
        if (!selfJump.current) push();
      });
      // MapLibre follows its container; an untouched home view refits to it.
      map.on("resize", () => {
        limitZoom(map);
        if (atHome.current) map.jumpTo(homeView(map));
      });
    })();
    return () => {
      alive = false;
      window.removeEventListener("mouseup", letGo);
      window.removeEventListener("blur", letGo);
      window.removeEventListener("contextmenu", letGo);
      window.removeEventListener("mousemove", onMove);
      styleReady.current = false;
      mapRef.current = null;
      capLayer.current = null;
      focusMark.current?.marker.remove();
      focusMark.current = null;
      setMapReady(false);
      made?.remove();
    };
    // Made once (the callbacks are stable); later props reach it through
    // latest and the effects below.
  }, [refreshNight, sourceData, push, homeView, syncGestures, setFollowing, limitZoom, syncFill, pushFootprint, liveFocus, syncZoomAround]);

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
  useEffect(() => {
    const map = mapRef.current;
    if (map) syncZoomAround(map, followOn);
  }, [followOn, syncZoomAround]);

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
  }, [view, homeView, setFollowing, limitZoom, syncFill, syncGestures]);

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
    const f = liveFocus(latest.current.sats);
    pushFootprint(f);
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
    push();
  }, [sats, observer, selectedId, minElevDeg, push, pushFootprint, moveTo, liveFocus]);

  // Between props, move the other dots and the GeoJSON footprint every
  // DOT_MS. Nothing here sets React state. It stops while the tab is hidden.
  useEffect(() => {
    let id: number | undefined;
    const tick = () => {
      const map = mapRef.current;
      if (!map || !styleReady.current) return;
      // Only what moves: the dots, and the focus footprint while there is one.
      // The observer, night bands and an emptied footprint go with push().
      const data = buildData({ sats: liveSats(), tracks: false });
      const footprint = data["ss-footprint"] as { features: unknown[] };
      setOverlayData(map, {
        "ss-sats": data["ss-sats"],
        ...(footprint.features.length > 0 && { "ss-footprint": footprint }),
      });
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
  }, [liveSats]);

  // Every frame while a satellite is focused, the map is made and the tab
  // shows: place the focus once at the frame's time, and from it the marker, the
  // globe cap and a following camera. A jump draws the map at once, so the
  // canvas and the marker show the same instant. Nothing here sets React state.
  const hasFocus = sats.some((s) => s.emphasis === "focus");
  useEffect(() => {
    const map = mapRef.current;
    if (!hasFocus || !mapReady || !map) return;
    let id: number | undefined;
    const frame = (at?: number) => {
      // Asked first, so next frame this runs ahead of the map's own render.
      id = requestAnimationFrame(frame);
      // The frame's own time rather than the moment this runs, which wanders
      // by a few ms: the dot then steps evenly.
      const ms = at === undefined ? trueNow() : trueNow() + at - performance.now();
      const f = liveFocus(latest.current.sats, ms);
      pushFootprint(f);
      placeMark(map, f);
      if (followJump(map, f)) map.redraw();
    };
    const stop = () => {
      if (id !== undefined) cancelAnimationFrame(id);
      id = undefined;
    };
    const start = () => {
      stop();
      if (!document.hidden) frame();
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      document.removeEventListener("visibilitychange", start);
      stop();
      const mark = focusMark.current;
      if (mark?.shown) {
        mark.marker.remove();
        mark.shown = false;
      }
    };
  }, [hasFocus, mapReady, liveFocus, pushFootprint, placeMark, followJump]);

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
    const cam = preset(p, {
      observer,
      focus: focusNow,
      width: el.clientWidth || 1,
      height: el.clientHeight || 1,
      date: new Date(trueNow()),
    });
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
      <div
        className="flat-map__views"
        role="radiogroup"
        aria-label="Map view"
        onKeyDown={(e) => {
          const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
          if (!step) return;
          e.preventDefault();
          const next = PROJECTIONS[(PROJECTIONS.findIndex((p: { id: string }) => p.id === view) + step + PROJECTIONS.length) % PROJECTIONS.length];
          onProjectionChange(next.id);
          e.currentTarget.querySelector<HTMLButtonElement>(`[data-view="${next.id}"]`)?.focus();
        }}
      >
        {PROJECTIONS.map((p: { id: string; label: string }) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            data-view={p.id}
            aria-checked={view === p.id}
            tabIndex={view === p.id ? 0 : -1}
            className="flat-map__view"
            onClick={() => onProjectionChange(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
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
