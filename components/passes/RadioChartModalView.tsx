"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Modal from "@/components/ui/Modal";
import { BANDS, bandOf } from "@/lib/radio/bands.mjs";
import { uplinkText } from "@/lib/radio/uplink.mjs";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import StatTile from "@/components/ui/StatTile";
import { Details } from "@/components/ui/Disclosure";
import { cx } from "@/lib/ui/classes.mjs";
import { copySvgPngToClipboard } from "@/lib/pass-finder/polar-png.js";
import {
  formatZoneAbbr, paintRadioChartCompact, radioChartCaption, radioChartHeading,
  radioMethodsNote, statTiles, tuneRows,
} from "@/lib/pass-finder/radio-chart.js";
import { type ChartRenderResult } from "./SkyChartModalView";

/** A painted radio chart, plus the series and chart options it was painted
 *  from, so the phone layout can draw its own view without recomputing. */
type PickerLink = { hz: number; label: string; mode?: string | null; uplink?: { hz: number; highHz?: number; mode?: string; tone?: number; invert?: boolean } | null };
const bandList = BANDS as ReadonlyArray<{ id: string; label: string }>;
const band = bandOf as (hz: number) => string;
const upText = uplinkText as (u: PickerLink["uplink"]) => string | null;

/** The picker's options: one per frequency (SatNOGS can list two modes on
 *  one), grouped by band in frequency order. An arrow marks one with an uplink. */
function pickerGroups(links: ReadonlyArray<PickerLink>) {
  const seen = new Set<number>();
  const unique = [...links].sort((a, b) => a.hz - b.hz).filter((d) => !seen.has(d.hz) && !!seen.add(d.hz));
  return bandList
    .map((b) => ({ band: b.id, label: b.label, links: unique.filter((d) => band(d.hz) === b.id) }))
    .filter((g) => g.links.length > 0);
}

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
  downlinks: ReadonlyArray<PickerLink>;
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

// Fullscreen radio-pass (Doppler + angular-rate + signal) dialog, always
// dark. Same shape as SkyChartModalView: `render` does the imperative SVG
// paint into our offscreen svgRef + returns a blob URL we hand to the img /
// download anchor. The Modal closes on Close, backdrop click and Escape.
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
  const linkRef = useRef<HTMLAnchorElement>(null);
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
  // Read through a ref so a caller's inline onClose doesn't repaint.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) {
      if (lastBlobUrlRef.current) {
        URL.revokeObjectURL(lastBlobUrlRef.current);
        lastBlobUrlRef.current = null;
      }
      setPng(null);
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
        setPng({ blobUrl: result.blobUrl, filename: result.filename });
        setDetail(result.series && result.meta ? { series: result.series, meta: result.meta } : null);
        setRenderedKey(subjectKey);
      } catch (e) {
        if (cancelled) return;
        console.warn("Radio modal render failed:", e);
        // As with no series: close rather than stay open but invisible.
        onCloseRef.current();
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

  useEffect(() => {
    if (!open || visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
  // Until the chart is painted the Modal is not open yet, so Esc is handled
  // here: it closes, and the page behind (focus on the map) leaves it alone.
  // Capture, so the page's own Esc listeners see it as handled.
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, visible]);

  // "Copied!" reverts after a moment; the timer goes when the dialog closes.
  const copyTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (open) return;
    if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = null;
    setCopyStatus("idle");
  }, [open]);
  useEffect(() => () => {
    if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
  }, []);

  const onCopy = async () => {
    if (!svgRef.current) return;
    try {
      await copy(svgRef.current);
      setCopyStatus("copied");
      if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopyStatus("idle"), 1400);
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

  // A typed frequency in MHz, on Enter or leaving the box.
  const applyCustom = (text: string) => {
    const mhz = Number(text);
    if (Number.isFinite(mhz) && mhz > 1) onFreqChange(Math.round(mhz * 1e6));
  };

  return (
    <>
      <svg
        ref={svgRef}
        className="radio-modal-svg"
        viewBox="0 0 320 250"
        aria-hidden="true"
      />
      <Modal
        open={visible}
        onClose={onClose}
        title={title}
        hideTitle
        wide
        tone="dark"
        actions={(
          <>
            {/* What to tune, at the left; the files and Sky chart at the right, by Close. */}
            <div className="chart-modal__tune">
              <div className="chart-modal__freq">
                <Field label="Downlink frequency" hideLabel>
                  <select
                    value={freqHz ?? ""}
                    onChange={(ev) => onFreqChange(ev.target.value ? Number(ev.target.value) : null)}
                  >
                    {downlinks.length === 0 && !freqHz && <option value="">no known downlink</option>}
                    {pickerGroups(downlinks).map((g) => (
                      <optgroup key={g.band} label={g.label}>
                        {g.links.map((d) => (
                          <option key={d.hz} value={d.hz}>
                            {`${(d.hz / 1e6).toFixed(3)}${d.mode ? ` ${d.mode.toUpperCase()}` : ""}${d.uplink ? " \u2191" : ""} \u2014 ${d.label}`}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    {/* A freeform frequency (from the input below) that isn't in the
                        catalog matches no <option> above - without this the menu
                        silently falls back to its first option while the chart
                        keeps using the typed frequency, which looks like the
                        picker desynced from the chart. */}
                    {freqHz != null && !downlinks.some((d) => d.hz === freqHz) && (
                      <option value={freqHz}>
                        custom — {(freqHz / 1e6).toFixed(3)} MHz
                      </option>
                    )}
                  </select>
                </Field>
              </div>
              <div className="chart-modal__custom">
                <span aria-hidden="true">Custom</span>
                <Field label="Custom downlink frequency in MHz" hideLabel>
                  <input
                    className="chart-modal__mhz"
                    type="number"
                    step="0.001"
                    placeholder="e.g. 145.800"
                    enterKeyHint="go"
                    onBlur={(ev) => applyCustom(ev.currentTarget.value)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter") {
                        ev.preventDefault();
                        applyCustom(ev.currentTarget.value);
                      }
                    }}
                  />
                </Field>
                <span aria-hidden="true">MHz</span>
              </div>
            </div>
            <div className="chart-modal__tools">
              <Button size="sm" done={copyStatus === "copied"} title="Copy image to clipboard" onClick={onCopy}>
                {copyStatus === "copied" ? "Copied!" : "Copy"}
              </Button>
              <Button size="sm" title="Download as PNG" onClick={() => linkRef.current?.click()}>
                Save PNG
              </Button>
              <Button size="sm" title="Download 1s-step Doppler series as CSV" onClick={onCsv}>
                CSV
              </Button>
              {onSkyChart && (
                <Button size="sm" title="Sky chart for this pass - where to point" onClick={onSkyChart}>
                  Sky chart
                </Button>
              )}
            </div>
            {(() => {
              // The chosen frequency's uplink: what to transmit on, with its tone.
              const up = downlinks.find((d) => d.hz === freqHz)?.uplink;
              const text = up ? upText(up) : null;
              return text ? <p className="chart-modal__uplink">{text.replace(/^Uplink/, "Transmit")}</p> : null;
            })()}
            {extraControls}
          </>
        )}
      >
        <div className={cx("chart-modal", "chart-modal--radio", phoneView && "chart-modal--phone", phoneView && fullSize && "chart-modal--full")}>
          {phoneView && phone && (
            <div className="radio-phone">
              <h3 className="radio-phone__title">{phone.heading.title}</h3>
              <p className="radio-phone__sub">
                {/* Non-breaking hyphens, so the date never splits across lines. */}
                {phone.heading.sub.replace(/(\d{4})-(\d{2})-(\d{2})/, "$1\u2011$2\u2011$3")}
              </p>
              <div className="radio-phone__tiles">
                {phone.tiles.map((t) => (
                  <StatTile key={t.label} size="sm" label={t.label} value={t.value} />
                ))}
              </div>
              {phone.rows.length > 0 && (
                <table className="radio-tune">
                  <caption>Tune at</caption>
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Time ({phone.zone})</th>
                      <th scope="col">Tune (MHz)</th>
                      {/* With an uplink, where to transmit beats the shift. */}
                      {phone.rows[0].transmit ? <th scope="col">Transmit</th> : <th scope="col">Doppler</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {phone.rows.map((r) => (
                      <tr key={r.label}>
                        <th scope="row">{r.label}</th>
                        <td>{r.time}</td>
                        <td>{r.tune}</td>
                        <td>{r.transmit ?? r.offset}</td>
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
              {phone.caption && <p className="radio-phone__legend">{phone.caption}</p>}
              <div className="radio-phone__full">
                <Button size="sm" aria-expanded={fullSize} onClick={() => setFullSize((v) => !v)}>
                  {fullSize ? "Fit to screen" : "Open full size"}
                </Button>
              </div>
            </div>
          )}
          <a
            ref={linkRef}
            className="chart-modal__link"
            download={png?.filename ?? "radio-pass.png"}
            href={png?.blobUrl ?? "#"}
            // Block accidental real left-clicks on the image (right-click
            // → "Save image as" is the intended UX). isTrusted is false
            // for programmatic .click() calls, so the Save PNG button
            // still triggers the download.
            onClick={(ev) => { if (ev.isTrusted) ev.preventDefault(); }}
          >
            {png && <img className="chart-modal__img chart-modal__img--radio" src={png.blobUrl} alt="Radio pass chart" />}
          </a>
          {phoneView && phone && (
            <Details summary="About this prediction" className="radio-phone__about">
              <p>{phone.methods}</p>
            </Details>
          )}
          <p className="chart-modal__hint">
            <span className="chart-hint--mouse">Right-click the image to save · click outside or press Esc to close.</span>
            <span className="chart-hint--touch">Press and hold the image to save · tap outside to close.</span>
          </p>
        </div>
      </Modal>
    </>
  );
}
