"use client";

import { useEffect, useId, useRef, useState } from "react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { copySvgPngToClipboard } from "@/lib/pass-finder/polar-png.js";
import { POLAR_CAPTION } from "./PolarPlotSvg";

export interface ChartRenderResult {
  blobUrl: string;
  filename: string;
}

export interface SkyChartModalViewProps {
  open: boolean;
  /** The dialog's accessible name. */
  title: string;
  /** What is being charted (e.g. the observer id). A new subject hides
   *  the modal until its chart is painted. */
  subjectKey: string;
  /** Paint the chart into `svgEl` and resolve its PNG blob URL + export
   *  file name, or null when there is nothing to chart. A new function
   *  repaints; for the same subject the modal stays visible meanwhile. */
  render: (svgEl: SVGSVGElement) => Promise<ChartRenderResult | null>;
  onClose: () => void;
  /** Copy button behaviour; defaults to rasterizing the SVG to the
   *  clipboard. */
  copy?: (svgEl: SVGSVGElement) => Promise<void>;
  /** Shows a Doppler button that switches to the radio chart. */
  onRadioChart?: () => void;
}

// Fullscreen sky-chart (polar plot) dialog, always dark. `render` does the
// imperative SVG paint into our svgRef (offscreen, outside the dialog, so it
// can paint before the dialog opens) + returns a blob URL we hand to the
// img / download anchor. The Modal closes on Close, backdrop click and
// Escape. Copy + Save both use the same SVG, just to a different
// destination.
export default function SkyChartModalView({
  open, title, subjectKey, render, onClose, copy = copySvgPngToClipboard, onRadioChart,
}: SkyChartModalViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const headingId = useId();
  // The painted PNG, shown in the img and saved by the link.
  const [png, setPng] = useState<ChartRenderResult | null>(null);
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

  useEffect(() => {
    if (!open) {
      if (lastBlobUrlRef.current) {
        URL.revokeObjectURL(lastBlobUrlRef.current);
        lastBlobUrlRef.current = null;
      }
      setPng(null);
      setRenderedKey(null);
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
        if (!result) return;
        // Revoke previous URL before adopting the new one.
        if (lastBlobUrlRef.current) URL.revokeObjectURL(lastBlobUrlRef.current);
        lastBlobUrlRef.current = result.blobUrl;
        setPng(result);
        setRenderedKey(subjectKey);
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
  }, [open, render, subjectKey]);

  const visible = open && renderedKey === subjectKey;

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
    <>
      <svg
        ref={svgRef}
        className="polar-modal-svg"
        viewBox="-24 -68 248 278"
        aria-hidden="true"
      />
      <Modal
        open={visible}
        onClose={onClose}
        // The toolbar shows what the chart is; the dialog is named by the heading below.
        title={POLAR_CAPTION}
        labelledBy={headingId}
        tone="dark"
        actions={(
          <>
            <Button size="sm" done={copyStatus === "copied"} title="Copy image to clipboard" onClick={onCopy}>
              {copyStatus === "copied" ? "Copied!" : "Copy"}
            </Button>
            <Button size="sm" title="Download as PNG" onClick={() => linkRef.current?.click()}>
              Save PNG
            </Button>
            {onRadioChart && (
              <Button size="sm" title="Doppler + signal chart for this pass" onClick={onRadioChart}>
                Doppler
              </Button>
            )}
          </>
        )}
      >
        <div className="chart-modal">
          <h2 id={headingId} className="sr-only">{title}</h2>
          <a
            ref={linkRef}
            className="chart-modal__link"
            download={png?.filename ?? "iss-pass.png"}
            href={png?.blobUrl ?? "#"}
            // Block accidental real left-clicks on the image (right-click
            // → "Save image as" is the intended UX). isTrusted is false
            // for programmatic .click() calls, so the Save PNG button
            // still triggers the download.
            onClick={(ev) => { if (ev.isTrusted) ev.preventDefault(); }}
          >
            {png && <img className="chart-modal__img chart-modal__img--sky" src={png.blobUrl} alt="Pass sky chart" />}
          </a>
          <p className="chart-modal__hint">
            <span className="chart-hint--mouse">Right-click the image to save · click outside or press Esc to close.</span>
            <span className="chart-hint--touch">Press and hold the image to save · tap outside to close.</span>
          </p>
        </div>
      </Modal>
    </>
  );
}
