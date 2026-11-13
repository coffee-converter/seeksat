"use client";

import PassSkeleton from "./PassSkeleton";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import FocusBar from "./FocusBar";
import { useMapSats, type Layer } from "./useMapSats";
import LocationPrompt, { PopularList } from "./LocationPrompt";
import { usePassCharts, type Card, type HomeObserver, type Pass, type Track } from "./NextUpList";
import PassList from "./PassList";
import FollowingSheet from "./FollowingSheet";
import Timeline from "./Timeline";
import { useHomeStore, watchVisibility, type SatApiRecord } from "@/lib/home/store";
import { tracksFor } from "@/lib/home/records.mjs";
import { satName } from "@/lib/home/names.mjs";
import { getPassRunner } from "@/lib/passes/pass-client.mjs";
import { cardJobKey } from "@/lib/passes/job-key.mjs";
import { POPULAR_IDS } from "@/lib/home/prefs.mjs";
import { savedAgeNotice, shouldRefreshCards } from "@/lib/home/view.mjs";
import { focusHref, focusNavMethod, mapLayers, parseFocus, showAllCount } from "@/lib/home/focus.mjs";
import { clearFromList, markFromList } from "@/lib/home/list-origin.mjs";
import { followBlockedMessage } from "@/lib/home/actions.mjs";
import { SAT_PALETTES } from "@/lib/map/palette.mjs";
import { useResolvedTheme } from "@/lib/ui/use-theme";
import { CATALOG } from "@/lib/catalog.mjs";
import { trueNow } from "@/lib/pass-finder/clock-sync.js";
import { focusDestinationFor } from "@/lib/home/focus-nav";
import { useTrueNow } from "@/lib/ui/use-true-now";
import { useClouds } from "@/lib/sky/use-clouds";
import { passCloud } from "@/components/passes/CloudBadge";
import AboutSection from "./AboutSection";
import InstallNote from "./InstallNote";
import SiteFooter from "./SiteFooter";
import { usePublishMapScene } from "@/lib/map/scene-store";
import { useLiveDock } from "@/lib/live/dock-store";
import ClockSkewBanner from "@/components/passes/ClockSkewBanner";
import Button from "@/components/ui/Button";
import { FIRST_VISIT_ATTR } from "@/lib/home/first-visit.mjs";
import { useMapPause, type OpenPassRow } from "@/lib/map/use-map-pause";
import { usePlaceZone, viewerZone } from "@/components/usePlaceZone";
import { zoneNote } from "@/lib/time/zone.mjs";

const CARD_REFRESH_MS = 10 * 60_000;

const buildTracks = tracksFor as (records: Map<number, SatApiRecord>, custom: unknown[], bands: string[] | null) => Map<number, Track>;
const layersOf = mapLayers as (o: {
  followed: number[]; hidden: number[]; focusId: number | null; viewing: number | null; highlightId?: number | null;
}) => Layer[];
const countOf = showAllCount as (layers: Layer[]) => number;

/** Reads ?focus= into the store. Alone inside Suspense, so / stays static.
 *  It reads the live URL when the param changes, so a stale render left
 *  behind by two quick focus changes never flips the store back. An old
 *  link to a catalog satellite is replaced with its page, once the prefs
 *  have loaded and say whether the id is a pasted one. */
function FocusParam({ onSynced }: { onSynced: () => void }) {
  const router = useRouter();
  const raw = useSearchParams().get("focus");
  const hydrated = useHomeStore((s) => s.hydrated);
  const setFocusId = useHomeStore((s) => s.setFocusId);
  useEffect(() => {
    const id = parseFocus(new URLSearchParams(window.location.search).get("focus")) as number | null;
    if (id != null) {
      if (!hydrated) return;
      const dest = focusDestinationFor(id);
      if (dest) {
        router.replace(dest);
        return;
      }
    }
    setFocusId(id);
    onSynced();
  }, [raw, hydrated, router, setFocusId, onSynced]);
  return null;
}

/** Marks a history entry our focus pushed, so clearing can step back over it. */
const PUSHED_KEY = "seeksatFocusPushed";
const pushedHere = () => (window.history.state as Record<string, unknown> | null)?.[PUSHED_KEY] === true;

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
  const fromCache = useHomeStore((s) => s.fromCache);
  const generatedAtMs = useHomeStore((s) => s.generatedAtMs);
  const hydrate = useHomeStore((s) => s.hydrate);
  // The scene waits until ?focus= is in the store, so a remount never
  // publishes the store's stale focus for one commit.
  const [focusSynced, setFocusSynced] = useState(false);
  const onFocusSynced = useCallback(() => setFocusSynced(true), []);
  const loadRecords = useHomeStore((s) => s.loadRecords);
  const loadViewing = useHomeStore((s) => s.loadViewing);
  const setPrefs = useHomeStore((s) => s.setPrefs);
  const follow = useHomeStore((s) => s.follow);
  const unfollow = useHomeStore((s) => s.unfollow);

  useEffect(() => {
    hydrate();
    void loadRecords();
  }, [hydrate, loadRecords]);
  // Back on the list, so a satellite page opened later starts fresh.
  useEffect(() => clearFromList(), []);
  useEffect(() => watchVisibility(), []);
  // The one-second clock that drives the map and cards, on server time once a
  // response has measured the skew (as the banner promises).
  const nowMs = useTrueNow();
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
    return buildTracks(all, prefs.custom, prefs.bands);
  }, [shownRecords, viewing, prefs.custom, prefs.bands]);
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

  // Focusing a catalog satellite opens its page, noting that it came from the
  // list so Close can step back here.
  // A pasted satellite has no page, so its focus lives in ?focus=, changed
  // through the History API (Next keeps useSearchParams in step, with no
  // server round trip). Entering a focus pushes, switching replaces, and
  // clearing steps back over the entry we pushed (else replaces), so Back
  // always leaves focus.
  const router = useRouter();
  // True when it opened a satellite page, so callers skip scrolling home's list.
  const lastNav = useRef<{ dest: string; at: number } | null>(null);
  const focusOn = useCallback((id: number | null): boolean => {
    const dest = id != null ? focusDestinationFor(id) : null;
    if (dest) {
      // A double tap would push the same page twice: ignore the second.
      const at = Date.now();
      if (lastNav.current?.dest === dest && at - lastNav.current.at < 600) return true;
      lastNav.current = { dest, at };
      markFromList();
      router.push(dest);
      return true;
    }
    const pushed = pushedHere();
    const method = focusNavMethod(useHomeStore.getState().focusId, id, pushed) as "push" | "replace" | "back" | null;
    if (!method) return false;
    useHomeStore.getState().setFocusId(id);
    if (method === "back") {
      window.history.back();
      return false;
    }
    const href = focusHref(window.location.pathname, window.location.search, id) as string;
    // A fresh object (no Next internals): Next copies its own state across.
    if (method === "push") window.history.pushState({ [PUSHED_KEY]: true }, "", href);
    else window.history.replaceState({ [PUSHED_KEY]: id != null && pushed }, "", href);
    return false;
  }, [router]);
  // Unfollowing the focused pasted satellite removes its elements: there is
  // nothing left to show, and its number may be a different catalog object,
  // so leave focus rather than look it up.
  const pastedIds = useRef<number[]>(prefs.custom.map((c) => c.noradId));
  useEffect(() => {
    const before = pastedIds.current;
    pastedIds.current = prefs.custom.map((c) => c.noradId);
    const id = useHomeStore.getState().focusId;
    if (id != null && before.includes(id) && !pastedIds.current.includes(id)) focusOn(null);
  }, [prefs.custom, focusOn]);
  // Hiding the focused satellite (from the Following sheet) also leaves focus, as on
  // a satellite page, so the tap shows. A focus on an already hidden one stays.
  // Loading the saved prefs is not a change.
  const hiddenIds = useRef<number[] | null>(hydrated ? prefs.hidden : null);
  useEffect(() => {
    if (!hydrated) return;
    const before = hiddenIds.current;
    hiddenIds.current = prefs.hidden;
    const id = useHomeStore.getState().focusId;
    if (before && id != null && prefs.hidden.includes(id) && !before.includes(id)) focusOn(null);
  }, [hydrated, prefs.hidden, focusOn]);
  // A focus that is not followed (from search, or a shared link) needs its record.
  useEffect(() => {
    // The store, not this render, says whether the focus still holds: the
    // effect above may have just left it.
    if (hydrated && focusId != null && useHomeStore.getState().focusId === focusId
      && !prefs.following.includes(focusId)) void loadViewing(focusId);
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

  // The satellite of the open pass row stands out on the map, without the
  // camera moving to it (so it is not the scene's selectedId).
  const [openRow, setOpenRow] = useState<OpenPassRow | null>(null);
  const highlightId = openRow?.noradId ?? null;
  // A live view docked in the panel selects its satellite on the map while
  // it is open; closing it goes back to the focus (or none).
  const liveId = useLiveDock((s) => s.noradId);
  const mapFocusId = liveId ?? focusId;
  const layers = useMemo(() => layersOf({
    followed: prefs.following,
    hidden: prefs.hidden,
    focusId: mapFocusId,
    viewing: (viewing?.noradId as number | undefined) ?? null,
    highlightId,
  }), [prefs.following, prefs.hidden, mapFocusId, viewing, highlightId]);
  const showAll = useMemo(
    () => countOf(layersOf({ followed: prefs.following, hidden: prefs.hidden, focusId: null, viewing: null })),
    [prefs.following, prefs.hidden],
  );
  const nameOf = useCallback(
    (id: number) => satName(id, { records: allTracks as Map<number, { name?: string }>, custom: prefs.custom }),
    [allTracks, prefs.custom],
  );

  const location = prefs.location;
  // The pre-paint first-visit mark (lib/home/first-visit.mjs) holds the map
  // at the height home-first-visit gives it. It goes once there is a location,
  // or when the page is left; until then the two agree, so nothing resizes.
  useEffect(() => {
    if (hydrated && location) delete document.documentElement.dataset[FIRST_VISIT_ATTR];
  }, [hydrated, location]);
  useEffect(() => () => { delete document.documentElement.dataset[FIRST_VISIT_ATTR]; }, []);
  // Times read as the clock at the place, not the viewer's.
  const tz = usePlaceZone(location?.latDeg, location?.lonDeg);
  const observer = useMemo<HomeObserver | null>(
    () => location && {
      id: "home",
      name: location.name || "Your location",
      latDeg: location.latDeg,
      lonDeg: location.lonDeg,
      tz,
      // The ground's height there, once looked up (MapLayoutShell).
      elevM: location.elevM ?? 0,
      elevSource: location.elevM != null ? "lookup" : "default",
    },
    [location, tz],
  );

  // An opened pass pauses the map at its peak (not while a live view is docked).
  const { mapNowMs, mapPass } = useMapPause(openRow, {
    nowMs, timeZone: tz, live: liveId != null,
    track: openRow ? allTracks.get(openRow.noradId) : null, observer: location, minElevDeg: prefs.minElevDeg,
  });
  const { sats } = useMapSats({
    layers, tracks: allTracks, colors, nowMs: mapNowMs, minElevDeg: prefs.minElevDeg, radio: prefs.mode === "radio", pass: mapPass,
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

  // Once the list has run empty, the popular picks stay for the rest of the
  // visit, so following one does not take the others away.
  const [keepPopular, setKeepPopular] = useState(false);
  const [followingOpen, setFollowingOpen] = useState(false);
  if (hydrated && location && prefs.following.length === 0 && !keepPopular) setKeepPopular(true);

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

  // The cards, only while they were computed for the current inputs. A
  // mode or lowest-pass change keeps the last cards up until the new ones
  // land (a moment), so the Best line and rows do not blink out and back.
  const restKey = useMemo(
    () => cardJobKey({ following: prefs.following, custom: prefs.custom, observer, mode: "visual", minElevDeg: 0 }),
    [prefs.following, prefs.custom, observer],
  );
  const restKeyOf = useRef(new Map<string, string>());
  restKeyOf.current.set(cardKey, restKey);
  const sameRest = cardState != null && restKeyOf.current.get(cardState.key) === restKey;
  const shownCards = cardState && (cardState.key === cardKey || sameRest) ? cardState.cards : null;
  const following = prefs.following.length > 0;
  // While cards load the list keeps its heading (and the mode switch just
  // pressed), with a note in place of the rows.
  const listNote = !following ? null
    : !cardState || (cardState.cards.length === 0 && status === "loading") ? "Loading satellites..."
      : !shownCards ? "Finding passes..." : null;
  const showList = following || viewingCard != null;
  // Settings > About from another page lands here as /#about. It waits for
  // the list, whose rows would otherwise push it back out of view as they land.
  const aboutPending = useRef(true);
  const listSettled = hydrated && (!location || listNote == null || status === "error");
  useEffect(() => {
    if (!aboutPending.current || !listSettled) return;
    aboutPending.current = false;
    if (window.location.hash !== "#about") return;
    const about = document.getElementById("about") as HTMLDetailsElement | null;
    if (!about) return;
    about.open = true;
    // After the rows have drawn.
    requestAnimationFrame(() => about.scrollIntoView({ block: "start" }));
  }, [listSettled]);
  // An open row's highlight goes with the list (it reports only while shown).
  if (!showList && openRow != null) setOpenRow(null);

  // One set of chart modals for the pass list and the 24 hour strip.
  const { open: openChart, modals: chartModals } = usePassCharts(observer, prefs.minElevDeg, prefs.mode);
  // A timeline bar opens that pass's card (the map pauses on it), as the
  // Best line does; the card has the charts.
  const [openRequest, setOpenRequest] = useState<{ noradId: number; pass: Pass; n: number } | null>(null);
  const openTimelinePass = useCallback((noradId: number, pass: Pass) => {
    setOpenRequest((r) => ({ noradId, pass, n: (r?.n ?? 0) + 1 }));
  }, []);

  // Cloud forecasts for visual passes; radio mode never fetches them.
  const clouds = useClouds(location, prefs.mode === "visual");
  const cloudFor = useCallback(
    (pass: Pass) => (nowMs == null ? null : passCloud(clouds, pass, nowMs)),
    [clouds, nowMs],
  );

  usePublishMapScene({
    above: locationFirst && <LocationPrompt />,
    sats,
    observer: location,
    projectionId: prefs.projection,
    onProjectionChange: (id) => setPrefs({ projection: id }),
    selectedId: mapFocusId,
    minElevDeg: prefs.minElevDeg,
    onSelect: focusOn,
    top: focusId != null && (
      <FocusBar
        name={nameOf(focusId)}
        followed={prefs.following.includes(focusId)}
        blocked={followBlockedMessage(prefs.following, focusId) as string | null}
        total={showAll}
        onToggleFollow={() => (prefs.following.includes(focusId) ? unfollow(focusId) : follow(focusId))}
        onShowAll={() => focusOn(null)}
      />
    ),
    search: { onView: focusOn, onClearFocus: () => focusOn(null) },
    notice: savedAge && <p className="saved-age">{savedAge}</p>,
    offlineFromCache: fromCache,
    shellClass: hydrated && !location ? "home-first-visit" : undefined,
  }, focusSynced);

  const firstVisit = hydrated && !location;

  return (
    <>
      <Suspense fallback={null}>
        <FocusParam onSynced={onFocusSynced} />
      </Suspense>
      <ClockSkewBanner />

      {status === "error" && (
        <div className="home-banner" role="alert">
          <span>{error ?? "Something went wrong loading satellites."}</span>
          <Button onClick={() => void loadRecords()}>
            Try again
          </Button>
        </div>
      )}

      {!hydrated ? null : firstVisit ? (
        <>
          {!locationFirst && <LocationPrompt />}
          <PopularList names={popularNames} />
        </>
      ) : observer && (
        <>
          {!following && (
            <p className="note">You aren&apos;t following any satellites. Search to add one.</p>
          )}
          {showList && nowMs != null && (
            <PassList
              cards={shownCards ?? []}
              viewingCard={viewingCard}
              tracks={allTracks}
              colors={colors}
              observer={observer}
              mode={prefs.mode}
              minElevDeg={prefs.minElevDeg}
              nowMs={nowMs}
              onModeChange={(mode) => setPrefs({ mode })}
              zoneNote={zoneNote(tz, viewerZone(), nowMs) as string | null}
              headAction={(
                <Button size="sm" variant="quiet" className="pass-list__following" aria-haspopup="dialog" onClick={() => setFollowingOpen(true)}>
                  {`Following · ${prefs.following.length}`}
                </Button>
              )}
              strip={following && shownCards && (
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
              onUnfollow={unfollow}
              onFollow={follow}
              followBlocked={viewingId == null ? null : followBlockedMessage(prefs.following, viewingId) as string | null}
              openChart={openChart}
              clouds={clouds}
              skyType={prefs.skyType}
              onOpenRow={setOpenRow}
              openRequest={openRequest}
            />
          )}
          <InstallNote show={showList && nowMs != null} />
          {listNote && <PassSkeleton label={listNote} />}
          {(!following || keepPopular) && <PopularList names={popularNames} />}
        </>
      )}

      {chartModals}
      <FollowingSheet open={followingOpen} onClose={() => setFollowingOpen(false)} colors={colors} />

      <AboutSection />
      <SiteFooter />
    </>
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
