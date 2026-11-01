"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PolarPlotSvg from "@/components/passes/PolarPlotSvg";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { ChartSubject } from "@/components/passes/PassChartModals";
import { cardHeadline } from "@/lib/home/next-up.mjs";
import { elementTags, passMetaLabel } from "@/lib/home/view.mjs";
import { passToIcs, icsFileName } from "@/lib/passes/ics.mjs";
import { downloadText } from "@/lib/passes/download.js";
import { paintPassCard } from "@/lib/passes/card-chart.js";
import { shareUrl } from "@/lib/share/share-link.mjs";
import { trueNow } from "@/lib/pass-finder/clock-sync.js";
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

// The chart painters load on the first chart open, not with the page.
const PassChartModals = dynamic(() => import("@/components/passes/PassChartModals"), { ssr: false });

// A pass this close (or under way) repaints its plot every second so the
// satellite dot moves; others repaint every 30 s.
const LIVE_LEAD_MS = 10 * 60_000;
const IDLE_PAINT_MS = 30_000;

const toIcs = passToIcs as unknown as (o: Record<string, unknown>) => string;
const headline = cardHeadline as (card: Card, nowMs: number) => string;

function ElementTags({ track }: { track: Track | undefined }) {
  if (!track) return null;
  return (
    <>
      {(elementTags(track) as string[]).map((tag) => (
        <span key={tag} className="pass-card__tag pass-card__tag--elements">{tag}</span>
      ))}
    </>
  );
}

interface PassCardProps {
  card: Extract<Card, { kind: "pass" }>;
  track: Track;
  observer: HomeObserver;
  color: string;
  mode: "radio" | "visual";
  minElevDeg: number;
  nowMs: number;
  onSkyChart: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onRadioChart: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onUnfollow: () => void;
}

function PassCard({
  card, track, observer, color, mode, minElevDeg, nowMs, onSkyChart, onRadioChart, onUnfollow,
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
    const ics = toIcs({
      satName: track.name,
      noradId: track.noradId,
      observer: { name: observer.name, latDeg: observer.latDeg, lonDeg: observer.lonDeg },
      pass,
      mode,
      nowMs: trueNow(),
      url: track.record?.source === "pasted" ? null : (shareUrl(window.location.origin, {
        noradId: card.noradId,
        observers: [{ name: observer.name, latDeg: observer.latDeg, lonDeg: observer.lonDeg }],
        passMs: pass.peakMs,
        mode,
        freqHz: null,
        minElevDeg,
      }) as string),
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
          {passMetaLabel(pass, nowMs, { timeZone: observer.tz })}
          {pass.visible && <span className="pass-card__tag">visible</span>}
          <ElementTags track={track} />
        </p>
        <div className="pass-card__actions">
          <button type="button" className="home-chip" onClick={onSkyChart}>Sky chart</button>
          <button type="button" className="home-chip" onClick={onRadioChart}>Radio chart</button>
          <button type="button" className="home-chip" aria-label="Add to calendar" title="Add to calendar" onClick={addToCalendar}>
            📅
          </button>
          {track.record?.source !== "pasted" && (
            <Link className="home-chip" href={`/sat/${card.noradId}`} aria-label={`Details for ${card.name}`}>Details</Link>
          )}
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
  const [subject, setSubject] = useState<ChartSubject | null>(null);
  const [chart, setChart] = useState<"sky" | "radio" | null>(null);
  const [chartsLoaded, setChartsLoaded] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);

  const open = (kind: "sky" | "radio", track: Track, pass: Pass, e: React.MouseEvent<HTMLButtonElement>) => {
    trigger.current = e.currentTarget;
    setChartsLoaded(true);
    setSubject({ track, obs: observer, pass, minElevDeg, jointWindow: null });
    setChart(kind);
  };
  const onClose = useCallback(() => {
    setChart(null);
    trigger.current?.focus();
  }, []);

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
                minElevDeg={minElevDeg}
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
              <p className="pass-card__headline">
                {headline(card, nowMs)}
                <ElementTags track={track} />
              </p>
              {card.kind !== "missing" && track?.record?.source !== "pasted" && (
                <Link className="home-chip" href={`/sat/${card.noradId}`} aria-label={`Details for ${card.name}`}>Details</Link>
              )}
              <button type="button" className="home-chip home-chip--quiet" onClick={() => onUnfollow(card.noradId)}>
                Unfollow
              </button>
            </li>
          );
        })}
      </ul>

      {chartsLoaded && (
        <PassChartModals subject={subject} chart={chart} onChartChange={setChart} onClose={onClose} />
      )}
    </section>
  );
}
