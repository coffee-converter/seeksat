"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PolarPlotSvg from "@/components/passes/PolarPlotSvg";
import dynamic from "next/dynamic";
import Link from "next/link";
import { markFromList } from "@/lib/home/list-origin.mjs";
import type { ChartSubject } from "@/components/passes/PassChartModals";
import { cardHeadline } from "@/lib/home/next-up.mjs";
import { elementTags } from "@/lib/home/view.mjs";
import PassStats, { FlashText, passTime as cardTime } from "@/components/passes/PassStats";
import { bestPass } from "@/lib/passes/pass-words.mjs";
import { PassPath, RadioPanel, aboveTenText } from "@/components/passes/PassPath";
import { passQuality } from "@/lib/passes/quality.mjs";
import { passToIcs, icsFileName } from "@/lib/passes/ics.mjs";
import { downloadText } from "@/lib/passes/download.js";
import { paintPassCard } from "@/lib/passes/card-chart.js";
import { shareUrl } from "@/lib/share/share-link.mjs";
import { trueNow } from "@/lib/pass-finder/clock-sync.js";
import QualityBadge, { peakMagText, visualRating, type Quality } from "@/components/passes/QualityBadge";
import CloudBadge, { passCloud } from "@/components/passes/CloudBadge";
import { sharedCloudNote, type CloudBadge as CloudLevel } from "@/lib/sky/cloud-badge.mjs";
import type { Forecast } from "@/lib/sky/use-clouds";
import { liveAvailable } from "@/lib/live/live-state.mjs";
import AlertBell from "@/components/AlertBell";
import Disclosure from "@/components/ui/Disclosure";
import Button from "@/components/ui/Button";
import { useHomeStore } from "@/lib/home/store";
import { buttonClass, cx, surfaceClass } from "@/lib/ui/classes.mjs";
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
  peakAzDeg?: number | null;
  endAzDeg: number | null;
  /** Elevation at the window's start and end (above 0 when the pass starts
   *  or ends in Earth's shadow, or at the minimum elevation). */
  startElevDeg?: number | null;
  endElevDeg?: number | null;
  visible: boolean;
  inProgress: boolean;
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
  | { kind: "pass"; noradId: number; name: string; pass: Pass; passes?: Pass[] }
  | { kind: "stationary"; noradId: number; name: string; visible: boolean; pointing: { azDeg: number; elDeg: number } }
  | { kind: "none" | "unavailable" | "missing"; noradId: number; name: string };

// The chart painters load on the first chart open, not with the page.
const PassChartModals = dynamic(() => import("@/components/passes/PassChartModals"), { ssr: false });

// A pass this close (or under way) repaints its plot every second so the
// satellite dot moves; others repaint every 30 s.
const LIVE_LEAD_MS = 10 * 60_000;
const IDLE_PAINT_MS = 30_000;

const toIcs = passToIcs as unknown as (o: Record<string, unknown>) => string;
const liveOk = liveAvailable as (pass: { startMs: number; endMs: number }, nowMs: number) => boolean;
const headline = cardHeadline as (card: Card, nowMs: number) => string;
const elevRating = passQuality as (pass: Pass) => Quality;
type Best = { noradId: number; name: string; pass: Pass; rating: Quality };
const bestOf = bestPass as unknown as (cards: Card[], o: { rate: (card: Card, pass: Pass) => Quality; nowMs: number; hours: number }) => Best | null;

function ElementTags({ track, nowMs }: { track: Track | undefined; nowMs: number }) {
  if (!track) return null;
  return (
    <>
      {(elementTags(track, nowMs) as string[]).map((tag) => (
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
  onLive: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onUnfollow: () => void;
  focus: FocusState;
  onFocus: () => void;
  /** Set for the viewed (not followed) satellite's card: Follow replaces Unfollow. */
  viewing: ViewingProps | null;
  /** Whether the card's More panel is open. */
  moreOpen: boolean;
  onToggleMore: () => void;
  /** The cloud forecast, shown as a badge in visual mode. */
  clouds: Forecast | null;
  /** False when one note above the list already gives every pass's cloud. */
  cloudShown: boolean;
  /** The sky type the visual rating uses. */
  skyType: string;
}

interface ViewingProps {
  onFollow: () => void;
  /** The follow cap message, when following is blocked. */
  blocked: string | null;
}

/** The small "viewing" tag on the viewed satellite's card. */
function ViewingTag({ viewing }: { viewing: ViewingProps | null }) {
  return viewing ? <span className="pass-card__tag pass-card__tag--viewing">viewing</span> : null;
}

/** Unfollow, or for the viewed satellite, Follow. */
function FollowChip({ viewing, onUnfollow }: { viewing: ViewingProps | null; onUnfollow: () => void }) {
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

/** none: nothing is focused; focus: this card's satellite is; dim: another is. */
type FocusState = "none" | "focus" | "dim";
/** A pass card is a Surface with the satellite's colour on its leading edge,
 *  selected while its satellite is focused. */
const cardClass = (kind: "pass" | "short", f: FocusState) =>
  cx("pass-card", `pass-card--${kind}`, f === "dim" && "pass-card--dim", surfaceClass({ accent: true, selected: f === "focus" }));

/** The headline, as a button that focuses the satellite on the map. */
function Headline({ text, focus, onFocus }: { text: string; focus: FocusState; onFocus: () => void }) {
  return (
    <button type="button" className="pass-card__focus" aria-pressed={focus === "focus"} onClick={onFocus}>
      <FlashText value={text} />
    </button>
  );
}

function PassCard({
  card, track, observer, color, mode, minElevDeg, nowMs, onSkyChart, onRadioChart, onLive, onUnfollow, focus, onFocus, viewing,
  moreOpen, onToggleMore, clouds, cloudShown, skyType,
}: PassCardProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { pass } = card;
  const live = nowMs >= pass.startMs - LIVE_LEAD_MS && nowMs <= pass.endMs;
  const paintKey = live ? nowMs : Math.floor(nowMs / IDLE_PAINT_MS);
  const visual = mode === "visual";
  const rating = visual ? visualRating(pass, { skyType, cloud: passCloud(clouds, pass, nowMs) }) : undefined;
  const mag = visual ? peakMagText(pass) : null;
  // Under Lasts: the peak magnitude when watching, time above 10° for radio.
  const lastSub = visual ? mag : aboveTenText(pass);
  const banded = useHomeStore((st) => st.prefs.bands) != null;
  const hasMeta = (!visual && pass.visible) || viewing != null ||
    (elementTags(track, nowMs) as string[]).length > 0;

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

  const skyButton = <Button size="sm" onClick={onSkyChart}>Sky chart</Button>;
  const radioButton = <Button size="sm" onClick={onRadioChart}>Radio chart</Button>;

  return (
    <li className={cardClass("pass", focus)} style={{ "--sat-color": color } as React.CSSProperties}>
      <div className="pass-card__top">
        <p className="pass-card__headline">
          <Headline text={card.name} focus={focus} onFocus={onFocus} />
        </p>
        <span className="rating-pair pass-card__rating">
          <QualityBadge pass={pass} rating={rating} maxShown pill />
          {visual && cloudShown && <CloudBadge forecast={clouds} pass={pass} nowMs={nowMs} />}
        </span>
      </div>
      <div className="pass-card__plot">
        <PolarPlotSvg ref={svgRef} />
      </div>
      {/* The path strip below says where it peaks, so Max keeps only the height. */}
      <PassStats pass={pass} nowMs={nowMs} timeZone={observer.tz} mag={lastSub} maxSub={null} />
      <PassPath pass={pass} mode={mode} minElevDeg={minElevDeg} timeZone={observer.tz} className="pass-card__path" />
      <div className="pass-card__body">
        {!visual && <RadioPanel track={track} observer={observer} pass={pass} nowMs={nowMs} banded={banded} />}
        {hasMeta && (
          <p className="pass-card__meta">
            {/* Every pass listed in visual mode is visible, so only radio says so. */}
            {!visual && pass.visible && <span className="pass-card__tag">visible</span>}
            <ElementTags track={track} nowMs={nowMs} />
            <ViewingTag viewing={viewing} />
          </p>
        )}
        <div className="pass-card__actions">
          {liveOk(pass, nowMs) && <Button size="sm" variant="primary" onClick={onLive}><span className="live-dot" aria-hidden="true" />Live</Button>}
          {/* The chart for the mode leads; the other waits under More. */}
          {visual ? skyButton : radioButton}
          {track.record?.source !== "pasted" && (
            <Link className={buttonClass({ size: "sm" })} href={`/sat/${card.noradId}`} onClick={markFromList} aria-label={`Details for ${card.name}`}>Details</Link>
          )}
          <Disclosure id={`card-more-${card.noradId}`} open={moreOpen} onToggle={onToggleMore} label={`the ${card.name} pass`}>
            {visual ? radioButton : skyButton}
            <Button size="sm" title="Add to calendar" onClick={addToCalendar}>
              <span aria-hidden="true">📅</span> Calendar
            </Button>
            <AlertBell
              noradId={card.noradId}
              name={track.shortName}
              pass={pass}
              // A pasted satellite has no page: its reminder opens it on home,
              // where this device keeps its elements.
              url={() => (track.record?.source === "pasted" ? `/?focus=${card.noradId}` : `/sat/${card.noradId}`)}
            />
            <FollowChip viewing={viewing} onUnfollow={onUnfollow} />
          </Disclosure>
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
  /** The card of the satellite being viewed (focused, not followed), if any. */
  viewingCard?: Card | null;
  onFollow: (noradId: number) => void;
  /** The follow cap message for the viewed satellite, when blocked. */
  followBlocked: string | null;
  /** The focused satellite: its card is pinned first and the others dim. */
  focusId: number | null;
  /** A headline tap: focus that satellite, or null to unfocus the focused one. */
  onFocus: (noradId: number | null) => void;
  /** Opens a chart for a pass (from `usePassCharts`). */
  openChart: OpenChart;
  /** The cloud forecast for visual passes (from `useClouds`), or null. */
  clouds?: Forecast | null;
  /** The sky type for the visual rating (prefs `skyType`). */
  skyType: string;
}

export type ChartKind = "sky" | "radio" | "live";
export type OpenChart = (kind: ChartKind, track: Track, pass: Pass, e: React.MouseEvent<HTMLButtonElement>) => void;

/** The sky, radio and live chart modals, shared by the cards and the
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

// "Next up": one card per followed satellite; a pass card's chart buttons
// open the shared chart modals.
export default function NextUpList({
  cards: followedCards, viewingCard = null, tracks, colors, observer, mode, minElevDeg, nowMs,
  onUnfollow, onFollow, followBlocked, focusId, onFocus, openChart: open, clouds = null, skyType,
}: Props) {
  const cardsIn = viewingCard
    ? [viewingCard, ...followedCards.filter((c) => c.noradId !== viewingCard.noradId)]
    : followedCards;
  const pinned = cardsIn.find((c) => c.noradId === focusId);
  const cards = pinned ? [pinned, ...cardsIn.filter((c) => c !== pinned)] : cardsIn;
  const focusOf = (id: number): FocusState => (focusId == null ? "none" : id === focusId ? "focus" : "dim");
  const toggle = (id: number) => onFocus(id === focusId ? null : id);
  const viewingOf = (id: number): ViewingProps | null => (viewingCard && viewingCard.noradId === id
    ? { onFollow: () => onFollow(id), blocked: followBlocked }
    : null);
  // Cards whose More panel is open; all start closed.
  const [openMore, setOpenMore] = useState<ReadonlySet<number>>(() => new Set());
  const toggleMore = (id: number) => setOpenMore((prev) => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  // The day's best pass among the followed ones, rated as their cards are.
  const rate = (_card: Card, pass: Pass): Quality => (mode === "visual"
    ? visualRating(pass, { skyType, cloud: passCloud(clouds, pass, nowMs) })
    : elevRating(pass));
  const best = bestOf(followedCards, { rate, nowMs, hours: 24 });
  // When every card has the same cloud, say it once above them.
  const cloudNote = mode === "visual"
    ? (sharedCloudNote as (b: (CloudLevel | null)[]) => string | null)(cards
      .filter((c): c is Extract<Card, { kind: "pass" }> => c.kind === "pass" && tracks.has(c.noradId))
      .map((c) => passCloud(clouds, c.pass, nowMs)))
    : null;
  const bestTrack = best ? tracks.get(best.noradId) : undefined;

  return (
    <>
    {best && bestTrack && (
      <BestPassLine best={best} visual={mode === "visual"} clouds={clouds} track={bestTrack} observer={observer} nowMs={nowMs} onOpen={(e) => open(mode === "visual" ? "sky" : "radio", bestTrack, best.pass, e)} />
    )}
    <section className="next-up" aria-labelledby="next-up-title">
      <h2 id="next-up-title" className="home-heading">Next up</h2>
      {cloudNote && <p className="next-up__note">{cloudNote}</p>}
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
                onLive={(e) => open("live", track, card.pass, e)}
                onUnfollow={() => onUnfollow(card.noradId)}
                focus={focusOf(card.noradId)}
                onFocus={() => toggle(card.noradId)}
                viewing={viewingOf(card.noradId)}
                moreOpen={openMore.has(card.noradId)}
                onToggleMore={() => toggleMore(card.noradId)}
                clouds={clouds}
                cloudShown={!cloudNote}
                skyType={skyType}
              />
            );
          }
          return (
            <li
              key={card.noradId}
              className={cardClass("short", focusOf(card.noradId))}
              style={{ "--sat-color": color } as React.CSSProperties}
            >
              <p className="pass-card__headline">
                <Headline text={headline(card, nowMs)} focus={focusOf(card.noradId)} onFocus={() => toggle(card.noradId)} />
                <ElementTags track={track} nowMs={nowMs} />
                <ViewingTag viewing={viewingOf(card.noradId)} />
              </p>
              {card.kind !== "missing" && track?.record?.source !== "pasted" && (
                <Link className={buttonClass({ size: "sm" })} href={`/sat/${card.noradId}`} onClick={markFromList} aria-label={`Details for ${card.name}`}>Details</Link>
              )}
              <FollowChip viewing={viewingOf(card.noradId)} onUnfollow={() => onUnfollow(card.noradId)} />
            </li>
          );
        })}
      </ul>
    </section>
    </>
  );
}

/** "09:41 PM", or "Tue 09:41 PM" on another day than today, in the cards' clock. */
function dayTime(ms: number, nowMs: number, timeZone?: string): string {
  const time = cardTime(ms, timeZone);
  const dayKey = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone });
  if (dayKey.format(ms) === dayKey.format(nowMs)) return time;
  return `${new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone }).format(ms)} ${time}`;
}

/** "Best in the next 24 hours: ISS 09:41 PM, Good, max 64°": a button that
 *  opens that pass's chart for the mode (sky in visual, radio in radio). Shown only when it is not the soonest pass. */
function BestPassLine({ best, visual, clouds, track, observer, nowMs, onOpen }: {
  best: Best;
  visual: boolean;
  /** Visual mode: the cloud word sits beside the rating, as on the cards. */
  clouds: Forecast | null;
  track: Track;
  observer: HomeObserver;
  nowMs: number;
  onOpen: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const { pass, rating } = best;
  return (
    <button type="button" className={`best-pass ${surfaceClass({ padded: "sm", interactive: true })}`} title={visual ? "Open the sky chart for this pass" : "Open the radio chart for this pass"} onClick={onOpen}>
      <span className="best-pass__label">Best in the next 24 hours:</span>{" "}
      <span className="best-pass__what">
        {`${track.shortName ?? best.name} ${dayTime(pass.startMs, nowMs, observer.tz)}, `}
        <span className="rating-pair">
          <QualityBadge pass={pass} rating={visual ? rating : undefined} />
          {visual && <>{" "}<CloudBadge forecast={clouds} pass={pass} nowMs={nowMs} /></>}
        </span>
        {`, max ${Math.round(pass.maxElevDeg)}°`}
      </span>
    </button>
  );
}
