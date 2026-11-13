"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import QualityBadge, { type Quality } from "@/components/passes/QualityBadge";
import Button from "@/components/ui/Button";
import Segmented from "@/components/ui/Segmented";
import { passKey, passList, quietLines, rowDetail, rowWhen, ROW_LIMIT } from "@/lib/home/pass-list.mjs";
import { bestLine, upNowLine, upNowPass } from "@/lib/home/best-line.mjs";
import { satAltAzDeg } from "@/lib/pass-finder/visibility.js";
import { underWay as underWayAt } from "@/lib/passes/under-way.mjs";
import { cardHeadline } from "@/lib/home/next-up.mjs";
import type { Forecast } from "@/lib/sky/use-clouds";
import PassRow, { passRowsClass as rowsClass } from "./PassRow";
import LowFold from "./LowFold";
import { BestLine, UpNowLine } from "./BestLine";
import PassRowOpen, { AlwaysRowOpen } from "./PassRowOpen";
import { DOCKED_QUERY, useKeepRowInPlace } from "./useKeepRowInPlace";
import { useMapClock } from "@/lib/map/map-clock";
import type { OpenPassRow } from "@/lib/map/use-map-pause";
import { toggleOpen } from "@/lib/ui/open-row.mjs";
import { splitLowRows } from "@/lib/ui/low-fold.mjs";
import { MODE_HINT_TEXT, dismissModeHint, modeHintWanted } from "@/lib/home/mode-hint.mjs";
import {
  FollowChip, ViewingTag, bestPassOf, liveOk, passRating,
  type Card, type HomeObserver, type OpenChart, type Pass, type Track, type ViewingProps,
} from "./NextUpList";

type StationaryCard = Extract<Card, { kind: "stationary" }>;
type Row = { key: string; noradId: number; name: string; pass: Pass; now: boolean };
type Group = { key: string; label: string; rows: Row[] };
type Quiet = { none: string[]; neverUp: string[]; unusable: string[]; missing: number[] };

const listOf = passList as (o: { cards: Card[]; nowMs: number; timeZone?: string; limit?: number }) => {
  groups: Group[]; more: number; always: StationaryCard[]; quiet: Quiet;
};
const whenOf = rowWhen as (pass: Pass, nowMs: number, timeZone?: string) => { time: string; sub: string };
const detailOf = rowDetail as (pass: Pass) => string;
const quietOf = quietLines as (quiet: Quiet) => string[];
const underWay = underWayAt as (pass: Pass, nowMs: number) => boolean;
const headline = cardHeadline as (card: Card, nowMs: number) => string;
const keyOf = passKey as (noradId: number, pass: Pass) => string;
type Words = { label: string; text: string };
const bestWords = bestLine as (o: { name: string; pass: Pass; nowMs: number; timeZone?: string }) => Words;
const upNowOf = upNowPass as (cards: Card[], nowMs: number) => { noradId: number; name: string; pass: Pass } | null;
const upNowWords = upNowLine as (o: { name: string; pass: Pass; nowMs: number; azDeg?: number | null }) => Words;
const altAz = satAltAzDeg as (obs: HomeObserver, ecef: number[]) => { alt: number; az: number };

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Every pass start and end across the cards, sorted. */
function edgesOf(cards: Card[]): number[] {
  const out: number[] = [];
  for (const c of cards) {
    if (c.kind !== "pass") continue;
    for (const p of c.upcoming ?? c.passes ?? [c.pass]) out.push(p.startMs, p.endMs);
  }
  return out.sort((a, b) => a - b);
}

/** How many of the sorted `edges` are at or before `ms`. */
function countAtOrBefore(edges: number[], ms: number): number {
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (edges[mid] <= ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const MODES = [{ value: "visual" as const, label: "Visual" }, { value: "radio" as const, label: "Radio" }];

/** Row keys start with the NORAD id ("25544:1794…", "25544:viewing"). */
const idOfKey = (key: string) => Number.parseInt(key, 10);

interface Props {
  /** The followed satellites' cards. */
  cards: Card[];
  /** The card of the satellite being viewed (focused, not followed), if any: pinned first. */
  viewingCard?: Card | null;
  tracks: ReadonlyMap<number, Track>;
  colors: ReadonlyMap<number, string>;
  observer: HomeObserver;
  mode: "radio" | "visual";
  minElevDeg: number;
  nowMs: number;
  onModeChange: (mode: "radio" | "visual") => void;
  /** "Times are Tokyo time (UTC+9).", when the place keeps another clock. */
  zoneNote?: string | null;
  /** Shown under the heading (the 24 hour strip on desktop). */
  strip?: ReactNode;
  /** Beside the heading, before the mode switch (the Following button). */
  headAction?: ReactNode;
  onUnfollow: (noradId: number) => void;
  onFollow: (noradId: number) => void;
  /** The follow cap message for the viewed satellite, when blocked. */
  followBlocked: string | null;
  openChart: OpenChart;
  /** The cloud forecast for visual passes (from `useClouds`), or null. */
  clouds?: Forecast | null;
  /** The sky type for the visual rating (prefs `skyType`). */
  skyType: string;
  /** The row the viewer opened (its satellite and pass), or null when all are closed. */
  onOpenRow: (open: OpenPassRow | null) => void;
}


// The home pass list: every pass in the next 48 hours as one compact row
// under day headings, each opening in place.
export default function PassList({
  cards: followedCards, viewingCard = null, tracks, colors, observer, mode, minElevDeg, nowMs, onModeChange,
  zoneNote = null, strip, headAction = null, onUnfollow, onFollow, followBlocked, openChart, clouds = null, skyType, onOpenRow,
}: Props) {
  const baseId = useId();
  const headingId = `${baseId}-title`;
  const panelId = (key: string) => `${baseId}-${key.replace(/[^\w-]/g, "-")}`;
  const visual = mode === "visual";
  const tz = observer.tz;

  const [showAll, setShowAll] = useState(false);
  // The one-time mode note: unknown (nothing drawn) until storage is read.
  const [hint, setHint] = useState(false);
  useEffect(() => {
    try { setHint((modeHintWanted as (s: Storage) => boolean)(window.localStorage)); } catch { /* hidden */ }
  }, []);
  const pickMode = (next: "radio" | "visual") => {
    if (hint) {
      setHint(false);
      try { (dismissModeHint as (s: Storage) => void)(window.localStorage); } catch { /* ignore */ }
    }
    onModeChange(next);
  };
  // The one open row: opening another closes it.
  const [openKey, setOpenKey] = useState<string | null>(null);
  // The row opened for the viewer (desktop's first pass), until they toggle it.
  const [autoKey, setAutoKey] = useState<string | null>(null);
  const keepInPlace = useKeepRowInPlace();
  const toggle = (key: string, button: HTMLElement) => {
    if (key === autoKey) setAutoKey(null);
    keepInPlace(button);
    setOpenKey((prev) => toggleOpen(prev, key));
  };
  // The row the Best line opened, scrolled into view once it has rendered.
  const scrollTo = useRef<string | null>(null);

  const cards = useMemo(
    () => (viewingCard ? followedCards.filter((c) => c.noradId !== viewingCard.noradId) : followedCards),
    [followedCards, viewingCard],
  );
  // The rows only move when a pass starts or ends, or the day turns: build
  // them once a minute and at each of those moments, not on every
  // one-second tick ("in N min" is read per row below).
  const minuteMs = Math.floor(nowMs / 60_000) * 60_000;
  const edges = useMemo(() => edgesOf(cards), [cards]);
  const crossed = countAtOrBefore(edges, nowMs);
  const limit = showAll ? Infinity : ROW_LIMIT;
  const { groups, more, always, quiet } = useMemo(() => {
    return listOf({ cards, nowMs, timeZone: tz, limit });
    // nowMs is read when the list rebuilds; minuteMs and crossed say when.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, minuteMs, crossed, tz, limit]);
  const quietText = useMemo(() => quietOf(quiet), [quiet]);
  // Ratings read the cards, the sky and the forecast; rate once a minute, not per tick.
  // The soonest pass counts: the Best line names it even when it comes first.
  const best = useMemo(
    () => bestPassOf(followedCards, { mode, skyType, clouds, nowMs: minuteMs }, { skipSoonest: false }),
    [followedCards, mode, skyType, clouds, minuteMs],
  );
  // A followed pass up now, and where the satellite is, at most once a second.
  const upNow = upNowOf(followedCards, nowMs);
  const upTrack = upNow ? tracks.get(upNow.noradId) : undefined;
  const secondMs = Math.floor(nowMs / 1000) * 1000;
  const upAzDeg = useMemo(() => {
    const ecef = upTrack?.ecefAt(new Date(secondMs));
    return ecef ? altAz(observer, ecef).az : null;
  }, [upTrack, observer, secondMs]);
  const ratingOf = useMemo(() => {
    const cache = new Map<Pass, Quality>();
    return (pass: Pass) => {
      let q = cache.get(pass);
      if (!q) {
        q = passRating(pass, { mode, skyType, clouds, nowMs: minuteMs });
        cache.set(pass, q);
      }
      return q;
    };
  }, [mode, skyType, clouds, minuteMs]);
  const viewingOf = (id: number): ViewingProps | null => (viewingCard && viewingCard.noradId === id
    ? { onFollow: () => onFollow(id), blocked: followBlocked }
    : null);
  const colorOf = (id: number) => colors.get(id) ?? "var(--map-muted)";

  const pinnedKey = viewingCard ? `${viewingCard.noradId}:viewing` : null;
  // The first row a reader sees: never one folded away as a low pass, so the
  // auto-opened row is at the top rather than inside the fold.
  const firstKey = groups
    .map((g) => (splitLowRows as (rows: typeof g.rows, nowMs: number) => { shown: typeof g.rows })(g.rows, nowMs).shown[0]?.key)
    .find((k) => k != null) ?? null;
  const keys = [
    ...(pinnedKey ? [pinnedKey] : []),
    ...groups.flatMap((g) => g.rows.map((r) => r.key)),
    ...always.map((c) => `${c.noradId}:always`),
  ];

  // From 1100 px the first pass starts open; read when it first shows, and
  // again after the list has run empty (new mode, place or follows).
  const seeded = useRef(false);
  useEffect(() => {
    if (!firstKey) {
      seeded.current = false;
      return;
    }
    if (seeded.current) return;
    seeded.current = true;
    if (!window.matchMedia(DOCKED_QUERY).matches) return;
    setOpenKey(firstKey);
    setAutoKey(firstKey);
  }, [firstKey]);

  // Forget the open row once it leaves the list (a pass ended, the mode changed).
  const keyList = keys.join(" ");
  useEffect(() => {
    const live = new Set(keyList.split(" "));
    setOpenKey((prev) => (prev != null && !live.has(prev) ? null : prev));
  }, [keyList]);

  // Report the row the viewer opened while it is still in the list (the
  // prune above lands a render later). The auto-opened row is not reported,
  // so the map stays at rest until the viewer picks a row.
  const viewerOpen = openKey != null && openKey !== autoKey && keys.includes(openKey) ? openKey : null;
  const openPass = !viewerOpen ? null
    : viewerOpen === pinnedKey ? (viewingCard?.kind === "pass" ? viewingCard.pass : null)
      : groups.flatMap((g) => g.rows).find((r) => r.key === viewerOpen)?.pass ?? null;
  const openStart = openPass?.startMs ?? null;
  const reported = useRef<string | null>(null);
  useEffect(() => {
    const sig = viewerOpen ? `${viewerOpen}@${openStart}` : null;
    if (sig === reported.current) return;
    reported.current = sig;
    onOpenRow(viewerOpen ? { key: viewerOpen, noradId: idOfKey(viewerOpen), pass: openPass } : null);
    // openPass is read when the row or its pass changes, not on each rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerOpen, openStart, onOpenRow]);
  // Back to live on the map closes the row the map was paused for.
  const resumeTick = useMapClock((s) => s.resumeTick);
  const seenTick = useRef(resumeTick);
  useEffect(() => {
    if (resumeTick === seenTick.current) return;
    seenTick.current = resumeTick;
    setOpenKey(null);
  }, [resumeTick]);

  // The Best line's row: the viewed satellite's pinned row when it is that
  // pass, else its row in the list (perhaps past "Show more").
  const bestKey = !best || best.pass.endMs <= nowMs ? null
    : viewingCard?.noradId === best.noradId
      ? (viewingCard.kind === "pass" && viewingCard.pass.startMs === best.pass.startMs ? pinnedKey : null)
      : keyOf(best.noradId, best.pass);
  const openBest = () => {
    if (!bestKey) return;
    if (!keys.includes(bestKey)) setShowAll(true);
    if (bestKey === autoKey) setAutoKey(null);
    setOpenKey(bestKey);
    scrollTo.current = bestKey;
  };
  useEffect(() => {
    const key = scrollTo.current;
    if (!key) return;
    scrollTo.current = null;
    const row = document.querySelector(`[aria-controls="${CSS.escape(panelId(key))}"]`)?.closest("li");
    row?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  });

  const line = (() => {
    if (upNow) {
      const words = upNowWords({ name: upNow.name, pass: upNow.pass, nowMs, azDeg: upAzDeg });
      const onLive = upTrack && liveOk(upNow.pass, nowMs)
        ? (e: React.MouseEvent<HTMLButtonElement>) => openChart("live", upTrack, upNow.pass, e)
        : null;
      return <UpNowLine words={words} onLive={onLive} />;
    }
    if (best && bestKey) {
      return <BestLine words={bestWords({ name: best.name, pass: best.pass, nowMs, timeZone: tz })} onOpen={openBest} />;
    }
    return null;
  })();

  const passRow = (row: Row, viewing: ViewingProps | null) => {
    const track = tracks.get(row.noradId);
    const { time, sub } = whenOf(row.pass, nowMs, tz);
    const isOpen = openKey === row.key;
    const id = panelId(row.key);
    return (
      <PassRow
        key={row.key}
        id={id}
        color={colorOf(row.noradId)}
        time={time}
        sub={sub}
        now={row.now}
        name={row.name}
        tag={<ViewingTag viewing={viewing} />}
        detail={detailOf(row.pass)}
        rating={<QualityBadge pass={row.pass} rating={visual ? ratingOf(row.pass) : undefined} maxShown pill />}
        open={isOpen}
        onToggle={(button) => toggle(row.key, button)}
      >
        {track && (
          <PassRowOpen
            id={id}
            name={row.name}
            track={track}
            pass={row.pass}
            rating={visual ? ratingOf(row.pass) : undefined}
            observer={observer}
            mode={mode}
            minElevDeg={minElevDeg}
            nowMs={nowMs}
            clouds={clouds}
            viewing={viewing}
            onUnfollow={() => onUnfollow(row.noradId)}
            openChart={openChart}
            best={best != null && best.noradId === row.noradId && best.pass.startMs === row.pass.startMs}
          />
        )}
      </PassRow>
    );
  };

  const alwaysRow = (card: StationaryCard, key: string, viewing: ViewingProps | null) => {
    const track = tracks.get(card.noradId);
    const { azDeg, elDeg } = card.pointing;
    const id = panelId(key);
    return (
      <PassRow
        key={key}
        id={id}
        color={colorOf(card.noradId)}
        time="All day"
        name={card.name}
        tag={<ViewingTag viewing={viewing} />}
        detail={`Az ${Math.round(azDeg)}° · El ${Math.round(elDeg)}°`}
        rating={visual ? null : <QualityBadge pass={{ maxElevDeg: elDeg }} maxShown pill />}
        open={openKey === key}
        onToggle={(button) => toggle(key, button)}
      >
        {track && (
          <AlwaysRowOpen
            id={id}
            name={card.name}
            track={track}
            pointing={card.pointing}
            observer={observer}
            mode={mode}
            nowMs={nowMs}
            viewing={viewing}
            onUnfollow={() => onUnfollow(card.noradId)}
            openChart={openChart}
          />
        )}
      </PassRow>
    );
  };

  /** The viewed satellite, first: its next pass, its fixed pointing, or why it has neither. */
  const pinned = (card: Card, key: string) => {
    const viewing = viewingOf(card.noradId);
    if (card.kind === "pass") {
      const { pass } = card;
      return passRow({ key, noradId: card.noradId, name: card.name, pass, now: underWay(pass, nowMs) }, viewing);
    }
    if (card.kind === "stationary" && card.visible) return alwaysRow(card, key, viewing);
    return (
      <li key={key} className="pass-row" style={{ "--sat-color": colorOf(card.noradId) } as CSSProperties}>
        <div className="pass-row__note">
          <span className="pass-row__note-text">{headline(card, nowMs)}<ViewingTag viewing={viewing} /></span>
          <FollowChip viewing={viewing} onUnfollow={() => onUnfollow(card.noradId)} />
        </div>
      </li>
    );
  };

  return (
    <section className="pass-list" aria-labelledby={headingId}>
      <div className="pass-list__head">
        <h2 id={headingId} className="heading-section">Passes</h2>
        {headAction}
        <Segmented label="Pass mode" size="sm" options={MODES} value={mode} onChange={pickMode} />
      </div>
      {hint && <p className="note note--sm pass-list__hint">{MODE_HINT_TEXT}</p>}
      {zoneNote && <p className="note note--sm pass-list__zone">{zoneNote}</p>}
      {line}
      {strip}
      {viewingCard && pinnedKey && <ul className={rowsClass}>{pinned(viewingCard, pinnedKey)}</ul>}
      {groups.map((group) => (
        <div key={group.key} className="pass-list__group">
          <h3 className="heading-group pass-list__day">{group.label}</h3>
          <ul className={rowsClass}>
            <LowFold rows={group.rows} nowMs={nowMs} openKey={openKey} renderRow={(row) => passRow(row, null)} />
          </ul>
        </div>
      ))}
      {more > 0 && (
        <Button variant="quiet" size="sm" className="pass-list__more" onClick={() => setShowAll(true)}>
          {`Show more (${more})`}
        </Button>
      )}
      {always.length > 0 && (
        <div className="pass-list__group">
          <h3 className="heading-group pass-list__day">Always up</h3>
          <ul className={rowsClass}>{always.map((card) => alwaysRow(card, `${card.noradId}:always`, null))}</ul>
        </div>
      )}
      {quietText.map((line) => <p key={line} className="note note--sm">{line}</p>)}
    </section>
  );
}
