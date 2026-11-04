"use client";

import { useFocusTrap } from "@/components/ui/useFocusTrap";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { copySvgPngToClipboard } from "@/lib/pass-finder/polar-png.js";
import {
  formatZoneAbbr, paintRadioChartCompact, radioChartCaption, radioChartHeading,
  radioMethodsNote, statTiles, tuneRows,
} from "@/lib/pass-finder/radio-chart.js";
import { type ChartRenderResult } from "./SkyChartModalView";

/** A painted radio chart, plus the series and chart options it was painted
 *  from, so the phone layout can draw its own view without recomputing. */
export interface RadioRenderResult extends ChartRenderResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  series?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta?: any;
}

/** Phones get a phone-width chart with HTML tiles instead of the shrunken
 *  desktop image. Matches the modal's own 600 px breakpoint in home.css. */
const PHONE_QUERY = "(max-width: 600px)";

function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(PHONE_QUERY);
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return phone;
}

export interface RadioChartModalViewProps {
  open: boolean;
  /** The dialog's accessible name. */
  title: string;
  /** What is being charted (e.g. the observer id). A new subject hides
   *  the modal until its chart is painted. */
  subjectKey: string;
  /** Paint the chart into `svgEl` and resolve its PNG blob URL + export
   *  file name, or null when there is no series to chart (the modal then
   *  closes). A new function repaints; for the same subject the modal
   *  stays visible meanwhile (e.g. after a frequency change). */
  render: (svgEl: SVGSVGElement) => Promise<RadioRenderResult | null>;
  /** Build the CSV download, or null when there is nothing to export. */
  csv: () => { csv: string; filename: string } | null;
  /** The selected downlink frequency, or null for none. */
  freqHz: number | null;
  /** Known downlinks for the frequency picker. */
  downlinks: ReadonlyArray<{ hz: number; label: string }>;
  onFreqChange: (hz: number | null) => void;
  onClose: () => void;
  /** Copy button behaviour; defaults to rasterizing the SVG to the
   *  clipboard. */
  copy?: (svgEl: SVGSVGElement) => Promise<void>;
  /** Shows a Sky chart button that switches to the sky chart. */
  onSkyChart?: () => void;
  /** More controls, after the frequency fields. */
  extraControls?: ReactNode;
}

// Fullscreen radio-pass (Doppler + angular-rate + signal) modal chrome.
// Same shape as SkyChartModalView: `render` does the imperative SVG
// paint into our svgRef + returns a blob URL we can hand to the img /
// download anchor. Close from: ✕ button, backdrop click, Escape key.
// Copy + Save both use the same SVG, just to a different destination.
export default function RadioChartModalView({
  open, title, subjectKey, render, csv, freqHz, downlinks, onFreqChange, onClose,
  copy = copySvgPngToClipboard, onSkyChart, extraControls,
}: RadioChartModalViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const phoneSvgRef = useRef<SVGSVGElement>(null);
  const isPhone = useIsPhone();
  // The series and options behind the painted chart, for the phone layout.
  const [detail, setDetail] = useState<{ series: RadioRenderResult["series"]; meta: RadioRenderResult["meta"] } | null>(null);
  // Phones: show the full desktop image in a scroll box instead of the phone view.
  const [fullSize, setFullSize] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  // Modal stays hidden until the SVG + PNG blob are ready - matches
  // the legacy flow (cursor: progress; then reveal). Without this, a
  // fast click would flash an empty modal for the ~50-250ms render
  // time. `renderedKey === subjectKey` is the gate.
  const [renderedKey, setRenderedKey] = useState<string | null>(null);
  // Stash the blob URL so we can revoke it when the chart changes / closes.
  const lastBlobUrlRef = useRef<string | null>(null);

  // Revoke the live blob URL on unmount too, not only on close.
  useEffect(() => () => {
    if (lastBlobUrlRef.current) URL.revokeObjectURL(lastBlobUrlRef.current);
  }, []);
  // Read through a ref so a caller's inline onClose doesn't repaint.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) {
      if (lastBlobUrlRef.current) {
        URL.revokeObjectURL(lastBlobUrlRef.current);
        lastBlobUrlRef.current = null;
      }
      if (imgRef.current) imgRef.current.removeAttribute("src");
      setRenderedKey(null);
      setDetail(null);
      setFullSize(false);
      return;
    }
    let cancelled = false;
    document.body.style.cursor = "progress";
    (async () => {
      try {
        if (!svgRef.current) return;
        const result = await render(svgRef.current);
        if (cancelled) {
          if (result) URL.revokeObjectURL(result.blobUrl);
          return;
        }
        if (!result) {
          // render resolves null when the series can't be built (e.g. no
          // window yet - toggling radio mode before running a search).
          // Without this, `renderedKey` never matches, `visible` stays false
          // forever, and reopening for the same pass is a no-op - the
          // modal is stuck open-but-invisible with no feedback. Close
          // it instead.
          console.warn("Radio modal: no series for this observer yet");
          onCloseRef.current();
          return;
        }
        // Revoke previous URL before adopting the new one.
        if (lastBlobUrlRef.current) URL.revokeObjectURL(lastBlobUrlRef.current);
        lastBlobUrlRef.current = result.blobUrl;
        if (imgRef.current) imgRef.current.src = result.blobUrl;
        if (linkRef.current) {
          linkRef.current.href = result.blobUrl;
          linkRef.current.download = result.filename;
        }
        setDetail(result.series && result.meta ? { series: result.series, meta: result.meta } : null);
        setRenderedKey(subjectKey);
      } catch (e) {
        if (!cancelled) console.warn("Radio modal render failed:", e);
      } finally {
        document.body.style.cursor = "";
      }
    })();
    return () => {
      cancelled = true;
      document.body.style.cursor = "";
    };
  }, [open, render, subjectKey]);

  const visible = open && renderedKey === subjectKey;
  const phoneView = isPhone && detail != null;

  // A new pass starts fitted to the screen.
  useEffect(() => { setFullSize(false); }, [subjectKey]);

  // Paint the phone chart once its <svg> is mounted, and again whenever the
  // series changes (a new frequency).
  useEffect(() => {
    if (!phoneView || !detail || !phoneSvgRef.current) return;
    paintRadioChartCompact(phoneSvgRef.current, detail.series, detail.meta);
  }, [phoneView, detail]);

  const phone = useMemo(() => {
    if (!detail) return null;
    const { series, meta } = detail;
    const rows = tuneRows(series, meta);
    return {
      heading: radioChartHeading(series, meta),
      tiles: statTiles(series, meta),
      rows,
      zone: rows.length ? formatZoneAbbr(Math.round(rows[0].tMs), meta.tz) ?? "UTC" : "UTC",
      caption: radioChartCaption(series, meta),
      methods: radioMethodsNote(series, meta),
    };
  }, [detail]);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, visible);

  // Escape closes; only attached while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Handled here: the page behind (focus on the map) leaves it alone.
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    // Capture, so the page's own Esc listeners see it as handled.
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, onClose]);

  // Move focus into the modal once it becomes visible so keyboard
  // users can tab through the controls without first having to tab
  // through the entire underlying page.
  useEffect(() => {
    if (visible) closeBtnRef.current?.focus();
  }, [visible]);

  const onCopy = async () => {
    if (!svgRef.current) return;
    try {
      await copy(svgRef.current);
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 1400);
    } catch (e) {
      console.warn("Copy failed:", e);
    }
  };

  // 1s-step series (finer than the 2s chart) for driving a rig or a
  // camera trigger. Header carries the epoch age, clock skew, and
  // elevation provenance the reader needs to judge the data.
  const onCsv = () => {
    const result = csv();
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    // The caller names the file - it knows the satellite, the
    // observer's timezone, and the pass instant.
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Defer the revoke past this tick - revoking synchronously right
    // after a programmatic click is a known source of dropped downloads
    // in Safari. The PNG path (linkRef) keeps its URL alive until the
    // next render; match that here instead of racing the browser.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div
      id="radio-modal"
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      hidden={!visible}
    >
      <div className="radio-modal-backdrop" onClick={onClose} />
      <div className={`radio-modal-content${phoneView ? " is-phone" : ""}${phoneView && fullSize ? " is-full" : ""}`}>
        <div className="radio-modal-actions">
          <button
            ref={closeBtnRef}
            className="radio-modal-close"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
          <button
            className={`radio-modal-copy${copyStatus === "copied" ? " copied" : ""}`}
            type="button"
            title="Copy image to clipboard"
            onClick={onCopy}
          >
            {copyStatus === "copied" ? "Copied!" : "Copy"}
          </button>
          <button
            className="radio-modal-save"
            type="button"
            title="Download as PNG"
            onClick={() => linkRef.current?.click()}
          >
            Save PNG
          </button>
          <button
            className="radio-modal-csv"
            type="button"
            title="Download 1s-step Doppler series as CSV"
            onClick={onCsv}
          >
            CSV
          </button>
          {onSkyChart && (
            <button
              className="radio-modal-polar"
              type="button"
              title="Sky chart for this pass - where to point"
              onClick={onSkyChart}
            >
              Sky chart
            </button>
          )}
          <select
            className="radio-freq-select"
            value={freqHz ?? ""}
            onChange={(ev) => onFreqChange(ev.target.value ? Number(ev.target.value) : null)}
          >
            {downlinks.length === 0 && !freqHz && <option value="">no known downlink</option>}
            {downlinks.map((d) => (
              <option key={d.hz} value={d.hz}>
                {(d.hz / 1e6).toFixed(3)} MHz — {d.label}
              </option>
            ))}
            {/* A freeform frequency (from the input below) that isn't in the
                catalog matches no <option> above - without this the select
                silently falls back to its first option while the chart
                keeps using the typed frequency, which looks like the
                picker desynced from the chart. */}
            {freqHz != null && !downlinks.some((d) => d.hz === freqHz) && (
              <option value={freqHz}>
                custom — {(freqHz / 1e6).toFixed(3)} MHz
              </option>
            )}
          </select>
          <label className="radio-field">
            <span>Custom</span>
            <input
              className="radio-freq-input"
              type="number"
              step="0.001"
              placeholder="000.000"
              aria-label="Custom downlink frequency in MHz"
              onBlur={(ev) => {
                const mhz = Number(ev.target.value);
                if (Number.isFinite(mhz) && mhz > 1) onFreqChange(Math.round(mhz * 1e6));
              }}
            />
            <span>MHz</span>
          </label>
          {extraControls}
        </div>
        {phoneView && phone && (
          <div className="radio-phone">
            <h2 className="radio-phone-title">{phone.heading.title}</h2>
            <p className="radio-phone-sub">
              {/* Non-breaking hyphens, so the date never splits across lines. */}
              {phone.heading.sub.replace(/(\d{4})-(\d{2})-(\d{2})/, "$1\u2011$2\u2011$3")}
            </p>
            <dl className="radio-phone-tiles">
              {phone.tiles.map((t) => (
                <div key={t.label}>
                  <dt>{t.label}</dt>
                  <dd>{t.value}</dd>
                </div>
              ))}
            </dl>
            {phone.rows.length > 0 && (
              <table className="radio-tune">
                <caption>Tune at</caption>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Time ({phone.zone})</th>
                    <th scope="col">Tune (MHz)</th>
                    <th scope="col">Doppler</th>
                  </tr>
                </thead>
                <tbody>
                  {phone.rows.map((r) => (
                    <tr key={r.label}>
                      <th scope="row">{r.label}</th>
                      <td>{r.time}</td>
                      <td>{r.tune}</td>
                      <td>{r.offset}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <svg
              ref={phoneSvgRef}
              className="radio-phone-svg"
              role="img"
              aria-label={`${phone.heading.title}: Doppler, signal and angular rate over the pass`}
            />
            {phone.caption && <p className="radio-phone-legend">{phone.caption}</p>}
            <button
              type="button"
              className="radio-phone-full"
              aria-expanded={fullSize}
              onClick={() => setFullSize((v) => !v)}
            >
              {fullSize ? "Fit to screen" : "Open full size"}
            </button>
          </div>
        )}
        <svg
          ref={svgRef}
          className="radio-modal-svg"
          viewBox="0 0 320 250"
          aria-hidden="true"
        />
        <a
          ref={linkRef}
          className="radio-modal-png-link"
          download="radio-pass.png"
          href="#"
          // Block accidental real left-clicks on the image (right-click
          // → "Save image as" is the intended UX). isTrusted is false
          // for programmatic .click() calls, so the Save PNG button
          // still triggers the download.
          onClick={(ev) => { if (ev.isTrusted) ev.preventDefault(); }}
        >
          <img ref={imgRef} className="radio-modal-png" alt="Radio pass chart" />
        </a>
        {phoneView && phone && (
          <details className="radio-phone-about">
            <summary>About this prediction</summary>
            <p>{phone.methods}</p>
          </details>
        )}
        <p className="radio-modal-hint">
          <span className="chart-hint--mouse">Right-click the image to save · click outside or press Esc to close.</span>
          <span className="chart-hint--touch">Press and hold the image to save · tap outside to close.</span>
        </p>
      </div>
    </div>
  );
}
