"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import LiveDial from "@/components/live/LiveDial";
import { radioSeries } from "@/lib/passes/charts.js";
import { trueNow } from "@/lib/pass-finder/clock-sync.js";
import { liveState, clockText, tuneMode } from "@/lib/live/live-state.mjs";
import { turnHint, headingFromOrientation } from "@/lib/live/heading.mjs";
import { compass } from "@/lib/sat/pass-rows.mjs";
import type { ChartSubject } from "@/components/passes/PassChartModals";

type Sample = { tMs: number; azDeg: number; elDeg: number; rangeM: number; dopplerHz: number | null; dopplerRateHzPerSec: number | null };
type Live = {
  phase: "before" | "during" | "after";
  azDeg: number | null; elDeg: number | null; rangeKm: number | null;
  dopplerHz: number | null; rateHzPerSec: number | null;
  msToRise: number | null; msToSet: number | null; msToPeak: number | null;
  peakElDeg: number; peakAzDeg: number;
};
const stateAt = liveState as (s: Sample[], now: number) => Live;
const clock = clockText as (ms: number) => string;
const tuneOf = tuneMode as (live: Live | null, freqHz: number | null) => "none" | "pick" | "tune" | "waiting" | "over";
const hint = turnHint as (target: number, heading: number) => { deltaDeg: number; text: string };
const headingOf = headingFromOrientation as (e: unknown) => number | null;
const point = compass as (az: number) => string;
const build = radioSeries as (a: Record<string, unknown>) => { series: { samples: Sample[] } } | null;

type OrientationCtor = { requestPermission?: () => Promise<"granted" | "denied"> };

interface Props {
  subject: ChartSubject;
  freqHz: number | null;
  downlinkLabel: string | null;
  onChart: (kind: "sky" | "radio") => void;
  onClose: () => void;
}

// The pass right now: where to point, how long until it rises, peaks or
// sets, and where to tune. Sampled once (1 s steps), read four times a second.
export default function LiveView({ subject, freqHz, downlinkLabel, onChart, onClose }: Props) {
  const { track, obs, pass, minElevDeg } = subject;
  const samples = useMemo(() => build({
    track, obs, anchorMs: (pass as { peakMs: number }).peakMs, minElevDeg, freqHz, purpose: "csv",
  })?.series.samples ?? [], [track, obs, pass, minElevDeg, freqHz]);
  const [now, setNow] = useState(() => trueNow());
  useEffect(() => {
    const id = window.setInterval(() => setNow(trueNow()), 250);
    return () => window.clearInterval(id);
  }, []);

  // Keep the screen on while the view is open, and again after the tab returns.
  useEffect(() => {
    type Lock = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<Lock> } };
    if (!nav.wakeLock) return;
    let lock: Lock | null = null;
    let closed = false;
    const take = () => nav.wakeLock!.request("screen").then((l) => {
      if (closed) l.release().catch(() => {}); else lock = l;
    }).catch(() => {});
    const onVis = () => { if (document.visibilityState === "visible") take(); };
    take();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", onVis);
      lock?.release().catch(() => {});
    };
  }, []);

  // The phone compass, only after a tap (iOS asks permission).
  const [heading, setHeading] = useState<number | null>(null);
  const [compassOn, setCompassOn] = useState(false);
  const hasOrientation = typeof window !== "undefined" && "DeviceOrientationEvent" in window;
  useEffect(() => {
    if (!compassOn) return;
    const on = (e: Event) => { const h = headingOf(e); if (h != null) setHeading(h); };
    const type = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(type, on);
    return () => window.removeEventListener(type, on);
  }, [compassOn]);
  const startCompass = async () => {
    const ctor = (window as unknown as { DeviceOrientationEvent: OrientationCtor }).DeviceOrientationEvent;
    if (ctor.requestPermission && (await ctor.requestPermission().catch(() => "denied")) !== "granted") return;
    setCompassOn(true);
  };

  // Esc closes; focus starts on the close button.
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    // Capture, so the page's own Esc (clear focus) never sees this one.
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  const live = samples.length ? stateAt(samples, now) : null;
  const status = !live ? "This pass can't be shown live."
    : live.phase === "before" ? `Rises in ${clock(live.msToRise!)} in the ${point(live.azDeg!)}`
      : live.phase === "during" ? `Sets in ${clock(live.msToSet!)}`
        : "This pass is over.";
  const peak = live && live.msToPeak != null ? `Peak ${Math.round(live.peakElDeg)}° in ${clock(live.msToPeak)}` : null;
  const turn = live && live.azDeg != null && heading != null ? hint(live.azDeg, heading).text : null;
  const titleId = "live-view-title";
  const tune = tuneOf(live, freqHz);
  // Screen readers hear the phase change, not every tick of the countdown.
  const phaseText = !live ? "" : live.phase === "before" ? "Not up yet." : live.phase === "during" ? "The satellite is up." : "This pass is over.";
  return (
    <div className="live-view" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="live-view__inner">
        <header className="live-view__head">
          <div>
            <h2 id={titleId} className="live-view__title">{`${track.shortName} live`}</h2>
            <p className="live-view__sub">{`From ${obs.name}`}</p>
          </div>
          <button ref={closeRef} type="button" className="home-chip" onClick={onClose}>Close</button>
        </header>
        <p className="sr-only" aria-live="polite">{phaseText}</p>
        <p className="live-view__status">
          <strong>{status}</strong>{peak && <span>{` · ${peak}`}</span>}
        </p>
        <LiveDial
          track={samples}
          now={live && live.azDeg != null && live.elDeg != null ? { azDeg: live.azDeg, elDeg: live.elDeg } : null}
          headingDeg={compassOn ? heading : null}
        />
        {turn && <p className="live-view__turn">{turn}</p>}
        {live && live.azDeg != null && live.elDeg != null && (
          <dl className="live-view__nums">
            <div><dt>Azimuth</dt><dd>{`${Math.round(live.azDeg)}° ${point(live.azDeg)}`}</dd></div>
            <div><dt>Elevation</dt><dd>{`${Math.round(live.elDeg)}°`}</dd></div>
            <div><dt>Range</dt><dd>{`${Math.round(live.rangeKm!).toLocaleString()} km`}</dd></div>
          </dl>
        )}
        <section className="live-view__radio" aria-label="Tuning">
          {tune === "none" ? null : tune === "pick" ? (
            <p className="home-note">Pick a frequency in the radio chart to see where to tune.</p>
          ) : tune === "over" ? (
            <p className="home-note">{"The pass has set. Its radio chart still has the full Doppler curve."}</p>
          ) : tune === "tune" && live && live.dopplerHz != null && freqHz != null ? (
            <>
              <p className="live-view__tune">
                <span className="live-view__tune-label">{live.phase === "before" ? "At rise, tune" : "Tune"}</span>
                <span className="live-view__tune-mhz">{`${((freqHz + live.dopplerHz) / 1e6).toFixed(4)} MHz`}</span>
              </p>
              <p className="live-view__doppler">
                {`Doppler ${live.dopplerHz >= 0 ? "+" : ""}${(live.dopplerHz / 1000).toFixed(1)} kHz`}
                {live.phase === "during" && live.rateHzPerSec != null && (Math.abs(live.rateHzPerSec) < 1
                  ? ", steady"
                  : `, ${live.rateHzPerSec < 0 ? "falling" : "rising"} ${Math.abs(Math.round(live.rateHzPerSec))} Hz/s`)}
                {downlinkLabel && ` · ${downlinkLabel}`}
              </p>
              <p className="home-note">{"Predicted. The satellite's own offset is unknown."}</p>
            </>
          ) : (
            <p className="home-note">{`${((freqHz ?? 0) / 1e6).toFixed(3)} MHz once it rises.`}</p>
          )}
        </section>
        <div className="live-view__actions">
          {hasOrientation && !compassOn && (
            <button type="button" className="home-chip" onClick={startCompass}>Use phone compass</button>
          )}
          <button type="button" className="home-chip" onClick={() => onChart("sky")}>Sky chart</button>
          <button type="button" className="home-chip" onClick={() => onChart("radio")}>Radio chart</button>
        </div>
      </div>
    </div>
  );
}
