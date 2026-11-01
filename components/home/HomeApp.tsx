"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import FlatMap from "./FlatMap";
import FocusBar from "./FocusBar";
import SatChips, { type Chip } from "./SatChips";
import { useMapSats, type Layer } from "./useMapSats";
import { SearchBar } from "./SearchBar";
import HomeControls from "./HomeControls";
import LocationPrompt, { PopularList } from "./LocationPrompt";
import NextUpList, { type Card, type HomeObserver, type Track } from "./NextUpList";
import { useHomeStore, watchVisibility, type SatApiRecord } from "@/lib/home/store";
import { tracksFor } from "@/lib/home/records.mjs";
import { getPassRunner } from "@/lib/passes/pass-client.mjs";
import { cardJobKey } from "@/lib/passes/job-key.mjs";
import { POPULAR_IDS } from "@/lib/home/prefs.mjs";
import { followedTracks, shouldRefreshCards } from "@/lib/home/view.mjs";
import { focusHref, focusNavMethod, mapLayers, parseFocus, showAllCount } from "@/lib/home/focus.mjs";
import { followBlockedMessage } from "@/lib/home/actions.mjs";
import { SAT_PALETTE } from "@/lib/map/draw.mjs";
import { CATALOG } from "@/lib/catalog.mjs";
import { trueNow } from "@/lib/pass-finder/clock-sync.js";
import AboutSection from "./AboutSection";
import LiveClock from "@/components/LiveClock";
import ClockSkewBanner from "@/components/passes/ClockSkewBanner";
import "@/app/home.css";

const CARD_REFRESH_MS = 10 * 60_000;

const buildTracks = tracksFor as (records: Map<number, SatApiRecord>, custom: unknown[]) => Map<number, Track>;
const layersOf = mapLayers as (o: {
  followed: number[]; hidden: number[]; focusId: number | null; viewing: number | null;
}) => Layer[];
const countOf = showAllCount as (layers: Layer[]) => number;

/** Reads ?focus= into the store. Alone inside Suspense, so / stays static. */
function FocusParam() {
  const raw = useSearchParams().get("focus");
  const setFocusId = useHomeStore((s) => s.setFocusId);
  useEffect(() => {
    setFocusId(parseFocus(raw) as number | null);
  }, [raw, setFocusId]);
  return null;
}

interface Props {
  /** Snapshot records for the popular set, shown until the first load lands. */
  initialRecords?: ReadonlyArray<SatApiRecord>;
}

export default function HomeApp({ initialRecords = [] }: Props) {
  const prefs = useHomeStore((s) => s.prefs);
  const hydrated = useHomeStore((s) => s.hydrated);
  const records = useHomeStore((s) => s.records);
  const missing = useHomeStore((s) => s.missing);
  const status = useHomeStore((s) => s.status);
  const error = useHomeStore((s) => s.error);
  const focusId = useHomeStore((s) => s.focusId);
  const viewing = useHomeStore((s) => s.viewing);
  const hydrate = useHomeStore((s) => s.hydrate);
  const loadRecords = useHomeStore((s) => s.loadRecords);
  const loadViewing = useHomeStore((s) => s.loadViewing);
  const setPrefs = useHomeStore((s) => s.setPrefs);
  const follow = useHomeStore((s) => s.follow);
  const unfollow = useHomeStore((s) => s.unfollow);
  const toggleHidden = useHomeStore((s) => s.toggleHidden);
  const router = useRouter();

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
  const tracks = useMemo(
    () => followedTracks(allTracks, prefs.following) as Map<number, Track>,
    [allTracks, prefs.following],
  );
  const shownMissing = useMemo(
    () => missing.filter((id) => prefs.following.includes(id)),
    [missing, prefs.following],
  );
  const colors = useMemo(() => {
    const out = new Map(prefs.following.map((id, i) => [id, SAT_PALETTE[i % SAT_PALETTE.length]]));
    if (focusId != null && !out.has(focusId)) out.set(focusId, SAT_PALETTE[out.size % SAT_PALETTE.length]);
    return out;
  }, [prefs.following, focusId]);

  // Focus lives in ?focus=. The first focus replaces the URL, switching pushes,
  // clearing replaces.
  const focusOn = useCallback((id: number | null) => {
    const method = focusNavMethod(useHomeStore.getState().focusId, id) as "push" | "replace" | null;
    if (!method) return;
    useHomeStore.getState().setFocusId(id);
    router[method](focusHref(window.location.pathname, window.location.search, id) as string, { scroll: false });
  }, [router]);
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
    color: colors.get(id) ?? SAT_PALETTE[0],
    hidden: prefs.hidden.includes(id),
  })), [prefs.following, prefs.hidden, nameOf, colors]);

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

  return (
    <main className="home">
      <header className="home-top">
        <h1 className="home-wordmark">SeekSat</h1>
        <LiveClock nowMs={nowMs} compact />
      </header>
      <ClockSkewBanner />
      <Suspense fallback={null}>
        <FocusParam />
      </Suspense>
      <SearchBar onView={focusOn} />
      <FlatMap
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
      <HomeControls
        ready={hydrated}
        mode={prefs.mode}
        minElevDeg={prefs.minElevDeg}
        locationName={location && !changingLocation ? location.name : null}
        onModeChange={(mode) => setPrefs({ mode })}
        onMinElevChange={(minElevDeg) => setPrefs({ minElevDeg })}
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
          <LocationPrompt
            onDone={() => setChangingLocation(false)}
            onCancel={location ? () => setChangingLocation(false) : undefined}
          />
          {!location && <PopularList names={popularNames} />}
        </>
      ) : observer && (
        <>
          {prefs.following.length === 0 ? (
            <>
              <p className="home-note">You aren&apos;t following any satellites. Search above to add one.</p>
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
                tracks={tracks}
                colors={colors}
                observer={observer}
                mode={prefs.mode}
                minElevDeg={prefs.minElevDeg}
                nowMs={nowMs}
                onUnfollow={unfollow}
                focusId={focusId}
                onFocus={focusOn}
              />
            )
          )}
        </>
      )}

      <AboutSection />

      <footer className="home-footer">
        <span>
          built by{" "}
          <a href="https://aaronhanson.dev" target="_blank" rel="noopener">Aaron Hanson</a>
        </span>
      </footer>
    </main>
  );
}
