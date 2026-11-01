"use client";

import { useEffect, useRef, useState } from "react";
import { svgToPngBlob } from "@/lib/pass-finder/polar-png.js";

export interface ChartRenderResult {
  blobUrl: string;
  filename: string;
}

/** Rasterize a chart SVG to a PNG and write it to the system clipboard.
 *  Throws if the Clipboard API is unavailable or the user denies
 *  permission. The default Copy behaviour for both chart modals. */
export async function copySvgPng(svgEl: SVGSVGElement): Promise<void> {
  const blob = await svgToPngBlob(svgEl);
  if (!navigator.clipboard?.write) throw new Error("Clipboard API unavailable");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

export interface SkyChartModalViewProps {
  open: boolean;
  /** The dialog's accessible name. */
  title: string;
  /** Paint the chart into `svgEl` and resolve its PNG blob URL + export
   *  file name, or null when there is nothing to chart. A new function
   *  repaints; the modal stays hidden until the new paint resolves. */
  render: (svgEl: SVGSVGElement) => Promise<ChartRenderResult | null>;
  onClose: () => void;
  /** Copy button behaviour; defaults to rasterizing the SVG to the
   *  clipboard. */
  copy?: (svgEl: SVGSVGElement) => Promise<void>;
  /** Shows a Doppler button that switches to the radio chart. */
  onRadioChart?: () => void;
}

// Fullscreen sky-chart (polar plot) modal chrome. `render` does the
// imperative SVG paint into our svgRef + returns a blob URL we can hand
// to the img / download anchor. Close from: ✕ button, backdrop click,
// Escape key. Copy + Save both use the same SVG, just to a different
// destination.
export default function SkyChartModalView({
  open, title, render, onClose, copy = copySvgPng, onRadioChart,
}: SkyChartModalViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  // Modal stays hidden until the SVG + PNG blob are ready - matches
  // the legacy flow (cursor: progress; then reveal). Without this, a
  // fast click would flash an empty modal for the ~50-250ms render
  // time. `renderedFor === render` is the gate.
  const [renderedFor, setRenderedFor] = useState<SkyChartModalViewProps["render"] | null>(null);
  // Stash the blob URL so we can revoke it when the chart changes / closes.
  const lastBlobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      if (lastBlobUrlRef.current) {
        URL.revokeObjectURL(lastBlobUrlRef.current);
        lastBlobUrlRef.current = null;
      }
      if (imgRef.current) imgRef.current.removeAttribute("src");
      setRenderedFor(null);
      return;
    }
    let cancelled = false;
    document.body.style.cursor = "progress";
    (async () => {
      try {
        if (!svgRef.current) return;
        const result = await render(svgRef.current);
        if (cancelled || !result) return;
        // Revoke previous URL before adopting the new one.
        if (lastBlobUrlRef.current) URL.revokeObjectURL(lastBlobUrlRef.current);
        lastBlobUrlRef.current = result.blobUrl;
        if (imgRef.current) imgRef.current.src = result.blobUrl;
        if (linkRef.current) {
          linkRef.current.href = result.blobUrl;
          linkRef.current.download = result.filename;
        }
        // Functional form: `render` is itself a function.
        setRenderedFor(() => render);
      } catch (e) {
        if (!cancelled) console.warn("Polar modal render failed:", e);
      } finally {
        document.body.style.cursor = "";
      }
    })();
    return () => {
      cancelled = true;
      document.body.style.cursor = "";
    };
  }, [open, render]);

  const visible = open && renderedFor === render;

  // Escape closes; only attached while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Move focus into the modal once it becomes visible so keyboard
  // users can tab through Copy / Save / Close without first having
  // to tab through the entire underlying page.
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

  return (
    <div
      id="polar-modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      hidden={!visible}
    >
      <div className="polar-modal-backdrop" onClick={onClose} />
      <div className="polar-modal-content">
        <div className="polar-modal-actions">
          <button
            ref={closeBtnRef}
            className="polar-modal-close"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
          <button
            className={`polar-modal-copy${copyStatus === "copied" ? " copied" : ""}`}
            type="button"
            title="Copy image to clipboard"
            onClick={onCopy}
          >
            {copyStatus === "copied" ? "Copied!" : "Copy"}
          </button>
          <button
            className="polar-modal-save"
            type="button"
            title="Download as PNG"
            onClick={() => linkRef.current?.click()}
          >
            Save PNG
          </button>
          {onRadioChart && (
            <button
              className="polar-modal-radio"
              type="button"
              title="Doppler + signal chart for this pass"
              onClick={onRadioChart}
            >
              Doppler
            </button>
          )}
        </div>
        <svg
          ref={svgRef}
          className="polar-modal-svg"
          viewBox="-24 -68 248 278"
          aria-hidden="true"
        />
        <a
          ref={linkRef}
          className="polar-modal-png-link"
          download="iss-pass.png"
          href="#"
          // Block accidental real left-clicks on the image (right-click
          // → "Save image as" is the intended UX). isTrusted is false
          // for programmatic .click() calls, so the Save PNG button
          // still triggers the download.
          onClick={(ev) => { if (ev.isTrusted) ev.preventDefault(); }}
        >
          <img ref={imgRef} className="polar-modal-png" alt="Pass sky chart" />
        </a>
        <p className="polar-modal-hint">
          Right-click the image to save · click outside or press Esc to close.
        </p>
      </div>
    </div>
  );
}
