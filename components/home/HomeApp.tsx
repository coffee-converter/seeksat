"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import FlatMap from "./FlatMap";
import FocusBar from "./FocusBar";
import SatChips, { type Chip } from "./SatChips";
import { useMapSats, type Layer } from "./useMapSats";
import { SearchBar } from "./SearchBar";
import HomeControls from "./HomeControls";
import LocationPrompt, { PopularList } from "./LocationPrompt";
import UpNow from "./UpNow";
import NextStrip, { type NextSummary } from "./NextStrip";
import { nextPassSummary, currentCards } from "@/lib/home/next-strip.mjs";
import NextUpList, { usePassCharts, type Card, type HomeObserver, type Pass, type Track } from "./NextUpList";
import Timeline from "./Timeline";
import { useHomeStore, watchVisibility, type SatApiRecord } from "@/lib/home/store";
import { tracksFor } from "@/lib/home/records.mjs";
import { getPassRunner } from "@/lib/passes/pass-client.mjs";
import { cardJobKey } from "@/lib/passes/job-key.mjs";
import { POPULAR_IDS } from "@/lib/home/prefs.mjs";
import { savedAgeNotice, shouldRefreshCards } from "@/lib/home/view.mjs";
import { focusHref, focusNavMethod, mapLayers, parseFocus, showAllCount } from "@/lib/home/focus.mjs";
import { followBlockedMessage } from "@/lib/home/actions.mjs";
import { SAT_PALETTES } from "@/lib/map/palette.mjs";
import { useResolvedTheme } from "@/lib/ui/use-theme";
import { CATALOG } from "@/lib/catalog.mjs";
import { trueNow } from "@/lib/pass-finder/clock-sync.js";
import { useClouds } from "@/lib/sky/use-clouds";
import { passCloud } from "@/components/passes/CloudBadge";
import { visualRating } from "@/components/passes/QualityBadge";
import AboutSection from "./AboutSection";
import LiveClock from "@/components/LiveClock";
import NightToggle from "@/components/NightToggle";
import ThemeToggle from "@/components/ThemeToggle";
import ClockSkewBanner from "@/components/passes/ClockSkewBanner";
import MapShell from "@/components/MapShell";
import "@/app/home.css";

const CARD_REFRESH_MS = 10 * 60_000;

const buildTracks = tracksFor as (records: Map<number, SatApiRecord>, custom: unknown[]) => Map<number, Track>;
const layersOf = mapLayers as (o: {
  followed: number[]; hidden: number[]; focusId: number | null; viewing: number | null;
}) => Layer[];
const countOf = showAllCount as (layers: Layer[]) => number;

/** Reads ?focus= into the store. Alone inside Suspense, so / stays static.
 *  It reads the live URL when the param changes, so a stale render left
 *  behind by two quick focus changes never flips the store back. */
function FocusParam() {
  const raw = useSearchParams().get("focus");
  const setFocusId = useHomeStore((s) => s.setFocusId);
  useEffect(() => {
    setFocusId(parseFocus(new URLSearchParams(window.location.search).get("focus")) as number | null);
  }, [raw, setFocusId]);
  return null;
}

/** Marks a history entry our focus pushed, so clearing can step back over it. */
const PUSHED_KEY = "seeksatFocusPushed";
const pushedHere = () => (window.history.state as Record<string, unknown> | null)?.[PUSHED_KEY] === true;

interface Props {
  /** Snapshot records for the popular set, shown until the first load lands. */
  initialRecords?: ReadonlyArray<SatApiRecord>;
}

const summarize = nextPassSummary as (cards: unknown, nowMs: number) => NextSummary | null;
const cardsNow = currentCards as (state: { cards: unknown; key: string } | null, key: string) => unknown;

export default function HomeApp({ initialRecords = [] }: Props) {
  const prefs = useHomeStore((s) => s.prefs);
  const hydrated = useHomeStore((s) => s.hydrated);
  const records = useHomeStore((s) => s.records);
  const missing = useHomeStore((s) => s.missing);
  const status = useHomeStore((s) => s.status);
  const error = useHomeStore((s) => s.error);
  const focusId = useHomeStore((s) => s.focusId);
  const viewing = useHomeStore((s) => s.viewing);
  const fromCache = useHomeStore((s) => s.fromCache);
  const generatedAtMs = useHomeStore((s) => s.generatedAtMs);
  const hydrate = useHomeStore((s) => s.hydrate);
  const loadRecords = useHomeStore((s) => s.loadRecords);
  const loadViewing = useHomeStore((s) => s.loadViewing);
  const setPrefs = useHomeStore((s) => s.setPrefs);
  const follow = useHomeStore((s) => s.follow);
  const unfollow = useHomeStore((s) => s.unfollow);
  const toggleHidden = useHomeStore((s) => s.toggleHidden);

  const [nowMs, setNowMs] = useState<number | null>(null);
  const [changingLocation, setChangingLocation] = useState(false);

  useEffect(() => {
    hydrate();
    void loadRecords();
  }, [hydrate, loadRecords]);
  useEffect(() => watchVisibility(), []);
  // The one-second clock that drives the map and cards, on server time once a
  // response has measured the skew (as the banner promises). Starts after mount so
  // the server render and hydration agree, and stops while the tab is hidden.
  useEffect(() => {
    // Ticks land on whole seconds of the displayed (skew-corrected) clock:
    // one timeout to the next boundary, then a 1 s interval.
    let first: number | undefined;
    let id: number | undefined;
    const stop = () => {
      if (first !== undefined) window.clearTimeout(first);
      if (id !== undefined) window.clearInterval(id);
      first = undefined;
      id = undefined;
    };
    const start = () => {
      stop();
      setNowMs(trueNow());
      first = window.setTimeout(() => {
        first = undefined;
        setNowMs(trueNow());
        id = window.setInterval(() => setNowMs(trueNow()), 1000);
      }, 1000 - (trueNow() % 1000));
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    if (document.hidden) setNowMs(trueNow());
    else start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // The server's snapshot records stand in until the first load lands.
  const seed = useMemo(
    () => new Map(initialRecords.map((r) => [r.noradId as number, r])),
    [initialRecords],
  );
  const shownRecords = records.size > 0 || status === "ready" ? records : seed;
  // Every track the map might draw: the followed ones plus a viewing one.
  const allTracks = useMemo(() => {
    const all = new Map(shownRecords);
    if (viewing && !all.has(viewing.noradId as number)) all.set(viewing.noradId as number, viewing);
    return buildTracks(all, prefs.custom);
  }, [shownRecords, viewing, prefs.custom]);
  const shownMissing = useMemo(
    () => missing.filter((id) => prefs.following.includes(id)),
    [missing, prefs.following],
  );
  const theme = useResolvedTheme();
  const colors = useMemo(() => {
    const pal: string[] = SAT_PALETTES[theme];
    const out = new Map(prefs.following.map((id, i) => [id, pal[i % pal.length]]));
    if (focusId != null && !out.has(focusId)) out.set(focusId, pal[out.size % pal.length]);
    return out;
  }, [prefs.following, focusId, theme]);

  // Focus lives in ?focus=, changed through the History API (Next keeps
  // useSearchParams in step, with no server round trip). Entering a focus
  // pushes, switching replaces, and clearing steps back over the entry we
  // pushed (else replaces), so Back always leaves focus.
  const focusOn = useCallback((id: number | null) => {
    const pushed = pushedHere();
    const method = focusNavMethod(useHomeStore.getState().focusId, id, pushed) as "push" | "replace" | "back" | null;
    if (!method) return;
    useHomeStore.getState().setFocusId(id);
    if (method === "back") {
      window.history.back();
      return;
    }
    const href = focusHref(window.location.pathname, window.location.search, id) as string;
    // A fresh object (no Next internals): Next copies its own state across.
    if (method === "push") window.history.pushState({ [PUSHED_KEY]: true }, "", href);
    else window.history.replaceState({ [PUSHED_KEY]: id != null && pushed }, "", href);
  }, []);
  // A focus that is not followed (from search, or a shared link) needs its record.
  useEffect(() => {
    if (hydrated && focusId != null && !prefs.following.includes(focusId)) void loadViewing(focusId);
  }, [hydrated, focusId, prefs.following, loadViewing]);
  useEffect(() => {
    if (focusId == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      focusOn(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusId, focusOn]);

  const layers = useMemo(() => layersOf({
    followed: prefs.following,
    hidden: prefs.hidden,
    focusId,
    viewing: (viewing?.noradId as number | undefined) ?? null,
  }), [prefs.following, prefs.hidden, focusId, viewing]);
  const showAll = useMemo(
    () => countOf(layersOf({ followed: prefs.following, hidden: prefs.hidden, focusId: null, viewing: null })),
    [prefs.following, prefs.hidden],
  );
  const nameOf = useCallback((id: number) => allTracks.get(id)?.shortName
    ?? CATALOG.find((s) => s.noradId === id)?.shortName
    ?? `NORAD ${id}`, [allTracks]);
  const chips = useMemo<Chip[]>(() => prefs.following.map((id) => ({
    noradId: id,
    name: nameOf(id),
    color: colors.get(id) ?? SAT_PALETTES[theme][0],
    hidden: prefs.hidden.includes(id),
  })), [prefs.following, prefs.hidden, nameOf, colors, theme]);

  const location = prefs.location;
  const observer = useMemo<HomeObserver | null>(
    () => location && {
      id: "home",
      name: location.name || "Your location",
      latDeg: location.latDeg,
      lonDeg: location.lonDeg,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      elevM: 0,
      elevSource: "default",
    },
    [location],
  );

  // Tracks shown in the sky view: everything the map draws that is not hidden.
  const skyTracks = useMemo(() => {
    const m = new Map<number, Track>();
    for (const l of layers as Array<{ noradId: number; emphasis: string }>) {
      const t = allTracks.get(l.noradId);
      if (t && l.emphasis !== "hidden") m.set(l.noradId, t);
    }
    return m;
  }, [layers, allTracks]);

  const { sats, focusSub } = useMapSats({
    layers, tracks: allTracks, colors, nowMs, minElevDeg: prefs.minElevDeg,
  });

  // Cards: on any input change, every 10 min, and when a pass starts or ends.
  // Cards are kept with the inputs they were computed for and shown only
  // while those still match; a refresh tick keeps the old cards up.
  const cardKey = useMemo(
    () => cardJobKey({
      following: prefs.following, custom: prefs.custom, observer, mode: prefs.mode, minElevDeg: prefs.minElevDeg,
    }),
    [prefs.following, prefs.custom, observer, prefs.mode, prefs.minElevDeg],
  );
  const [cardState, setCardState] = useState<{ cards: Card[]; at: number; key: string } | null>(null);
  const [cardTick, setCardTick] = useState(0);
  const cardRequest = useRef(0);
  const warned = useRef(false);
  const inFlight = useRef(false);
  const retryAt = useRef<number | null>(null);
  useEffect(() => {
    const request = ++cardRequest.current;
    retryAt.current = null;
    if (!observer) {
      inFlight.current = false;
      setCardState(null);
      return;
    }
    inFlight.current = true;
    const at = trueNow();
    // Only the followed records cross to the worker; custom elements ride along.
    const followed = prefs.following;
    getPassRunner()
      .run({
        kind: "next-up",
        records: [...shownRecords.values()].filter((r) => followed.includes(r.noradId as number)),
        custom: prefs.custom,
        following: followed,
        missing: shownMissing,
        observer,
        mode: prefs.mode,
        minElevDeg: prefs.minElevDeg,
        nowMs: at,
      })
      .then((cards: unknown) => {
        if (request !== cardRequest.current) return;
        inFlight.current = false;
        setCardState({ cards: cards as unknown as Card[], at, key: cardKey });
      })
      .catch((e: unknown) => {
        if (request === cardRequest.current) {
          inFlight.current = false;
          retryAt.current = trueNow() + CARD_REFRESH_MS;
        }
        if (warned.current) return;
        warned.current = true;
        console.warn("Pass search failed; keeping the previous cards.", e);
      });
  }, [shownRecords, prefs.custom, prefs.following, shownMissing, observer, prefs.mode, prefs.minElevDeg, cardKey, cardTick]);
  useEffect(() => {
    if (!observer) return;
    if (shouldRefreshCards({
      cardState, nowMs, inFlight: inFlight.current, retryAtMs: retryAt.current, refreshMs: CARD_REFRESH_MS,
    })) {
      setCardTick((t) => t + 1);
    }
  }, [nowMs, cardState, observer]);

  // The satellite being viewed (focused, not followed) gets its own card,
  // from the same next-up job, kept apart so the followed cards never wait.
  const viewingId = focusId != null && !prefs.following.includes(focusId) && viewing?.noradId === focusId
    ? focusId
    : null;
  const viewKey = viewingId == null ? null : `${viewingId}|${cardKey}`;
  const [viewCard, setViewCard] = useState<{ key: string; card: Card } | null>(null);
  const cardsAt = cardState?.at ?? null;
  useEffect(() => {
    if (viewKey == null || !observer || !viewing) return;
    let alive = true;
    const id = viewing.noradId as number;
    getPassRunner()
      .run({
        kind: "next-up",
        records: [viewing],
        custom: [],
        following: [id],
        missing: [],
        observer,
        mode: prefs.mode,
        minElevDeg: prefs.minElevDeg,
        nowMs: trueNow(),
      })
      .then((cards: unknown) => {
        const card = (cards as Card[])[0];
        if (alive && card) setViewCard({ key: viewKey, card });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  // cardsAt: refresh alongside the followed cards.
  }, [viewKey, viewing, observer, prefs.mode, prefs.minElevDeg, cardsAt]);
  const viewingCard = viewCard && viewCard.key === viewKey ? viewCard.card : null;

  const popularNames = useMemo(() => {
    const names = new Map<number, string>();
    for (const id of POPULAR_IDS) {
      const name = CATALOG.find((s) => s.noradId === id)?.shortName
        ?? records.get(id)?.name ?? seed.get(id)?.name;
      if (name) names.set(id, String(name));
    }
    return names;
  }, [records, seed]);

  const showPrompt = hydrated && (!location || changingLocation);
  // Stacked (one column, under 1100 px) the map comes before the panel, so a
  // first visit puts the location card above the map, in view without scrolling.
  const stacked = useStacked();
  const locationFirst = hydrated && !location && stacked;

  // Saved satellites say how old they are, even when the browser thinks it is
  // online (a captive portal); back online, they reload.
  const savedAge = fromCache && nowMs != null ? (savedAgeNotice as (a: number | null, b: number) => string | null)(generatedAtMs, nowMs) : null;
  useEffect(() => {
    if (!fromCache) return;
    const reload = () => void loadRecords();
    window.addEventListener("online", reload);
    return () => window.removeEventListener("online", reload);
  }, [fromCache, loadRecords]);

  // The soonest pass, for the phone strip.
  const shownCards = cardsNow(cardState, cardKey) as Card[] | null;
  const nextSummary = nowMs != null ? summarize(shownCards, nowMs) : null;

  // One set of chart modals for the cards and the timeline.
  const { open: openChart, modals: chartModals } = usePassCharts(observer, prefs.minElevDeg);
  const openTimelinePass = useCallback((noradId: number, pass: Pass, e: React.MouseEvent<HTMLButtonElement>) => {
    const track = allTracks.get(noradId);
    if (track) openChart("sky", track, pass, e);
  }, [allTracks, openChart]);

  // Cloud forecasts for visual passes; radio mode never fetches them.
  const clouds = useClouds(location, prefs.mode === "visual");
  const cloudFor = useCallback(
    (pass: Pass) => (nowMs == null ? null : passCloud(clouds, pass, nowMs)),
    [clouds, nowMs],
  );

  return (
    <MapShell
      className={hydrated && !location ? "home-first-visit" : undefined}
      offlineFromCache={fromCache}
      notice={savedAge && <p className="saved-age">{savedAge}</p>}
      top={(
        <>
          <h1 className="home-wordmark">SeekSat</h1>
          <div className="map-shell__search">
            <SearchBar onView={focusOn} onClearFocus={() => focusOn(null)} />
          </div>
          <div className="map-shell__end">
            <LiveClock nowMs={nowMs} compact />
            <ThemeToggle />
            <NightToggle />
          </div>
        </>
      )}
      map={(
        <>
          {locationFirst && <LocationPrompt />}
          <Suspense fallback={null}>
            <FocusParam />
          </Suspense>
          {nowMs != null && (
            <NextStrip
              summary={nextSummary}
              rating={nextSummary && prefs.mode === "visual"
                ? visualRating(nextSummary.pass, { skyType: prefs.skyType, cloud: cloudFor(nextSummary.pass as Pass) })
                : undefined}
              cloud={nextSummary && prefs.mode === "visual" ? cloudFor(nextSummary.pass as Pass) : null}
              onFocus={focusOn}
            />
          )}
          <FlatMap
            fill
            sats={sats}
            observer={location}
            selectedSub={focusSub}
            projectionId={prefs.projection}
            onProjectionChange={(id) => setPrefs({ projection: id })}
            selectedId={focusId}
            minElevDeg={prefs.minElevDeg}
            onSelect={focusOn}
            top={focusId != null && (
              <FocusBar
                name={nameOf(focusId)}
                followed={prefs.following.includes(focusId)}
                blocked={followBlockedMessage(prefs.following, focusId) as string | null}
                total={showAll}
                pageHref={allTracks.get(focusId)?.record?.source === "pasted" ? null : `/sat/${focusId}`}
                onToggleFollow={() => (prefs.following.includes(focusId) ? unfollow(focusId) : follow(focusId))}
                onShowAll={() => focusOn(null)}
              />
            )}
            chips={hydrated && (
              <SatChips chips={chips} focusId={focusId} onFocus={focusOn} onToggleHidden={toggleHidden} />
            )}
          />
        </>
      )}
      panel={(
        <>
          <ClockSkewBanner />
          <HomeControls
            ready={hydrated}
            mode={prefs.mode}
            minElevDeg={prefs.minElevDeg}
            skyType={prefs.skyType}
            locationName={location && !changingLocation ? location.name : null}
            onModeChange={(mode) => setPrefs({ mode })}
            onMinElevChange={(minElevDeg) => setPrefs({ minElevDeg })}
            onSkyTypeChange={(skyType) => setPrefs({ skyType })}
            onChangeLocation={() => setChangingLocation(true)}
          />

          {status === "error" && (
            <div className="home-banner" role="alert">
              <span>{error ?? "Something went wrong loading satellites."}</span>
              <button type="button" className="home-button" onClick={() => void loadRecords()}>
                Try again
              </button>
            </div>
          )}

          {!hydrated ? null : showPrompt ? (
            <>
              {!locationFirst && (
                <LocationPrompt
                  onDone={() => setChangingLocation(false)}
                  onCancel={location ? () => setChangingLocation(false) : undefined}
                />
              )}
              {!location && <PopularList names={popularNames} />}
            </>
          ) : observer && (
            <>
              {nowMs != null && (prefs.following.length > 0 || focusId != null) && (
                <UpNow tracks={skyTracks} observer={observer} colors={colors} nowMs={nowMs} focusId={focusId} />
              )}
              {nowMs != null && prefs.following.length > 0 && shownCards && (
                <Timeline
                  cards={shownCards}
                  tracks={allTracks}
                  colors={colors}
                  observer={observer}
                  mode={prefs.mode}
                  nowMs={nowMs}
                  onOpenPass={openTimelinePass}
                  cloudFor={cloudFor}
                  skyType={prefs.skyType}
                />
              )}
              {prefs.following.length === 0 ? (
                <>
                  <p className="home-note">You aren&apos;t following any satellites. Search above to add one.</p>
                  {viewingCard && nowMs != null && (
                    <NextUpList
                      cards={[]}
                      viewingCard={viewingCard}
                      tracks={allTracks}
                      colors={colors}
                      observer={observer}
                      mode={prefs.mode}
                      minElevDeg={prefs.minElevDeg}
                      nowMs={nowMs}
                      onUnfollow={unfollow}
                      onFollow={follow}
                      followBlocked={null}
                      focusId={focusId}
                      onFocus={focusOn}
                      openChart={openChart}
                      clouds={clouds}
                      skyType={prefs.skyType}
                    />
                  )}
                  <PopularList names={popularNames} />
                </>
              ) : !cardState || (cardState.cards.length === 0 && status === "loading") ? (
                <p className="home-note">Loading satellites...</p>
              ) : cardState.key !== cardKey ? (
                <p className="home-note" role="status">Finding passes...</p>
              ) : (
                nowMs != null && (
                  <NextUpList
                    cards={cardState.cards}
                    viewingCard={viewingCard}
                    tracks={allTracks}
                    colors={colors}
                    observer={observer}
                    mode={prefs.mode}
                    minElevDeg={prefs.minElevDeg}
                    nowMs={nowMs}
                    onUnfollow={unfollow}
                    onFollow={follow}
                    followBlocked={viewingId == null ? null : followBlockedMessage(prefs.following, viewingId) as string | null}
                    focusId={focusId}
                    onFocus={focusOn}
                    openChart={openChart}
                    clouds={clouds}
                    skyType={prefs.skyType}
                  />
                )
              )}
            </>
          )}

          {chartModals}

          <AboutSection />

          <footer className="home-footer">
            <span>
              built by{" "}
              <a href="https://aaronhanson.dev" target="_blank" rel="noopener">Aaron Hanson</a>
            </span>
          </footer>
        </>
      )}
    />
  );
}

const STACKED_QUERY = "(max-width: 1099.98px)";

/** True while the shell is one column (app/home.css), read after mount. */
function useStacked(): boolean {
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(STACKED_QUERY);
    const sync = () => setStacked(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return stacked;
}
