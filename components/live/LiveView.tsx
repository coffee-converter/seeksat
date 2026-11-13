"use client";

import { useEffect, useMemo, useState } from "react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Surface from "@/components/ui/Surface";
import LiveDial from "@/components/live/LiveDial";
import LivePassBar from "@/components/live/LivePassBar";
import { radioSeries } from "@/lib/passes/charts.js";
import { trueNow } from "@/lib/pass-finder/clock-sync.js";
import { liveState, clockText, tuneMode } from "@/lib/live/live-state.mjs";
import { needsTone, uplinkDopplerHz } from "@/lib/radio/uplink.mjs";
import { turnHint, headingFromOrientation, compassOffered } from "@/lib/live/heading.mjs";
import { barStart } from "@/lib/live/progress.mjs";
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
const headingOf = headingFromOrientation as (e: unknown, screenAngleDeg?: number) => number | null;
const offerCompass = compassOffered as (win: unknown) => boolean;
const NO_READING_MS = 3000;
const point = compass as (az: number) => string;
const startOf = barStart as (pass: unknown, firstMs: number) => { label: string; ms: number | null };
const build = radioSeries as (a: Record<string, unknown>) => { series: { samples: Sample[] } } | null;

/** An uplink as lib/catalog.mjs and lib/mirror/satnogs.mjs store it. */
export type Uplink = { hz: number; highHz?: number; mode?: string; tone?: number; invert?: boolean };
const toneMissing = needsTone as (u: Uplink) => boolean;
const upShift = uplinkDopplerHz as (down: number | null, downHz: number | null, upHz: number) => number | null;

type OrientationCtor = { requestPermission?: () => Promise<"granted" | "denied"> };

interface Props {
  subject: ChartSubject;
  freqHz: number | null;
  downlinkLabel: string | null;
  /** The chosen downlink's uplink, when it is a repeater or transponder. */
  uplink: Uplink | null;
  /** The chosen downlink's mode ("fm", "lrpt"), shown beside its frequency. */
  downlinkMode?: string | null;
  onChart: (kind: "sky" | "radio") => void;
  onClose: () => void;
}

// The pass right now: where to point, how long until it rises, peaks or
// sets, and where to tune. Sampled once (1 s steps), read four times a second.
export default function LiveView({ subject, freqHz, downlinkLabel, uplink, downlinkMode = null, onChart, onClose }: Props) {
  const { track, obs, pass, minElevDeg } = subject;
  const samples = useMemo(() => build({
    track, obs, anchorMs: (pass as { peakMs: number }).peakMs, minElevDeg, freqHz, purpose: "csv",
  })?.series.samples ?? [], [track, obs, pass, minElevDeg, freqHz]);
  // The pass's ends and peak, from the samples the countdowns read.
  const span = useMemo(() => {
    if (!samples.length) return null;
    let peak = samples[0];
    for (const s of samples) if (s.elDeg > peak.elDeg) peak = s;
    return { firstMs: samples[0].tMs, lastMs: samples[samples.length - 1].tMs, peakMs: peak.tMs };
  }, [samples]);
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
  // Why the compass isn't steering the dial, when it isn't.
  const [compassNote, setCompassNote] = useState<string | null>(null);
  // Only phones and tablets: a laptop has the event but no compass behind it.
  // The view renders on the client only (the chart modals load with ssr off).
  const [hasCompass] = useState(() => typeof window !== "undefined" && offerCompass(window));
  useEffect(() => {
    if (!compassOn) return;
    let got = false;
    const on = (e: Event) => {
      const h = headingOf(e, screen.orientation?.angle ?? 0);
      if (h == null) return;
      got = true;
      setCompassNote(null);
      setHeading(h);
    };
    const type = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(type, on);
    const quiet = window.setTimeout(() => {
      if (!got) setCompassNote("No compass reading. This device may not have one.");
    }, NO_READING_MS);
    return () => {
      window.removeEventListener(type, on);
      window.clearTimeout(quiet);
    };
  }, [compassOn]);
  const startCompass = async () => {
    const ctor = (window as unknown as { DeviceOrientationEvent: OrientationCtor }).DeviceOrientationEvent;
    if (ctor.requestPermission && (await ctor.requestPermission().catch(() => "denied")) !== "granted") {
      setCompassNote("Compass permission was denied. Use the dial with north up.");
      return;
    }
    setCompassOn(true);
  };

  const live = samples.length ? stateAt(samples, now) : null;
  const status = !live ? "This pass can't be shown live."
    : live.phase === "before" ? `Rises in ${clock(live.msToRise!)} in the ${point(live.azDeg!)}`
      : live.phase === "during" ? `Sets in ${clock(live.msToSet!)}`
        : "This pass is over.";
  const peak = live && live.msToPeak != null ? `Peak ${Math.round(live.peakElDeg)}° in ${clock(live.msToPeak)}` : null;
  const turn = live && live.azDeg != null && heading != null ? hint(live.azDeg, heading).text : null;
  const tune = tuneOf(live, freqHz);
  // Screen readers hear the phase change, not every tick of the countdown.
  const phaseText = !live ? "" : live.phase === "before" ? "Not up yet." : live.phase === "during" ? "The satellite is up." : "This pass is over.";
  // The Modal traps focus, closes on Esc (before the page's own Esc) and
  // starts focus on Close.
  return (
    <Modal open onClose={onClose} title={`${track.shortName} live`} size="full">
      <div className="live-view">
        <p className="live-view__sub">{`From ${obs.name}`}</p>
        <p className="sr-only" aria-live="polite">{phaseText}</p>
        <p className="live-view__status">
          <strong>{status}</strong>{peak && <span>{` · ${peak}`}</span>}
        </p>
        {span && live && live.phase !== "after" && (() => {
          const start = startOf(pass, span.firstMs);
          return (
            <LivePassBar
              startMs={start.ms ?? span.firstMs}
              startLabel={start.label}
              startShownMs={start.ms}
              peakMs={span.peakMs}
              endMs={span.lastMs}
              nowMs={now}
              timeZone={obs.tz}
            />
          );
        })()}
        <LiveDial
          track={samples}
          now={live && live.azDeg != null && live.elDeg != null ? { azDeg: live.azDeg, elDeg: live.elDeg } : null}
          nowMs={now}
          headingDeg={compassOn ? heading : null}
          timeZone={obs.tz}
        />
        {turn && <p className="live-view__turn">{turn}</p>}
        {compassNote && <p className="note">{compassNote}</p>}
        {live && live.azDeg != null && live.elDeg != null && (
          <dl className="kv live-view__nums num">
            <Surface><dt>Azimuth</dt><dd>{`${Math.round(live.azDeg)}° ${point(live.azDeg)}`}</dd></Surface>
            <Surface><dt>Elevation</dt><dd>{`${Math.round(live.elDeg)}°`}</dd></Surface>
            <Surface><dt>Range</dt><dd>{`${Math.round(live.rangeKm!).toLocaleString()} km`}</dd></Surface>
          </dl>
        )}
        <Surface as="section" className="live-view__radio" aria-label="Tuning">
          {tune === "none" ? null : tune === "pick" ? (
            <p className="note">Pick a frequency in the radio chart to see where to tune.</p>
          ) : tune === "over" ? (
            <p className="note">{"The pass has set. Its radio chart still has the full Doppler curve."}</p>
          ) : tune === "tune" && live && live.dopplerHz != null && freqHz != null ? (
            <>
              <p className="live-view__tune">
                <span className="live-view__tune-label">{live.phase === "before" ? "At rise, listen" : "Listen"}</span>
                <span className="live-view__tune-mhz num">{`${((freqHz + live.dopplerHz) / 1e6).toFixed(4)} MHz`}</span>
                {downlinkMode && <span className="live-view__tune-mode">{downlinkMode.toUpperCase()}</span>}
              </p>
              <p className="live-view__doppler num">
                {`Doppler ${live.dopplerHz >= 0 ? "+" : ""}${(live.dopplerHz / 1000).toFixed(1)} kHz`}
                {live.phase === "during" && live.rateHzPerSec != null && (Math.abs(live.rateHzPerSec) < 1
                  ? ", steady"
                  : `, ${live.rateHzPerSec < 0 ? "falling" : "rising"} ${Math.abs(Math.round(live.rateHzPerSec))} Hz/s`)}
                {downlinkLabel && ` · ${downlinkLabel}`}
              </p>
              {uplink && (() => {
                // A passband is worked from its centre: listen at the downlink
                // centre, transmit at the uplink centre (inverting or not).
                const upHz = uplink.highHz ? (uplink.hz + uplink.highHz) / 2 : uplink.hz;
                const shift = upShift(live.dopplerHz, freqHz, upHz);
                if (shift == null) return null;
                return (
                  <>
                    <p className="live-view__tune">
                      <span className="live-view__tune-label">{live.phase === "before" ? "At rise, transmit" : "Transmit"}</span>
                      <span className="live-view__tune-mhz num">{`${((upHz + shift) / 1e6).toFixed(4)} MHz`}</span>
                      {uplink.mode && <span className="live-view__tune-mode">{uplink.mode.toUpperCase()}</span>}
                    </p>
                    <p className="live-view__doppler num">
                      {`Uplink ${shift >= 0 ? "+" : "−"}${Math.abs(shift / 1000).toFixed(1)} kHz`}
                      {uplink.tone != null ? ` · ${uplink.tone.toFixed(1)} Hz tone` : toneMissing(uplink) ? " · tone not listed" : ""}
                      {uplink.invert && " · inverting: tune down as you transmit up"}
                    </p>
                  </>
                );
              })()}
              <p className="note">{"Predicted. The satellite's own offset is unknown."}</p>
            </>
          ) : (
            <p className="note">{`${((freqHz ?? 0) / 1e6).toFixed(3)} MHz once it rises.`}</p>
          )}
        </Surface>
        <div className="live-view__actions">
          {hasCompass && !compassOn && (
            <Button size="sm" onClick={startCompass}>Use phone compass</Button>
          )}
          <Button size="sm" onClick={() => onChart("sky")}>Sky chart</Button>
          <Button size="sm" onClick={() => onChart("radio")}>Radio chart</Button>
        </div>
      </div>
    </Modal>
  );
}
