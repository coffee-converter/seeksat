"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { MAP_PALETTES, drawMap, hitTest, tickLabelBoxes } from "@/lib/map/draw.mjs";
import { legendItems } from "@/lib/map/legend.mjs";
import { loadLand, nightBands } from "@/lib/map/geometry.mjs";
import { graticuleBox, graticuleLabels, graticuleStep, observerBox, pickPlaceLabels, satBoxes } from "@/lib/map/labels.mjs";
import { createLabelLayers } from "@/lib/map/label-cache.mjs";
import {
  PROJECTIONS,
  CENTRE_ON_FOCUS,
  DEFAULT_PROJECTION,
  centredPan,
  clampZoom,
  FILL_PROJECTIONS,
  fillView,
  makeProjection,
  projectionAvailable,
  worldSize,
  wrapLon,
} from "@/lib/map/projections.mjs";

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
  projectionId: string;
  onProjectionChange: (id: string) => void;
  /** The focused satellite. Entering a focus pans to centre it. */
  selectedId: number | null;
  minElevDeg: number;
  /** A tap on a dot, ghosts included. */
  onSelect: (noradId: number) => void;
  /** Shown above the map, inside the full screen frame (the focus bar). */
  top?: React.ReactNode;
  /** Laid over the top of the map, left of the projection menu (the chips). */
  chips?: React.ReactNode;
  /** Subpoint and altitude of the selected satellite, for the "From the satellite" view. */
  selectedSub?: SelectedSub | null;
  /** Sized by its container (MapShell): docked full height on desktop, with the
   *  focus bar and a collapsible legend laid over the map. */
  fill?: boolean;
}

interface ProjectionOptions {
  width: number;
  height: number;
  observer: MapObserver | null;
  sat: SelectedSub | null;
  zoom: number;
  pan: [number, number];
  /** World maps only: the longitude at the centre. */
  rotLon?: number;
}
// The .mjs helpers infer narrow default-parameter types; these state the real ones.
const project = makeProjection as (id: string, o: ProjectionOptions) => Projection;
const isAvailable = projectionAvailable as (
  id: string,
  o: { observer: MapObserver | null; sat: SelectedSub | null },
) => boolean;
type Projection = ((p: [number, number]) => [number, number] | null) & object;
type NightBands = { sunBelowDeg: number; feature: unknown }[];
const draw = drawMap as unknown as (ctx: CanvasRenderingContext2D, o: Record<string, unknown>) => void;
const hit = hitTest as (sats: MapSat[], p: Projection, x: number, y: number) => number | null;
type LegendItem = { key: string; kind: string; label: string; color?: string };
const legend = legendItems as (o: { sats: MapSat[]; observer: MapObserver | null; minElevDeg: number }) => LegendItem[];
type Pt = { x: number; y: number };
type Box = { x0: number; y0: number; x1: number; y1: number };
type GratLabel = { text: string; x: number; y: number; align: string; baseline: string; line?: unknown };
type PlaceData = { places: unknown; regions: unknown };
type LabelSet = { places: unknown; graticule: GratLabel[] };
type LabelOpts = {
  width: number; height: number; zoom: number; projectionId: string; places: unknown; regions: unknown; sats: MapSat[];
  observer: MapObserver | null;
  /** Map controls laid over the canvas (zoom buttons, chips, menu, focus bar, legend). */
  controls: Box[];
};
const gratLabels = graticuleLabels as unknown as (
  p: Projection,
  o: { width: number; height: number; step: number; projectionId: string; avoid: Box[] },
) => GratLabel[];
const observerBoxOf = observerBox as unknown as (p: Projection, o: MapObserver | null) => Box | null;
const gratBox = graticuleBox as unknown as (l: GratLabel) => Box;
const gratStep = graticuleStep as unknown as (zoom: number, width: number) => number;
const tickBoxesOf = tickLabelBoxes as unknown as (s: MapSat, p: Projection) => Box[];
const satBoxesOf = satBoxes as unknown as (p: Projection, sats: MapSat[], width: number) => Box[];
type View = { zoom: number; pan: [number, number]; rotLon: number };
const fillOf = fillView as (id: string, o: { width: number; height: number }, lonDeg: number) => View | null;
const worldSizeOf = worldSize as (id: string, o: { width: number; height: number }) => { width: number; height: number };
const wrap = wrapLon as (lon: number) => number;
/** World maps wrap by rotation; discs pan. */
const isWorld = (id: string) => (FILL_PROJECTIONS as string[]).includes(id);
type LabelKeyOpts = {
  projectionId: string; width: number; height: number; zoom: number; pan: [number, number];
  observer: MapObserver | null; sub: SelectedSub | null; sats: MapSat[]; rotLon: number;
  controls: string; data: string;
};
const labelLayers = createLabelLayers as unknown as (picks: {
  graticule: (p: Projection, o: LabelOpts) => GratLabel[];
  places: (p: Projection, o: LabelOpts, graticule: GratLabel[]) => unknown;
}) => { get: (key: LabelKeyOpts, p: Projection, o: LabelOpts, flags?: { moving?: boolean }) => LabelSet };
const panTo = centredPan as (
  id: string,
  o: { width: number; height: number; observer: MapObserver | null; sat: SelectedSub | null; zoom: number },
  lonDeg: number,
  latDeg: number,
) => [number, number] | null;

const TAP_SLOP_PX = 6;
/** Labels keep this far clear of the controls laid over the map. */
const CONTROL_PAD_PX = 4;
const DOUBLE_TAP_MS = 300;
const NIGHT_REFRESH_MS = 60_000;
/** Where MapShell docks the map beside the panel (keep in step with home.css). */
const DOCKED_QUERY = "(min-width: 1100px)";

export default function FlatMap({
  sats,
  observer,
  projectionId,
  onProjectionChange,
  selectedId,
  minElevDeg,
  onSelect,
  selectedSub = null,
  top = null,
  chips = null,
  fill = false,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ zoom: 1, pan: [0, 0], rotLon: 0 });
  const size = useRef({ width: 0, height: 0, dpr: 1 });
  const projection = useRef<Projection | null>(null);
  const night = useRef<{ at: number; bands: NightBands } | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  // Read after mount (the server and first render draw dark).
  const themeRef = useRef<"dark" | "light">("dark");
  // Place data arrives after mount, in its own chunk.
  const placeData = useRef<PlaceData | null>(null);
  // Lat/lon labels re-pick only when the view or the controls change; place
  // names also re-pick as the satellites move (label-cache.mjs).
  const labelCache = useRef(
    labelLayers({
      graticule: (proj, o) => gratLabels(proj, {
        width: o.width, height: o.height, step: gratStep(o.zoom, o.width), projectionId: o.projectionId,
        avoid: o.controls,
      }),
      places: (proj, o, graticule) => {
        const obs = observerBoxOf(proj, o.observer);
        return (pickPlaceLabels as unknown as (p: Projection, o: Record<string, unknown>) => unknown)(proj, {
          width: o.width, height: o.height, zoom: o.zoom, places: o.places, regions: o.regions,
          // Clear of the controls, the lat/lon labels, the observer marker and
          // the satellites' dots and names.
          avoid: [
            ...o.controls, ...graticule.map(gratBox), ...(obs ? [obs] : []), ...satBoxesOf(proj, o.sats, o.width),
            ...o.sats.flatMap((s) => tickBoxesOf(s, proj)),
          ],
        });
      },
    }),
  );
  // While a drag or pinch is in progress the last labels are reused; they are
  // recomputed once when the gesture ends.
  const gesturing = useRef(false);
  const lastLabels = useRef<LabelSet | null>(null);
  const [full, setFull] = useState(false);
  const fullRef = useRef(false);
  fullRef.current = full;
  const nativeFull = useRef(false);
  // View to restore on exit, and a flag to fit the map to the shell once it has resized.
  const prevView = useRef<(View & { home: boolean }) | null>(null);
  // True while the view is the home view (no zoom or pan by hand since), so a
  // resize refits it. homeZoom is that view's zoom: above it the map owns touch.
  const atHome = useRef(true);
  const homeZoom = useRef(1);
  const fitOnResize = useRef(false);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Docked beside the panel the page never scrolls, so the map owns wheel and drag.
  const docked = useRef(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const legendId = useId();
  // The controls laid over the canvas, measured after each render and on
  // resize (never per frame), in canvas px: labels keep clear of them.
  const zoomRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const legendBoxRef = useRef<HTMLDivElement>(null);
  const controls = useRef<Box[]>([]);
  const controlsKey = useRef("");

  // A projection that is unavailable right now (no observer, no selected satellite)
  // is shown and drawn as the default. The saved choice is left alone so it
  // returns when it becomes available again.
  const effectiveId = isAvailable(projectionId, { observer, sat: selectedSub })
    ? projectionId
    : DEFAULT_PROJECTION;

  // Latest props, read by the draw loop and pointer handlers without re-binding them.
  const latest = useRef({ sats, observer, projectionId: effectiveId, selectedSub, onSelect });
  latest.current = { sats, observer, projectionId: effectiveId, selectedSub, onSelect };

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const { width, height, dpr } = size.current;
    if (!canvas || !ctx || !width) return;
    const cur = latest.current;
    const now = Date.now();
    if (!night.current || now - night.current.at > NIGHT_REFRESH_MS) {
      night.current = { at: now, bands: nightBands(new Date(now)) };
    }
    const proj = project(cur.projectionId, {
      width,
      height,
      observer: cur.observer,
      sat: cur.selectedSub,
      zoom: view.current.zoom,
      pan: view.current.pan,
      rotLon: view.current.rotLon,
    });
    projection.current = proj;
    // At zoom 1 the map leaves vertical scrolling to the page; zoomed in, it owns touch.
    // Full screen and the docked desktop map have no page to scroll, so they always own it.
    canvas.style.touchAction = view.current.zoom > homeZoom.current + 1e-6 || fullRef.current || docked.current
      ? "none"
      : "pan-y";
    let labels = lastLabels.current;
    {
      const data = placeData.current;
      const { zoom, pan, rotLon } = view.current;
      labels = labelCache.current.get(
        {
          projectionId: cur.projectionId, width, height, zoom, pan,
          observer: cur.observer, sub: cur.selectedSub, sats: cur.sats, rotLon,
          controls: controlsKey.current,
          data: data ? "p" : "g",
        },
        proj,
        {
          width, height, zoom, projectionId: cur.projectionId,
          places: data?.places ?? [], regions: data?.regions ?? [], sats: cur.sats,
          observer: cur.observer, controls: controls.current,
        },
        { moving: gesturing.current },
      );
      lastLabels.current = labels;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    // Clip to the map so zoomed or panned geometry stays inside the frame.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    draw(ctx, {
      projection: proj,
      width,
      height,
      land: loadLand(),
      nightBands: night.current.bands,
      sats: cur.sats,
      observer: cur.observer,
      zoom: view.current.zoom,
      labels: placeData.current ? labels : { places: [], graticule: labels.graticule },
      palette: MAP_PALETTES[themeRef.current],
    });
    ctx.restore();
  }, []);

  // Re-measure the overlaid controls; true when they moved. Each control's
  // box counts only where it covers the canvas (the focus bar above a phone
  // map and the legend below it do not).
  const measureControls = useCallback((): boolean => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const c = canvas.getBoundingClientRect();
    const els: Element[] = [];
    for (const el of [zoomRef.current, headRef.current, legendBoxRef.current]) if (el) els.push(el);
    // The chips and the menu, not the row between them (taps pass through it).
    if (topRef.current) els.push(...Array.from(topRef.current.children));
    const out: Box[] = [];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.right <= c.left || r.left >= c.right || r.bottom <= c.top || r.top >= c.bottom) continue;
      out.push({
        x0: r.left - c.left - CONTROL_PAD_PX,
        y0: r.top - c.top - CONTROL_PAD_PX,
        x1: r.right - c.left + CONTROL_PAD_PX,
        y1: r.bottom - c.top + CONTROL_PAD_PX,
      });
    }
    const key = out.map((b) => `${Math.round(b.x0)},${Math.round(b.y0)},${Math.round(b.x1)},${Math.round(b.y1)}`).join(";");
    controls.current = out;
    if (key === controlsKey.current) return false;
    controlsKey.current = key;
    return true;
  }, []);
  // After each render (chips, focus bar, legend or full screen changed). This
  // runs before the prop-change redraw below, so that draw sees the new boxes.
  useEffect(() => {
    if (measureControls()) redraw();
  });

  // The home view: a world map turns to centre the focused satellite, else
  // the observer, else lon 0, and in a frame taller than its aspect fills the
  // frame's height. Discs are zoom 1, unpanned.
  const homeView = useCallback((): View => {
    const { width, height } = size.current;
    const cur = latest.current;
    if (!isWorld(cur.projectionId)) {
      homeZoom.current = 1;
      return { zoom: 1, pan: [0, 0], rotLon: 0 };
    }
    const focus = cur.sats.find((s) => s.emphasis === "focus");
    const lon = wrap(focus?.position.lonDeg ?? cur.observer?.lonDeg ?? 0);
    const fit = fillOf(cur.projectionId, { width, height }, lon);
    homeZoom.current = fit?.zoom ?? 1;
    return fit ?? { zoom: 1, pan: [0, 0], rotLon: lon };
  }, []);
  // Degrees of longitude per screen px on a world map at this zoom.
  const degPerPx = useCallback((zoom: number) => {
    const { width, height } = size.current;
    const w = worldSizeOf(latest.current.projectionId, { width, height }).width;
    return w > 0 ? 360 / (w * zoom) : 0;
  }, []);
  // A world map's vertical pan: free above the home zoom, centred at or below it.
  const worldPanY = useCallback((zoom: number, y: number) => (zoom > homeZoom.current + 1e-6 ? y : 0), []);
  const goHome = useCallback(() => {
    view.current = homeView();
    atHome.current = true;
  }, [homeView]);
  const reset = useCallback(() => {
    goHome();
    redraw();
  }, [goHome, redraw]);
  // Zoom by factor k keeping the point (qx, qy) fixed on screen.
  const zoomAt = useCallback((k: number, qx: number, qy: number) => {
    atHome.current = false;
    const { width, height } = size.current;
    const z1 = view.current.zoom;
    const z2 = clampZoom(z1 * k);
    const kk = z2 / z1;
    const cx = width / 2;
    const cy = height / 2;
    const [px, py] = view.current.pan;
    const y = qy - cy - (qy - cy - py) * kk;
    if (isWorld(latest.current.projectionId)) {
      // The anchor's horizontal shift becomes a turn of the globe; pan[0] stays 0.
      const turn = (qx - cx) * (1 / z1 - 1 / z2) * degPerPx(1);
      view.current = { zoom: z2, pan: [0, worldPanY(z2, y)], rotLon: wrap(view.current.rotLon + turn) };
    } else {
      view.current = {
        zoom: z2,
        pan: z2 === 1 ? [0, 0] : [qx - cx - (qx - cx - px) * kk, y],
        rotLon: 0,
      };
    }
    redraw();
  }, [redraw, degPerPx, worldPanY]);
  const zoomBy = (k: number) => zoomAt(k, size.current.width / 2, size.current.height / 2);

  // Fit the canvas backing store to the wrapper's CSS size (set in home.css)
  // and re-fit only when that size or the pixel ratio actually changes.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const fit = () => {
      const width = Math.round(wrap.clientWidth);
      const height = Math.round(wrap.clientHeight);
      if (!width || !height) return;
      const dpr = window.devicePixelRatio || 1;
      const cur = size.current;
      if (cur.width === width && cur.height === height && cur.dpr === dpr) return;
      size.current = { width, height, dpr };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      measureControls();
      // The home zoom follows the frame even when the view is not at home, so
      // touch, wheel and vertical pan switch over at the right zoom after a
      // rotation or leaving full screen.
      const id = latest.current.projectionId;
      homeZoom.current = isWorld(id) ? fillOf(id, { width, height }, view.current.rotLon)?.zoom ?? 1 : 1;
      // A new size refits the home view (on load, on resize, and entering full
      // screen); a view zoomed or panned by hand is kept.
      if (fitOnResize.current || atHome.current) {
        fitOnResize.current = false;
        goHome();
      }
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    // Browser zoom changes the pixel ratio without resizing the wrapper.
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [redraw, goHome, measureControls]);
  // Controls that change size outside a render (fonts loading, the focus bar
  // wrapping) re-measure too.
  const hasTop = top != null;
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (measureControls()) redraw();
    });
    for (const el of [zoomRef.current, headRef.current, legendBoxRef.current, topRef.current]) if (el) ro.observe(el);
    for (const el of Array.from(topRef.current?.children ?? [])) ro.observe(el);
    return () => ro.disconnect();
  }, [fill, hasTop, measureControls, redraw]);

  useEffect(() => {
    if (!fill || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(DOCKED_QUERY);
    const sync = () => {
      docked.current = mq.matches;
      measureControls();
      redraw();
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [fill, redraw, measureControls]);

  // Place names are 35 KB; fetch them after mount so first paint stays light.
  useEffect(() => {
    let alive = true;
    Promise.all([import("@/lib/map/places.json"), import("@/lib/map/regions.mjs")]).then(
      ([p, r]) => {
        if (!alive) return;
        placeData.current = {
          places: (p as { default?: unknown }).default ?? p,
          regions: (r as { REGIONS: unknown }).REGIONS,
        };
        redraw();
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [redraw]);

  // Entering full screen remembers the view; leaving restores it.
  useEffect(() => {
    if (full) {
      prevView.current = {
        zoom: view.current.zoom,
        pan: [...view.current.pan] as [number, number],
        rotLon: view.current.rotLon,
        home: atHome.current,
      };
      fitOnResize.current = true;
    } else {
      fitOnResize.current = false;
      if (prevView.current) {
        const { zoom, pan, rotLon, home } = prevView.current;
        prevView.current = null;
        // A home view refits to the frame on the way out (its size changes back).
        if (home) goHome();
        else {
          view.current = { zoom, pan, rotLon };
          atHome.current = false;
        }
        redraw();
      }
    }
  }, [full, redraw, goHome]);
  useEffect(() => () => {
    if (wheelTimer.current) clearTimeout(wheelTimer.current);
  }, []);

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
  // Redraw when the theme changes (and once on mount, to pick up light).
  useEffect(() => {
    const onTheme = () => {
      themeRef.current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
      redraw();
    };
    onTheme();
    window.addEventListener("seeksat:theme", onTheme);
    return () => window.removeEventListener("seeksat:theme", onTheme);
  }, [redraw]);
  // The wrapper changes size; the ResizeObserver refits, and the touch mode changes.
  useEffect(() => {
    redraw();
  }, [full, redraw]);

  // A new projection starts from its home view, and an untouched home view
  // follows the observer (it arrives after mount, once prefs load).
  const obsLon = observer?.lonDeg ?? null;
  useEffect(() => {
    goHome();
  }, [effectiveId, goHome]);
  useEffect(() => {
    if (atHome.current) goHome();
  }, [obsLon, goHome]);
  // Entering a focus pans once to centre it, keeping the zoom. It waits for the
  // satellite to have a position, then leaves the view alone.
  const centreOn = useRef<number | null>(null);
  useEffect(() => {
    centreOn.current = selectedId;
  }, [selectedId]);
  // The parent's clock tick passes new props each second; redraw on any prop change.
  useEffect(() => {
    const id = centreOn.current;
    const { width, height } = size.current;
    if (id != null && width) {
      const cur = latest.current;
      const sat = cur.sats.find((s) => s.noradId === id && s.emphasis === "focus");
      if (!CENTRE_ON_FOCUS.includes(cur.projectionId)) centreOn.current = null;
      else if (sat) {
        centreOn.current = null;
        if (isWorld(cur.projectionId)) {
          // World maps turn to put the satellite's longitude in the middle.
          view.current = { ...view.current, rotLon: wrap(sat.position.lonDeg) };
        } else {
          const pan = panTo(cur.projectionId, {
            width, height, observer: cur.observer, sat: cur.selectedSub, zoom: view.current.zoom,
          }, sat.position.lonDeg, sat.position.latDeg);
          if (pan) view.current = { ...view.current, pan };
        }
      }
    }
    redraw();
  }, [redraw, sats, observer, effectiveId, selectedSub, selectedId]);

  // Zoom, pan, pinch and tap.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pointers = new Map<number, Pt>();
    let moved = 0;
    let multi = false;
    let lastTap = { t: 0, x: 0, y: 0 };

    const local = (e: { clientX: number; clientY: number }): Pt => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const spread = () => {
      const [a, b] = [...pointers.values()];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    };

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, local(e));
      gesturing.current = true;
      if (pointers.size === 1) { moved = 0; multi = false; }
      else multi = true;
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const next = local(e);
      if (pointers.size === 1) {
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        moved += Math.abs(dx) + Math.abs(dy);
        const world = isWorld(latest.current.projectionId);
        if (moved >= TAP_SLOP_PX && world) {
          // Sideways turns the globe (it wraps for ever); up and down pans only above the home zoom.
          const { zoom, pan, rotLon } = view.current;
          view.current = {
            zoom,
            pan: [0, worldPanY(zoom, pan[1] + dy)],
            rotLon: wrap(rotLon - dx * degPerPx(zoom)),
          };
          atHome.current = false;
          redraw();
        } else if (moved >= TAP_SLOP_PX && (view.current.zoom > 1 || fullRef.current || docked.current)) {
          const [px, py] = view.current.pan;
          view.current.pan = [px + dx, py + dy];
          atHome.current = false;
          redraw();
        }
        pointers.set(e.pointerId, next);
      } else if (pointers.size === 2) {
        const before = spread();
        pointers.set(e.pointerId, next);
        const after = spread();
        if (before.dist > 0) zoomAt(after.dist / before.dist, after.mid.x, after.mid.y);
        const mx = after.mid.x - before.mid.x;
        const my = after.mid.y - before.mid.y;
        if (isWorld(latest.current.projectionId)) {
          const { zoom, pan, rotLon } = view.current;
          atHome.current = false;
          view.current = { zoom, pan: [0, worldPanY(zoom, pan[1] + my)], rotLon: wrap(rotLon - mx * degPerPx(zoom)) };
          redraw();
        } else if (view.current.zoom > 1 || fullRef.current || docked.current) {
          const [px, py] = view.current.pan;
          atHome.current = false;
          view.current.pan = [px + mx, py + my];
          redraw();
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      const wasOnly = pointers.size === 1;
      const at = local(e);
      pointers.delete(e.pointerId);
      if (pointers.size === 0 && gesturing.current) {
        gesturing.current = false;
        redraw();
      }
      // One finger left after a pinch: let it pan straight away, but never tap.
      if (pointers.size === 1) moved = TAP_SLOP_PX;
      if (!wasOnly || multi || moved >= TAP_SLOP_PX) return;
      // A tap: a second tap close in time and place resets the view, else it selects.
      const now = e.timeStamp;
      if (now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(at.x - lastTap.x, at.y - lastTap.y) < 24) {
        lastTap = { t: 0, x: 0, y: 0 };
        reset();
        return;
      }
      lastTap = { t: now, x: at.x, y: at.y };
      const proj = projection.current;
      if (!proj) return;
      const found = hit(latest.current.sats, proj, at.x, at.y);
      if (found != null) latest.current.onSelect(found);
    };
    const onCancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size === 0 && gesturing.current) {
        gesturing.current = false;
        redraw();
      }
      if (pointers.size === 1) moved = TAP_SLOP_PX;
    };
    // Plain wheel scrolls the page at zoom 1; ctrl/meta (trackpad pinch), a zoomed map,
    // full screen or the docked map captures it.
    const onWheel = (e: WheelEvent) => {
      const pinch = e.ctrlKey || e.metaKey;
      if (!pinch && view.current.zoom <= homeZoom.current + 1e-6 && !fullRef.current && !docked.current) return;
      e.preventDefault();
      // Labels hold still while wheel events stream in, then catch up once.
      gesturing.current = true;
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => {
        wheelTimer.current = null;
        gesturing.current = false;
        redraw();
      }, 150);
      const p = local(e);
      zoomAt(Math.exp(-e.deltaY * (pinch ? 0.01 : 0.002)), p.x, p.y);
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", reset);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", reset);
    };
  }, [redraw, zoomAt, reset, degPerPx, worldPanY]);

  const chipRow = (
    <div className="flat-map__top" ref={topRef}>
      {chips}
      <select
        className="flat-map__menu"
        aria-label="Map projection"
        value={effectiveId}
        onChange={(e) => onProjectionChange(e.target.value)}
      >
        {PROJECTIONS.map((p: { id: string; label: string }) => (
          <option
            key={p.id}
            value={p.id}
            disabled={!isAvailable(p.id, { observer, sat: selectedSub })}
          >
            {p.label}
          </option>
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
        {top ? <div className="flat-map__head" ref={headRef}>{top}</div> : null}
        {chipRow}
      </div>
    ) : top}
    <div className="flat-map" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="flat-map__canvas"
        role="img"
        aria-label="Map of followed satellites"
      />
      {fill ? null : chipRow}
      <div className="flat-map__zoom" ref={zoomRef}>
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.5)}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.5)}>{"\u2212"}</button>
        <button type="button" aria-label="Reset view" onClick={reset}>Reset view</button>
        <button
          type="button"
          aria-label={full ? "Exit full screen" : "Full screen"}
          onClick={toggleFull}
        >
          {"\u26F6"}
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
      <div className={`map-legend-box${legendOpen ? " map-legend-box--open" : ""}`} ref={legendBoxRef}>
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
