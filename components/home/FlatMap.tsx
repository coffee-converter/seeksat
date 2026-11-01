"use client";

import { useCallback, useEffect, useRef } from "react";
import { drawMap, hitTest } from "@/lib/map/draw.mjs";
import { loadLand, nightBands } from "@/lib/map/geometry.mjs";
import {
  PROJECTIONS,
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
  track: GeoShape;
  position: { lonDeg: number; latDeg: number };
  footprint: GeoShape | null;
  selected: boolean;
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
type Pt = { x: number; y: number };

const TAP_SLOP_PX = 6;
const DOUBLE_TAP_MS = 300;
const NIGHT_REFRESH_MS = 60_000;

function mapHeight(): number {
  return Math.max(220, Math.round(window.innerHeight * 0.5));
}

export default function FlatMap({
  sats,
  observer,
  projectionId,
  onProjectionChange,
  selectedId,
  onSelect,
  selectedSub = null,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ zoom: 1, pan: [0, 0] as [number, number] });
  const size = useRef({ width: 0, height: 0, dpr: 1 });
  const projection = useRef<Projection | null>(null);
  const night = useRef<{ at: number; bands: NightBands } | null>(null);

  // Latest props, read by the draw loop and pointer handlers without re-binding them.
  const latest = useRef({ sats, observer, projectionId, selectedSub, onSelect });
  latest.current = { sats, observer, projectionId, selectedSub, onSelect };

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
    });
    ctx.restore();
  }, []);

  // Fit the canvas to its container and the viewport, and re-fit on change.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const fit = () => {
      const width = Math.round(wrap.clientWidth);
      if (!width) return;
      const height = mapHeight();
      const dpr = window.devicePixelRatio || 1;
      size.current = { width, height, dpr };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.height = `${height}px`;
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    window.addEventListener("orientationchange", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", fit);
    };
  }, [redraw]);

  // Redraw once a second from the props the parent updates, and on any prop change.
  useEffect(() => {
    const id = window.setInterval(redraw, 1000);
    return () => window.clearInterval(id);
  }, [redraw]);
  useEffect(() => {
    redraw();
  }, [redraw, sats, observer, projectionId, selectedSub, selectedId]);

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
    const reset = () => {
      view.current = { zoom: 1, pan: [0, 0] };
      redraw();
    };
    // Zoom by factor k keeping the point (qx, qy) fixed on screen.
    const zoomAt = (k: number, qx: number, qy: number) => {
      const { width, height } = size.current;
      const z1 = view.current.zoom;
      const z2 = clampZoom(z1 * k);
      const kk = z2 / z1;
      const cx = width / 2;
      const cy = height / 2;
      const [px, py] = view.current.pan;
      view.current = {
        zoom: z2,
        pan: [qx - cx - (qx - cx - px) * kk, qy - cy - (qy - cy - py) * kk],
      };
    };
    const spread = () => {
      const [a, b] = [...pointers.values()];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    };

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, local(e));
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
        if (moved >= TAP_SLOP_PX) {
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
        const [px, py] = view.current.pan;
        view.current.pan = [px + after.mid.x - before.mid.x, py + after.mid.y - before.mid.y];
        redraw();
      }
    };
    const onUp = (e: PointerEvent) => {
      const wasOnly = pointers.size === 1;
      const at = local(e);
      pointers.delete(e.pointerId);
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
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      zoomAt(Math.exp(-e.deltaY * 0.002), p.x, p.y);
      redraw();
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
  }, [redraw]);

  const availability = { observer, sat: selectedSub };

  return (
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
        value={projectionId}
        onChange={(e) => onProjectionChange(e.target.value)}
      >
        {PROJECTIONS.map((p: { id: string; label: string }) => (
          <option
            key={p.id}
            value={p.id}
            disabled={!isAvailable(p.id, availability)}
          >
            {p.label}
          </option>
        ))}
      </select>
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
  );
}
