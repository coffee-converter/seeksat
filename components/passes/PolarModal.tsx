"use client";

import { useEffect, useRef, useState } from "react";
import { usePassFinderStore } from "@/lib/pass-finder-store";
import { renderPolarModal, copyPolarPng } from "@/lib/scene-bridge";

// Find observer name from id without subscribing to the entire
// observers slice (we only need the name when the modal is visible,
// and even then it's a one-shot read for the dialog label).
function useObserverName(obsId: string | null): string | undefined {
  return usePassFinderStore((s) =>
    obsId ? s.observers.find((o) => o.id === obsId)?.name : undefined,
  );
}

// Fullscreen polar-plot modal. React owns the open/close + button
// chrome; the scene bridge's renderPolarModal does the imperative
// SVG paint into our svgRef + returns a blob URL we can hand to
// the img / download anchor. Close from: ✕ button, backdrop click,
// Escape key. Copy + Save buttons go through scene-exposed helpers
// (they both rasterize the same SVG, just to a different destination).
export default function PolarModal() {
  const obsId = usePassFinderStore((s) => s.polarModalObsId);
  const setObsId = usePassFinderStore((s) => s.setPolarModalObsId);
  const obsName = useObserverName(obsId);
  const svgRef = useRef<SVGSVGElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  // Modal stays hidden until the SVG + PNG blob are ready - matches
  // the legacy flow (cursor: progress; then reveal). Without this, a
  // fast click would flash an empty modal for the ~50-250ms render
  // time. `renderedObsId === obsId` is the gate.
  const [renderedObsId, setRenderedObsId] = useState<string | null>(null);
  // Stash the blob URL so we can revoke it when obsId changes / unmounts.
  const lastBlobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!obsId) {
      if (lastBlobUrlRef.current) {
        URL.revokeObjectURL(lastBlobUrlRef.current);
        lastBlobUrlRef.current = null;
      }
      if (imgRef.current) imgRef.current.removeAttribute("src");
      setRenderedObsId(null);
      return;
    }
    let cancelled = false;
    document.body.style.cursor = "progress";
    (async () => {
      try {
        if (!svgRef.current) return;
        const result = await renderPolarModal(svgRef.current, obsId);
        if (cancelled || !result) return;
        // Revoke previous URL before adopting the new one.
        if (lastBlobUrlRef.current) URL.revokeObjectURL(lastBlobUrlRef.current);
        lastBlobUrlRef.current = result.blobUrl;
        if (imgRef.current) imgRef.current.src = result.blobUrl;
        if (linkRef.current) {
          linkRef.current.href = result.blobUrl;
          linkRef.current.download = result.filename;
        }
        setRenderedObsId(obsId);
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
  }, [obsId]);

  const visible = !!obsId && renderedObsId === obsId;

  // Escape closes; only attached while open.
  useEffect(() => {
    if (!obsId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setObsId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [obsId, setObsId]);

  // Move focus into the modal once it becomes visible so keyboard
  // users can tab through Copy / Save / Close without first having
  // to tab through the entire underlying page.
  useEffect(() => {
    if (visible) closeBtnRef.current?.focus();
  }, [visible]);

  const onCopy = async () => {
    if (!svgRef.current) return;
    try {
      await copyPolarPng(svgRef.current);
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
      aria-label={obsName ? `Sky chart - ${obsName}` : "Pass sky chart"}
      hidden={!visible}
    >
      <div className="polar-modal-backdrop" onClick={() => setObsId(null)} />
      <div className="polar-modal-content">
        <div className="polar-modal-actions">
          <button
            ref={closeBtnRef}
            className="polar-modal-close"
            type="button"
            aria-label="Close"
            onClick={() => setObsId(null)}
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
