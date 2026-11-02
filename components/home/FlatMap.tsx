"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
// Types only: the library itself loads in an effect, in its own chunk.
import type { LayerSpecification, Map as MlMap, MapMouseEvent, StyleSpecification } from "maplibre-gl";
import { legendItems } from "@/lib/map/legend.mjs";
import { basemapStyle } from "@/lib/map/basemap.mjs";
import { overlayColors, overlayData, overlayImages, overlayLayers } from "@/lib/map/overlays.mjs";
import { addOverlays as addOverlaysTo, setOverlayData } from "@/lib/map/maplibre-overlays.mjs";
import { PROJECTIONS, homeCamera, presetCamera } from "@/lib/map/view.mjs";

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
}) => SourceData;
const home = homeCamera as (
  view: View,
  o: { observer: MapObserver | null; focus: { lonDeg: number; latDeg: number } | null; width: number; height: number },
) => Camera;
const preset = presetCamera as (
  p: Preset,
  o: { observer: MapObserver | null; focus: { lonDeg: number; latDeg: number } | null },
) => { center: LngLat; zoom: number | null } | null;
const addOverlays = addOverlaysTo as (
  map: MlMap,
  o: { images: unknown[]; layers: LayerSpecification[]; data: SourceData },
) => void;
type Theme = "dark" | "light";

const NIGHT_REFRESH_MS = 60_000;
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
const wrapLon = (d: number) => d - 360 * Math.round(d / 360);
const readTheme = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
const reducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** A zoom comparable across centres: at a fixed zoom the globe's disc grows
 *  by 1 / cos(centre latitude), clamped where MapLibre clamps it. */
const discZoom = (view: View, zoom: number, lat: number) =>
  view === "globe" ? zoom - Math.log2(Math.cos((Math.min(Math.abs(lat), 85.05) * Math.PI) / 180)) : zoom;
const focusOf = (sats: MapSat[]) => sats.find((s) => s.emphasis === "focus")?.position ?? null;

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
  const view = viewOf(projectionId);
  const glRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  // True between a style's load and the next setStyle: the overlay sources exist.
  const styleReady = useRef(false);
  // Read after mount (the server and first render draw dark).
  const themeRef = useRef<Theme>("dark");
  const night = useRef<{ at: number; data: unknown } | null>(null);
  const [noGl, setNoGl] = useState(false);
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
  // "On the satellite": each props update re-centres on the focus until a
  // gesture, Reset view, another preset or a new focus stops it.
  const following = useRef(false);
  const [followOn, setFollowOn] = useState(false);
  const setFollowing = useCallback((on: boolean) => {
    following.current = on;
    setFollowOn(on);
  }, []);
  const [legendOpen, setLegendOpen] = useState(false);
  const legendId = useId();

  // Latest props, read by map event handlers without re-binding them.
  const latest = useRef({ sats, observer, view, onSelect });
  latest.current = { sats, observer, view, onSelect };

  const homeView = useCallback((map: MlMap): Camera => {
    const { sats: s, observer: o, view: v } = latest.current;
    const el = map.getContainer();
    return home(v, { observer: o, focus: focusOf(s), width: el.clientWidth || 1, height: el.clientHeight || 1 });
  }, []);
  const moveTo = useCallback((map: MlMap, cam: Move) => {
    if (reducedMotion()) map.jumpTo(cam);
    else map.easeTo(cam);
  }, []);

  /** Night bands, rebuilt at most every NIGHT_REFRESH_MS; true when rebuilt. */
  const refreshNight = useCallback((): boolean => {
    const now = Date.now();
    if (night.current && now - night.current.at < NIGHT_REFRESH_MS) return false;
    night.current = { at: now, data: buildData({ nightDate: new Date(now) })["ss-night"] };
    return true;
  }, []);
  const sourceData = useCallback((map: MlMap): SourceData => {
    const { sats: s, observer: o } = latest.current;
    return buildData({ sats: s, observer: o, shortTrackIds: shortTracks(map, s) });
  }, []);

  // Push the latest props into the overlay sources.
  const push = useCallback(() => {
    const map = mapRef.current;
    if (!map || !styleReady.current) return;
    const data = sourceData(map);
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
        return; // The chunk did not load (offline): the frame keeps its water colour.
      }
      const el = glRef.current;
      if (!alive || !el) return;
      // The bundler rewrites import.meta.url inside the library, so it cannot
      // find its worker by itself; this URL makes the build emit the file.
      gl.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
      if ((gl as unknown as { supported?: () => boolean }).supported?.() === false) {
        setNoGl(true);
        return;
      }
      const cam = home(latest.current.view, {
        observer: latest.current.observer,
        focus: focusOf(latest.current.sats),
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
          maxZoom: 8,
          cooperativeGestures: !(docked.current || fullRef.current),
        });
      } catch {
        setNoGl(true);
        return;
      }
      made = map;
      mapRef.current = map;
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      const canvas = map.getCanvas();
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "Map of followed satellites");
      canvas.tabIndex = 0;
      // The home camera already centres on a focus that exists now.
      if (focusOf(latest.current.sats)) centreOn.current = null;

      map.on("style.load", () => {
        styleReady.current = true;
        const colors = overlayColors(themeRef.current);
        refreshNight();
        const data = sourceData(map);
        data["ss-night"] = night.current?.data;
        addOverlays(map, {
          images: overlayImages(colors),
          layers: overlayLayers(colors) as LayerSpecification[],
          data,
        });
        map.setProjection({ type: latest.current.view === "globe" ? "globe" : "mercator" });
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
        if (following.current) setFollowing(false);
      });
      // Zoomed in past home, a stacked map takes one-finger and wheel gestures.
      map.on("zoomend", syncGestures);
      // Zooming changes which tracks are too short for direction marks.
      map.on("moveend", push);
      // MapLibre follows its container; an untouched home view refits to it.
      map.on("resize", () => {
        if (atHome.current) map.jumpTo(homeView(map));
      });
    })();
    return () => {
      alive = false;
      styleReady.current = false;
      mapRef.current = null;
      made?.remove();
    };
    // Made once (the callbacks are stable); later props reach it through
    // latest and the effects below.
  }, [refreshNight, sourceData, push, homeView, syncGestures, setFollowing]);

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
    map.jumpTo(homeView(map));
  }, [view, homeView, setFollowing]);

  // An untouched home view follows the observer (it arrives after mount, once prefs load).
  const obsLon = observer?.lonDeg ?? null;
  const obsLat = observer?.latDeg ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (map && atHome.current) map.jumpTo(homeView(map));
  }, [obsLon, obsLat, homeView]);

  // Entering a focus moves once to centre it, keeping the zoom. It waits for
  // the satellite to have a position, then leaves the camera alone.
  useEffect(() => {
    centreOn.current = selectedId;
    setFollowing(false);
  }, [selectedId, setFollowing]);
  // The parent's clock tick passes new props each second.
  useEffect(() => {
    const map = mapRef.current;
    const id = centreOn.current;
    if (map && id != null) {
      const sat = sats.find((s) => s.noradId === id && s.emphasis === "focus");
      if (sat) {
        centreOn.current = null;
        // Off home now, so a resize or a new observer leaves the satellite centred.
        atHome.current = false;
        moveTo(map, { center: [sat.position.lonDeg, sat.position.latDeg], zoom: map.getZoom() });
      }
    }
    const focus = focusOf(sats);
    // Following jumps without easing; a preset's own ease runs to its end first.
    // The jump's moveend pushes the overlays.
    if (map && following.current && focus && !map.isMoving()) {
      map.jumpTo({ center: [focus.lonDeg, focus.latDeg] });
      return;
    }
    push();
  }, [sats, observer, selectedId, push, moveTo]);

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
    const cam = preset(p, { observer, focus: focusNow });
    if (!map || !cam) return;
    atHome.current = false;
    setFollowing(p === "sat");
    moveTo(map, cam.zoom == null ? { center: cam.center } : { center: cam.center, zoom: cam.zoom });
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
          />
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
      {noGl ? <p className="flat-map__nogl">This browser can&apos;t draw the map. Passes and charts still work.</p> : null}
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
