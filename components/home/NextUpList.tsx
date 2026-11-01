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
import AlertBell from "@/components/AlertBell";
import { useFlash } from "@/lib/ui/use-flash";
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

/** Text that flashes when it changes, such as a countdown ticking down. */
function FlashText({ value }: { value: string }) {
  const flash = useFlash(value);
  return <span className={flash ? `flash-text ${flash}` : "flash-text"}>{value}</span>;
}

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
  focus: FocusState;
  onFocus: () => void;
  /** Set for the viewed (not followed) satellite's card: Follow replaces Unfollow. */
  viewing: ViewingProps | null;
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
      <button
        type="button"
        className="home-chip"
        disabled={Boolean(viewing.blocked)}
        title={viewing.blocked ?? undefined}
        onClick={viewing.onFollow}
      >
        {"\u2606 Follow"}
      </button>
    );
  }
  return <button type="button" className="home-chip home-chip--quiet" onClick={onUnfollow}>Unfollow</button>;
}

/** none: nothing is focused; focus: this card's satellite is; dim: another is. */
type FocusState = "none" | "focus" | "dim";
const focusClass = (f: FocusState) => (f === "none" ? "" : ` pass-card--${f}`);

/** The headline, as a button that focuses the satellite on the map. */
function Headline({ text, focus, onFocus }: { text: string; focus: FocusState; onFocus: () => void }) {
  return (
    <button type="button" className="pass-card__focus" aria-pressed={focus === "focus"} onClick={onFocus}>
      <FlashText value={text} />
    </button>
  );
}

function PassCard({
  card, track, observer, color, mode, minElevDeg, nowMs, onSkyChart, onRadioChart, onUnfollow, focus, onFocus, viewing,
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
    <li className={`pass-card${focusClass(focus)}`} style={{ "--sat-color": color } as React.CSSProperties}>
      <div className="pass-card__plot" aria-hidden="true">
        <PolarPlotSvg ref={svgRef} />
      </div>
      <div className="pass-card__body">
        <p className="pass-card__headline"><Headline text={headline(card, nowMs)} focus={focus} onFocus={onFocus} /></p>
        <p className="pass-card__meta">
          {passMetaLabel(pass, nowMs, { timeZone: observer.tz })}
          {pass.visible && <span className="pass-card__tag">visible</span>}
          <ElementTags track={track} />
          <ViewingTag viewing={viewing} />
        </p>
        <div className="pass-card__actions">
          <button type="button" className="home-chip" onClick={onSkyChart}>Sky chart</button>
          <button type="button" className="home-chip" onClick={onRadioChart}>Radio chart</button>
          <button type="button" className="home-chip" aria-label="Add to calendar" title="Add to calendar" onClick={addToCalendar}>
            📅
          </button>
          <AlertBell noradId={card.noradId} name={track.shortName} pass={pass} url={() => `/sat/${card.noradId}`} />
          {track.record?.source !== "pasted" && (
            <Link className="home-chip" href={`/sat/${card.noradId}`} aria-label={`Details for ${card.name}`}>Details</Link>
          )}
          <FollowChip viewing={viewing} onUnfollow={onUnfollow} />
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
}

// "Next up": one card per followed satellite, with the sky and radio chart
// modals for a pass card.
export default function NextUpList({
  cards: followedCards, viewingCard = null, tracks, colors, observer, mode, minElevDeg, nowMs,
  onUnfollow, onFollow, followBlocked, focusId, onFocus,
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
                focus={focusOf(card.noradId)}
                onFocus={() => toggle(card.noradId)}
                viewing={viewingOf(card.noradId)}
              />
            );
          }
          return (
            <li
              key={card.noradId}
              className={`pass-card pass-card--short${focusClass(focusOf(card.noradId))}`}
              style={{ "--sat-color": color } as React.CSSProperties}
            >
              <p className="pass-card__headline">
                <Headline text={headline(card, nowMs)} focus={focusOf(card.noradId)} onFocus={() => toggle(card.noradId)} />
                <ElementTags track={track} />
                <ViewingTag viewing={viewingOf(card.noradId)} />
              </p>
              {card.kind !== "missing" && track?.record?.source !== "pasted" && (
                <Link className="home-chip" href={`/sat/${card.noradId}`} aria-label={`Details for ${card.name}`}>Details</Link>
              )}
              <FollowChip viewing={viewingOf(card.noradId)} onUnfollow={() => onUnfollow(card.noradId)} />
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
