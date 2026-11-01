"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PolarPlotSvg from "@/components/passes/PolarPlotSvg";
import SkyChartModalView from "@/components/passes/SkyChartModalView";
import RadioChartModalView from "@/components/passes/RadioChartModalView";
import { cardHeadline } from "@/lib/home/next-up.mjs";
import { passTimesLabel } from "@/lib/home/view.mjs";
import { formatPassDuration } from "@/lib/passes/format.mjs";
import { passToIcs, icsFileName } from "@/lib/passes/ics.mjs";
import {
  paintPassCard, paintSkyChart, passFileName, radioChartOptions, radioCsvText, radioSeries,
} from "@/lib/passes/charts.js";
import { paintRadioChart } from "@/lib/pass-finder/radio-chart.js";
import { svgToPngBlob } from "@/lib/pass-finder/polar-png.js";
import { getClockSkewMs, trueNow } from "@/lib/pass-finder/clock-sync.js";
import { defaultDownlink } from "@/lib/catalog.mjs";
import type { makeTrack } from "@/lib/sat/track.mjs";

export type Track = ReturnType<typeof makeTrack>;

export interface HomeObserver {
  id: string;
  name: string;
  latDeg: number;
  lonDeg: number;
  tz?: string;
  elevM: number;
  elevSource: string;
}

export interface Pass {
  startMs: number;
  endMs: number;
  peakMs: number;
  durationMs: number;
  maxElevDeg: number;
  startAzDeg: number | null;
  endAzDeg: number | null;
  visible: boolean;
  inProgress: boolean;
}

export type Card =
  | { kind: "pass"; noradId: number; name: string; pass: Pass }
  | { kind: "stationary"; noradId: number; name: string; visible: boolean; pointing: { azDeg: number; elDeg: number } }
  | { kind: "none" | "unavailable" | "missing"; noradId: number; name: string };

interface Subject {
  track: Track;
  obs: HomeObserver;
  pass: Pass;
  minElevDeg: number;
}

// A pass this close (or under way) repaints its plot every second so the
// satellite dot moves; others repaint every 30 s.
const LIVE_LEAD_MS = 10 * 60_000;
const IDLE_PAINT_MS = 30_000;

const headline = cardHeadline as (card: Card, nowMs: number) => string;

function downloadText(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after this tick; a synchronous revoke can drop the download in Safari.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

interface PassCardProps {
  card: Extract<Card, { kind: "pass" }>;
  track: Track;
  observer: HomeObserver;
  color: string;
  mode: "radio" | "visual";
  nowMs: number;
  onSkyChart: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onRadioChart: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onUnfollow: () => void;
}

function PassCard({
  card, track, observer, color, mode, nowMs, onSkyChart, onRadioChart, onUnfollow,
}: PassCardProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { pass } = card;
  const live = nowMs >= pass.startMs - LIVE_LEAD_MS && nowMs <= pass.endMs;
  const paintKey = live ? nowMs : Math.floor(nowMs / IDLE_PAINT_MS);

  // Paints with the clock of the render that changed paintKey.
  useEffect(() => {
    if (svgRef.current) paintPassCard(svgRef.current, { track, obs: observer, win: pass, nowMs });
  }, [track, observer, pass, paintKey]);

  const addToCalendar = () => {
    const ics = passToIcs({
      satName: track.name,
      noradId: track.noradId,
      observer: { name: observer.name, latDeg: observer.latDeg, lonDeg: observer.lonDeg },
      pass,
      mode,
      nowMs: Date.now(),
      url: null,
      observerCount: 1,
      inProgress: pass.inProgress,
    });
    downloadText(ics, icsFileName(track.shortName, observer.name, pass.startMs), "text/calendar");
  };

  return (
    <li className="pass-card" style={{ "--sat-color": color } as React.CSSProperties}>
      <div className="pass-card__plot" aria-hidden="true">
        <PolarPlotSvg ref={svgRef} />
      </div>
      <div className="pass-card__body">
        <p className="pass-card__headline">{headline(card, nowMs)}</p>
        <p className="pass-card__meta">
          {passTimesLabel(pass.startMs, pass.endMs, nowMs, { timeZone: observer.tz })}
          {" · "}
          {formatPassDuration(pass.durationMs / 1000)}
          {pass.visible && <span className="pass-card__tag">visible</span>}
        </p>
        <div className="pass-card__actions">
          <button type="button" className="home-chip" onClick={onSkyChart}>Sky chart</button>
          <button type="button" className="home-chip" onClick={onRadioChart}>Radio chart</button>
          <button type="button" className="home-chip" aria-label="Add to calendar" title="Add to calendar" onClick={addToCalendar}>
            📅
          </button>
          <button type="button" className="home-chip home-chip--quiet" onClick={onUnfollow}>Unfollow</button>
        </div>
      </div>
    </li>
  );
}

interface Props {
  cards: Card[];
  tracks: ReadonlyMap<number, Track>;
  colors: ReadonlyMap<number, string>;
  observer: HomeObserver;
  mode: "radio" | "visual";
  minElevDeg: number;
  nowMs: number;
  onUnfollow: (noradId: number) => void;
}

// "Next up": one card per followed satellite, with the sky and radio chart
// modals for a pass card.
export default function NextUpList({
  cards, tracks, colors, observer, mode, minElevDeg, nowMs, onUnfollow,
}: Props) {
  // The subject is captured when a chart opens, so a card refresh or the
  // clock never repaints an open chart.
  const [subject, setSubject] = useState<Subject | null>(null);
  const [chart, setChart] = useState<"sky" | "radio" | null>(null);
  const [freqHz, setFreqHz] = useState<number | null>(null);
  const trigger = useRef<HTMLElement | null>(null);

  const open = (kind: "sky" | "radio", track: Track, pass: Pass, e: React.MouseEvent<HTMLButtonElement>) => {
    trigger.current = e.currentTarget;
    // A chosen frequency sticks while the same satellite is reopened.
    if (subject?.track.noradId !== track.noradId) setFreqHz(defaultDownlink(track)?.hz ?? null);
    setSubject({ track, obs: observer, pass, minElevDeg });
    setChart(kind);
  };
  const onClose = useCallback(() => {
    setChart(null);
    trigger.current?.focus();
  }, []);

  const renderSky = useCallback(async (svg: SVGSVGElement) => {
    if (!subject) return null;
    const { track, obs, pass } = subject;
    // tzRefMs undefined: the chart labels the UTC offset at the pass peak.
    paintSkyChart(svg, { track, obs, win: pass, tzRefMs: undefined });
    const blob = await svgToPngBlob(svg);
    return {
      blobUrl: URL.createObjectURL(blob as Blob),
      filename: passFileName(track, obs, pass.peakMs, "sky"),
    };
  }, [subject]);

  const buildRadio = useCallback((purpose: "chart" | "csv") => {
    if (!subject) return null;
    const { track, obs, pass, minElevDeg: minElev } = subject;
    const built = radioSeries({
      track, obs, anchorMs: pass.peakMs, minElevDeg: minElev, freqHz, jointWindow: null, purpose,
    });
    return built ? { built, track, obs } : null;
  }, [subject, freqHz]);

  const renderRadio = useCallback(async (svg: SVGSVGElement) => {
    const r = buildRadio("chart");
    if (!r) return null;
    const { built, track, obs } = r;
    paintRadioChart(svg, built.series, radioChartOptions(built, { track, obs }));
    const blob = await svgToPngBlob(svg);
    return {
      blobUrl: URL.createObjectURL(blob as Blob),
      // tcaMs is interpolated, so fractional; round before it names a file.
      filename: passFileName(track, obs, Math.round(built.series.summary.tcaMs), "radio"),
    };
  }, [buildRadio]);

  const radioCsv = () => {
    const r = buildRadio("csv");
    if (!r) return null;
    const { built, track, obs } = r;
    return {
      csv: radioCsvText(built, { track, obs, generatedAtMs: trueNow(), clockSkewMs: getClockSkewMs() }),
      filename: passFileName(track, obs, Math.round(built.series.summary.tcaMs), "radio", "csv"),
    };
  };

  const subjectKey = subject ? `${subject.track.noradId}:${subject.pass.startMs}` : "";
  const subjectName = subject?.track.shortName ?? "";

  return (
    <section className="next-up" aria-labelledby="next-up-title">
      <h2 id="next-up-title" className="home-heading">Next up</h2>
      <ul className="next-up__list">
        {cards.map((card) => {
          const track = tracks.get(card.noradId);
          const color = colors.get(card.noradId) ?? "var(--map-muted)";
          if (card.kind === "pass" && track) {
            return (
              <PassCard
                key={card.noradId}
                card={card}
                track={track}
                observer={observer}
                color={color}
                mode={mode}
                nowMs={nowMs}
                onSkyChart={(e) => open("sky", track, card.pass, e)}
                onRadioChart={(e) => open("radio", track, card.pass, e)}
                onUnfollow={() => onUnfollow(card.noradId)}
              />
            );
          }
          return (
            <li
              key={card.noradId}
              className="pass-card pass-card--short"
              style={{ "--sat-color": color } as React.CSSProperties}
            >
              <p className="pass-card__headline">{headline(card, nowMs)}</p>
              <button type="button" className="home-chip home-chip--quiet" onClick={() => onUnfollow(card.noradId)}>
                Unfollow
              </button>
            </li>
          );
        })}
      </ul>

      <SkyChartModalView
        open={chart === "sky" && !!subject}
        title={`Sky chart: ${subjectName} pass`}
        subjectKey={subjectKey}
        render={renderSky}
        onClose={onClose}
        onRadioChart={() => setChart("radio")}
      />
      <RadioChartModalView
        open={chart === "radio" && !!subject}
        title={`Radio chart: ${subjectName} pass`}
        subjectKey={subjectKey}
        render={renderRadio}
        csv={radioCsv}
        freqHz={freqHz}
        downlinks={subject?.track.downlinks ?? []}
        onFreqChange={setFreqHz}
        onClose={onClose}
        onSkyChart={() => setChart("sky")}
      />
    </section>
  );
}
