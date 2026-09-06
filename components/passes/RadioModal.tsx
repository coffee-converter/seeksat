"use client";

import { useEffect, useRef, useState } from "react";
import { usePassFinderStore } from "@/lib/pass-finder-store";
import { renderRadioModal, copyPolarPng, radioPassCsvFor } from "@/lib/scene-bridge";
import { CATALOG } from "@/lib/catalog.mjs";

// Find observer name from id without subscribing to the entire
// observers slice (we only need the name when the modal is visible,
// and even then it's a one-shot read for the dialog label).
function useObserverName(obsId: string | null): string | undefined {
  return usePassFinderStore((s) =>
    obsId ? s.observers.find((o) => o.id === obsId)?.name : undefined,
  );
}

// Fullscreen radio-pass (Doppler + angular-rate + signal) modal. Same
// shape as PolarModal: React owns open/close + button chrome, the
// scene bridge's renderRadioModal does the imperative SVG paint into
// our svgRef + returns a blob URL we can hand to the img / download
// anchor. Close from: ✕ button, backdrop click, Escape key. Copy +
// Save buttons go through scene-exposed helpers (they both rasterize
// the same SVG, just to a different destination).
export default function RadioModal() {
  const obsId = usePassFinderStore((s) => s.radioModalObsId);
  const setObsId = usePassFinderStore((s) => s.setRadioModalObsId);
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

  // Frequency picker (spec §15): a known downlink from the catalog, or
  // a custom frequency typed in. Empty options + no custom frequency
  // means the sampler returns dopplerHz: null for every sample and the
  // painter skips the Doppler polyline - the other two panels still draw.
  const selectedNoradId = usePassFinderStore((s) => s.selectedNoradId);
  const downlinkHz = usePassFinderStore((s) => s.downlinkHz);
  const setDownlinkHz = usePassFinderStore((s) => s.setDownlinkHz);
  const entry = CATALOG.find((s) => s.noradId === selectedNoradId);
  const options = entry?.downlinks ?? [];

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
        const result = await renderRadioModal(svgRef.current, obsId);
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
        if (!cancelled) console.warn("Radio modal render failed:", e);
      } finally {
        document.body.style.cursor = "";
      }
    })();
    return () => {
      cancelled = true;
      document.body.style.cursor = "";
    };
  }, [obsId, downlinkHz]);

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
  // users can tab through the controls without first having to tab
  // through the entire underlying page.
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

  // 1s-step series (finer than the 2s chart) for driving a rig or a
  // camera trigger. Header carries the epoch age, clock skew, and
  // elevation provenance the reader needs to judge the data.
  const onCsv = async () => {
    if (!obsId) return;
    const csv = await radioPassCsvFor(obsId);
    if (!csv) return;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `radio-pass-${obsName ?? "observer"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      id="radio-modal"
      role="dialog"
      aria-modal="true"
      aria-label={obsName ? `Radio pass — ${obsName}` : "Radio pass chart"}
      hidden={!visible}
    >
      <div className="radio-modal-backdrop" onClick={() => setObsId(null)} />
      <div className="radio-modal-content">
        <div className="radio-modal-actions">
          <button
            ref={closeBtnRef}
            className="radio-modal-close"
            type="button"
            aria-label="Close"
            onClick={() => setObsId(null)}
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
          <select
            className="radio-freq-select"
            value={downlinkHz ?? ""}
            onChange={(ev) => setDownlinkHz(ev.target.value ? Number(ev.target.value) : null)}
          >
            {options.length === 0 && <option value="">no known downlink</option>}
            {options.map((d) => (
              <option key={d.hz} value={d.hz}>
                {(d.hz / 1e6).toFixed(3)} MHz — {d.label}
              </option>
            ))}
          </select>
          <input
            className="radio-freq-input"
            type="number"
            step="0.001"
            placeholder="MHz"
            aria-label="Custom downlink frequency in MHz"
            onBlur={(ev) => {
              const mhz = Number(ev.target.value);
              if (Number.isFinite(mhz) && mhz > 1) setDownlinkHz(Math.round(mhz * 1e6));
            }}
          />
        </div>
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
        <p className="radio-modal-hint">
          Right-click the image to save · click outside or press Esc to close.
        </p>
      </div>
    </div>
  );
}
