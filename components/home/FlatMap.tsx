"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { drawMap, hitTest } from "@/lib/map/draw.mjs";
import { legendItems } from "@/lib/map/legend.mjs";
import { loadLand, nightBands } from "@/lib/map/geometry.mjs";
import { graticuleBox, graticuleLabels, graticuleStep, pickPlaceLabels } from "@/lib/map/labels.mjs";
import { createLabelCache, labelKey } from "@/lib/map/label-cache.mjs";
import {
  PROJECTIONS,
  DEFAULT_PROJECTION,
  clampZoom,
  makeProjection,
  projectionAvailable,
} from "@/lib/map/projections.mjs";

// Minimal GeoJSON shapes; the geometry helpers produce these.
type GeoShape = { type: string; coordinates: unknown };

export interface MapSat {
  noradId: number;
  name: string;
  color: string;
  trackPast: GeoShape;
  trackFuture: GeoShape;
  trackTicks: { lonDeg: number; latDeg: number; minutes: number }[];
  position: { lonDeg: number; latDeg: number };
  footprint: GeoShape | null;
  selected: boolean;
  orbitClass: string;
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
  selectedId: number | null;
  minElevDeg: number;
  onSelect: (noradId: number) => void;
  /** Subpoint and altitude of the selected satellite, for the "From the satellite" view. */
  selectedSub?: SelectedSub | null;
}

interface ProjectionOptions {
  width: number;
  height: number;
  observer: MapObserver | null;
  sat: SelectedSub | null;
  zoom: number;
  pan: [number, number];
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
type LabelOpts = { width: number; height: number; zoom: number; projectionId: string; places: unknown; regions: unknown };
const gratLabels = graticuleLabels as unknown as (
  p: Projection,
  o: { width: number; height: number; step: number; projectionId: string },
) => GratLabel[];
const gratBox = graticuleBox as unknown as (l: GratLabel) => Box;
const gratStep = graticuleStep as unknown as (zoom: number) => number;
const pickPlaces = (
  createLabelCache as unknown as (pick: (p: Projection, o: LabelOpts) => LabelSet) => {
    get: (key: string, args: [Projection, LabelOpts]) => LabelSet;
  }
);
const keyOf = labelKey as unknown as (o: {
  projectionId: string; width: number; height: number; zoom: number; pan: [number, number];
  observer: MapObserver | null; sub: SelectedSub | null;
}) => string;

const TAP_SLOP_PX = 6;
const DOUBLE_TAP_MS = 300;
const NIGHT_REFRESH_MS = 60_000;

export default function FlatMap({
  sats,
  observer,
  projectionId,
  onProjectionChange,
  selectedId,
  minElevDeg,
  onSelect,
  selectedSub = null,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ zoom: 1, pan: [0, 0] as [number, number] });
  const size = useRef({ width: 0, height: 0, dpr: 1 });
  const projection = useRef<Projection | null>(null);
  const night = useRef<{ at: number; bands: NightBands } | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  // Place data arrives after mount, in its own chunk.
  const placeData = useRef<PlaceData | null>(null);
  const labelCache = useRef(
    pickPlaces((proj, o) => {
      const graticule = gratLabels(proj, {
        width: o.width, height: o.height, step: gratStep(o.zoom), projectionId: o.projectionId,
      });
      const places = (pickPlaceLabels as unknown as (p: Projection, o: Record<string, unknown>) => unknown)(proj, {
        width: o.width, height: o.height, zoom: o.zoom, places: o.places, regions: o.regions,
        avoid: graticule.map(gratBox),
      });
      return { graticule, places };
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
    });
    projection.current = proj;
    // At zoom 1 the map leaves vertical scrolling to the page; zoomed in, it owns touch.
    // Full screen has no page to scroll, so it always owns touch.
    canvas.style.touchAction = view.current.zoom > 1 || fullRef.current ? "none" : "pan-y";
    let labels = lastLabels.current;
    if (!(gesturing.current && labels)) {
      const data = placeData.current;
      const { zoom, pan } = view.current;
      const key = `${keyOf({
        projectionId: cur.projectionId, width, height, zoom, pan,
        observer: cur.observer, sub: cur.selectedSub,
      })}|${data ? "p" : "g"}`;
      labels = labelCache.current.get(key, [
        proj,
        { width, height, zoom, projectionId: cur.projectionId, places: data?.places ?? [], regions: data?.regions ?? [] },
      ]);
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
    });
    ctx.restore();
  }, []);

  const reset = useCallback(() => {
    view.current = { zoom: 1, pan: [0, 0] };
    redraw();
  }, [redraw]);
  // Zoom by factor k keeping the point (qx, qy) fixed on screen.
  const zoomAt = useCallback((k: number, qx: number, qy: number) => {
    const { width, height } = size.current;
    const z1 = view.current.zoom;
    const z2 = clampZoom(z1 * k);
    const kk = z2 / z1;
    const cx = width / 2;
    const cy = height / 2;
    const [px, py] = view.current.pan;
    view.current = {
      zoom: z2,
      pan: z2 === 1 ? [0, 0] : [qx - cx - (qx - cx - px) * kk, qy - cy - (qy - cy - py) * kk],
    };
    redraw();
  }, [redraw]);
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
  }, [redraw]);

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

  const toggleFull = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (fullRef.current) {
      if (nativeFull.current && document.fullscreenElement) void document.exitFullscreen();
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
      if (e.key === "Escape" && fallback) setFull(false);
    };
    if (fallback) document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (fallback) document.body.style.overflow = "";
    };
  }, [full]);
  // The wrapper changes size; the ResizeObserver refits, and the touch mode changes.
  useEffect(() => {
    redraw();
  }, [full, redraw]);

  // A new projection starts from the default view.
  useEffect(() => {
    view.current = { zoom: 1, pan: [0, 0] };
  }, [effectiveId]);
  // The parent's clock tick passes new props each second; redraw on any prop change.
  useEffect(() => {
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
        if (moved >= TAP_SLOP_PX && (view.current.zoom > 1 || fullRef.current)) {
          const [px, py] = view.current.pan;
          view.current.pan = [px + dx, py + dy];
          redraw();
        }
        pointers.set(e.pointerId, next);
      } else if (pointers.size === 2) {
        const before = spread();
        pointers.set(e.pointerId, next);
        const after = spread();
        if (before.dist > 0) zoomAt(after.dist / before.dist, after.mid.x, after.mid.y);
        if (view.current.zoom > 1 || fullRef.current) {
          const [px, py] = view.current.pan;
          view.current.pan = [px + after.mid.x - before.mid.x, py + after.mid.y - before.mid.y];
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
    // Plain wheel scrolls the page at zoom 1; ctrl/meta (trackpad pinch), a zoomed map or full screen captures it.
    const onWheel = (e: WheelEvent) => {
      const pinch = e.ctrlKey || e.metaKey;
      if (!pinch && view.current.zoom <= 1 && !fullRef.current) return;
      e.preventDefault();
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
  }, [redraw, zoomAt, reset]);

  return (
    <div className={`flat-map-shell${full ? " flat-map-shell--full" : ""}`} ref={shellRef}>
    <div className="flat-map" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="flat-map__canvas"
        role="img"
        aria-label="Map of followed satellites"
      />
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
      <div className="flat-map__zoom">
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.5)}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.5)}>{"\u2212"}</button>
        <button type="button" aria-label="Reset view" onClick={reset}>Reset view</button>
        <button
          type="button"
          aria-label={full ? "Exit full screen" : "Full screen"}
          aria-pressed={full}
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
          {sats.map((s) => (
            <tr key={s.noradId}>
              <th scope="row">{s.name}{s.noradId === selectedId ? " (selected)" : ""}</th>
              <td>{s.position.latDeg.toFixed(1)} degrees</td>
              <td>{s.position.lonDeg.toFixed(1)} degrees</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <ul className="map-legend" aria-label="Map legend">
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
    </div>
  );
}
