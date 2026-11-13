"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ChartSubject } from "@/components/passes/PassChartModals";
import { elementTags } from "@/lib/home/view.mjs";
import { bestPass } from "@/lib/passes/pass-words.mjs";
import { passQuality } from "@/lib/passes/quality.mjs";
import { passToIcs, icsFileName } from "@/lib/passes/ics.mjs";
import { downloadText } from "@/lib/passes/download.js";
import { paintPassCard } from "@/lib/passes/card-chart.js";
import { shareUrl } from "@/lib/share/share-link.mjs";
import { trueNow } from "@/lib/pass-finder/clock-sync.js";
import { visualRating, type Quality } from "@/components/passes/QualityBadge";
import { passCloud } from "@/components/passes/CloudBadge";
import type { Forecast } from "@/lib/sky/use-clouds";
import { liveAvailable } from "@/lib/live/live-state.mjs";
import Button from "@/components/ui/Button";
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
  /** A 24-hour window standing in for a pass, for a satellite that never sets. */
  day?: boolean;
  startMs: number;
  endMs: number;
  peakMs: number;
  durationMs: number;
  maxElevDeg: number;
  startAzDeg: number | null;
  peakAzDeg?: number | null;
  endAzDeg: number | null;
  /** Elevation at the window's start and end (above 0 when the pass starts
   *  or ends in Earth's shadow, or at the minimum elevation). */
  startElevDeg?: number | null;
  endElevDeg?: number | null;
  visible: boolean;
  inProgress: boolean;
  /** In progress since before the search began: startMs is the search start, not the rise. */
  riseUnknown?: boolean;
  runsPastEnd?: boolean;
  /** Radio mode only: time above 10° and 30°. */
  msAbove10?: number;
  msAbove30?: number;
  /** Visual mode only: the brightest dark-sky magnitude (null when unknown)
   *  and the Sun altitudes the visual rating reads. */
  peakMag?: number | null;
  peakMagSunAltDeg?: number | null;
  peakSunAltDeg?: number | null;
}

export type Card =
  | { kind: "pass"; noradId: number; name: string; pass: Pass; passes?: Pass[]; upcoming?: Pass[] }
  | { kind: "stationary"; noradId: number; name: string; visible: boolean; pointing: { azDeg: number; elDeg: number } }
  | { kind: "none" | "unavailable" | "missing"; noradId: number; name: string };

// The chart painters load on the first chart open, not with the page.
const PassChartModals = dynamic(() => import("@/components/passes/PassChartModals"), { ssr: false });

// A pass this close (or under way) repaints its plot every second so the
// satellite dot moves; others repaint every 30 s.
const LIVE_LEAD_MS = 10 * 60_000;
const IDLE_PAINT_MS = 30_000;

const toIcs = passToIcs as unknown as (o: Record<string, unknown>) => string;
/** Whether the live view can open for this pass now. */
export const liveOk = liveAvailable as (pass: { startMs: number; endMs: number }, nowMs: number) => boolean;
const elevRating = passQuality as (pass: Pass) => Quality;
export type Best = { noradId: number; name: string; pass: Pass; rating: Quality };
const bestOf = bestPass as unknown as (cards: Card[], o: { rate: (card: Card, pass: Pass) => Quality; nowMs: number; hours: number }) => Best | null;

/** A satellite pasted as elements on this device: it has no page and no share link. */
export const isPasted = (track: Track) => track.record?.source === "pasted";

/** What a rating reads for the mode: the visual rating (brightness, sky,
 *  cloud) when watching, the elevation rating for radio. */
export interface RateOptions {
  mode: "radio" | "visual";
  skyType: string;
  clouds: Forecast | null;
  nowMs: number;
}

/** A pass's rating, as its card or row shows it. */
export function passRating(pass: Pass, { mode, skyType, clouds, nowMs }: RateOptions): Quality {
  return mode === "visual"
    ? visualRating(pass, { skyType, cloud: passCloud(clouds, pass, nowMs) })
    : elevRating(pass);
}

/** The best pass among the followed ones in the next 24 hours, rated as
 *  their cards are; null when it is the soonest or rates below Good. */
export function bestPassOf(cards: Card[], o: RateOptions): Best | null {
  return bestOf(cards, { rate: (_card, pass) => passRating(pass, o), nowMs: o.nowMs, hours: 24 });
}

/** The share link for a pass from one place, or null for a pasted satellite.
 *  Reads window.location.origin, so call it from an event handler. */
export function passShareUrl({ track, observer, pass, mode, minElevDeg }: {
  track: Track; observer: HomeObserver; pass: Pass; mode: "radio" | "visual"; minElevDeg: number;
}): string | null {
  if (isPasted(track)) return null;
  return shareUrl(window.location.origin, {
    noradId: track.noradId,
    observers: [{ name: observer.name, latDeg: observer.latDeg, lonDeg: observer.lonDeg }],
    passMs: pass.peakMs,
    mode,
    freqHz: null,
    minElevDeg,
  }) as string;
}

/** Downloads the pass as an .ics calendar event, with its share link. */
export function downloadPassIcs(o: {
  track: Track; observer: HomeObserver; pass: Pass; mode: "radio" | "visual"; minElevDeg: number;
}) {
  const { track, observer, pass, mode } = o;
  const ics = toIcs({
    satName: track.name,
    noradId: track.noradId,
    observer: { name: observer.name, latDeg: observer.latDeg, lonDeg: observer.lonDeg },
    pass,
    mode,
    nowMs: trueNow(),
    url: passShareUrl(o),
    observerCount: 1,
    inProgress: pass.inProgress,
  });
  downloadText(ics, icsFileName(track.shortName, observer.name, pass.startMs), "text/calendar");
}

/** The page a pass reminder opens. A pasted satellite has no page: its
 *  reminder opens it on home, where this device keeps its elements. */
export const reminderUrl = (track: Track) => () => (isPasted(track) ? `/?focus=${track.noradId}` : `/sat/${track.noradId}`);

/** The small polar plot's ref, painted with the pass: every second while
 *  the pass is near or under way (the dot moves), else every 30 s. */
export function usePassPlot(track: Track, observer: HomeObserver, pass: Pass, nowMs: number) {
  const svgRef = useRef<SVGSVGElement>(null);
  const live = nowMs >= pass.startMs - LIVE_LEAD_MS && nowMs <= pass.endMs;
  const paintKey = live ? nowMs : Math.floor(nowMs / IDLE_PAINT_MS);
  // Paints with the clock of the render that changed paintKey.
  useEffect(() => {
    if (svgRef.current) paintPassCard(svgRef.current, { track, obs: observer, win: pass, nowMs });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, observer, pass, paintKey]);
  return svgRef;
}

/** Where the elements came from, as quiet tags. */
export function ElementTags({ track, nowMs }: { track: Track | undefined; nowMs: number }) {
  if (!track) return null;
  return (
    <>
      {(elementTags(track, nowMs) as string[]).map((tag) => (
        <span key={tag} className="pass-card__tag pass-card__tag--elements">{tag}</span>
      ))}
    </>
  );
}

export interface ViewingProps {
  onFollow: () => void;
  /** The follow cap message, when following is blocked. */
  blocked: string | null;
}

/** The small "viewing" tag on the viewed satellite's card. */
export function ViewingTag({ viewing }: { viewing: ViewingProps | null }) {
  return viewing ? <span className="pass-card__tag pass-card__tag--viewing">viewing</span> : null;
}

/** Unfollow, or for the viewed satellite, Follow. */
export function FollowChip({ viewing, onUnfollow }: { viewing: ViewingProps | null; onUnfollow: () => void }) {
  if (viewing) {
    return (
      <Button
        size="sm"
        disabled={Boolean(viewing.blocked)}
        title={viewing.blocked ?? undefined}
        onClick={viewing.onFollow}
      >
        {"\u2606 Follow"}
      </Button>
    );
  }
  return <Button size="sm" variant="quiet" onClick={onUnfollow}>Unfollow</Button>;
}

export type ChartKind = "sky" | "radio" | "live";
export type OpenChart = (kind: ChartKind, track: Track, pass: Pass, e: React.MouseEvent<HTMLButtonElement>) => void;

/** The sky, radio and live chart modals, shared by the pass list and the
 *  timeline: `open` records its trigger so closing returns focus to it. */
export function usePassCharts(observer: HomeObserver | null, minElevDeg: number) {
  // The subject is captured when a chart opens, so a card refresh or the
  // clock never repaints an open chart.
  const [subject, setSubject] = useState<ChartSubject | null>(null);
  const [chart, setChart] = useState<ChartKind | null>(null);
  const [chartsLoaded, setChartsLoaded] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);

  const open = useCallback<OpenChart>((kind, track, pass, e) => {
    if (!observer) return;
    trigger.current = e.currentTarget;
    setChartsLoaded(true);
    setSubject({ track, obs: observer, pass, minElevDeg, jointWindow: null });
    setChart(kind);
  }, [observer, minElevDeg]);
  const onClose = useCallback(() => {
    setChart(null);
    trigger.current?.focus();
  }, []);

  const modals = chartsLoaded
    ? <PassChartModals subject={subject} chart={chart} onChartChange={setChart} onClose={onClose} />
    : null;
  return { open, modals };
}
