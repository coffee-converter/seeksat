"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePublishMapScene } from "@/lib/map/scene-store";
import { HEADER_PINNED_EVENT } from "@/components/HeaderPinned";
import FocusBar from "@/components/home/FocusBar";
import { useMapSats, type Layer, type MapTrack } from "@/components/home/useMapSats";
import DashboardTiles, { LiveNumbersFold, OrbitCheck } from "./LiveNumbers";
import ElementsTable, { AgeLine } from "./ElementsTable";
import HowWeCompute from "./HowWeCompute";
import OrbitDiagram from "./OrbitDiagram";
import Downlinks from "./Downlinks";
import ShareButton from "./ShareButton";
import { currentViewUrl, setLinkFreq } from "@/lib/share/current-view";
import { parseView } from "@/lib/share/view-link.mjs";
import PassSection, { type NextPassReport, type PassSectionHandle, type PassSettings } from "./PassSection";
import NextPassLine, { nextPassWhen } from "./NextPassLine";
import RawElements from "./RawElements";
import { useHomeStore, type SatApiRecord } from "@/lib/home/store";
import { focusDestinationFor } from "@/lib/home/focus-nav";
import { focusHref, satPageLayers } from "@/lib/home/focus.mjs";
import { clearFromList, closeTargetFor, fromList, markFromList } from "@/lib/home/list-origin.mjs";
import { tracksFor } from "@/lib/home/records.mjs";
import { followedTracks } from "@/lib/home/view.mjs";
import { followBlockedMessage } from "@/lib/home/actions.mjs";
import { resolveSatellite } from "@/lib/catalog.mjs";
import { makeTrack } from "@/lib/sat/track.mjs";
import { elementAge, liveNumbers, orbitElements, relativeTime } from "@/lib/sat/numbers.mjs";
import { SAT_PALETTES } from "@/lib/map/palette.mjs";
import { useResolvedTheme } from "@/lib/ui/use-theme";
import { useTrueNow } from "@/lib/ui/use-true-now";
import { useClouds } from "@/lib/sky/use-clouds";
import { satPath, type satPageData } from "@/lib/sat/page-data.mjs";
import { effectiveSettings, sharedBannerText, sharedSettings } from "@/lib/sat/shared-view.mjs";
import type { decodeStateBlob } from "@/lib/pass-finder/state-blob.js";
import SatChips, { type Chip } from "@/components/home/SatChips";
import { CATALOG } from "@/lib/catalog.mjs";
import Button from "@/components/ui/Button";
import SiteFooter from "@/components/home/SiteFooter";
import { cx, linkClass } from "@/lib/ui/classes.mjs";

export type SatPageData = ReturnType<typeof satPageData>;
export type SharedBlob = NonNullable<ReturnType<typeof decodeStateBlob>>;
type Shared = {
  observer: NonNullable<PassSettings["observer"]>;
  observers: PassSettings["observers"];
  mode: PassSettings["mode"];
  minElevDeg: number;
  passTimeMs: number | null;
  freqHz: number | null;
};
const sharedOf = sharedSettings as (d: SharedBlob | null | undefined) => Shared | null;
const effectiveOf = effectiveSettings as (prefs: unknown, shared: Shared | null) => PassSettings;
const bannerOf = sharedBannerText as (s: Shared) => string;

const pageLayersOf = satPageLayers as (o: {
  followed: number[]; hidden: number[]; pageId: number;
}) => Layer[];
type HomeTrack = MapTrack & { record?: { source?: string } };
const buildTracks = tracksFor as (records: Map<number, SatApiRecord>, custom: unknown[], bands: string[] | null) => Map<number, HomeTrack>;

export default function SatApp({ data, shared: sharedIn = null }: { data: SatPageData; shared?: SharedBlob | null }) {
  const router = useRouter();
  const prefs = useHomeStore((s) => s.prefs);
  const hydrated = useHomeStore((s) => s.hydrated);
  const hydrate = useHomeStore((s) => s.hydrate);
  const follow = useHomeStore((s) => s.follow);
  const unfollow = useHomeStore((s) => s.unfollow);
  const setPrefs = useHomeStore((s) => s.setPrefs);
  const toggleHidden = useHomeStore((s) => s.toggleHidden);
  const records = useHomeStore((s) => s.records);
  const loadRecords = useHomeStore((s) => s.loadRecords);

  // A shared view lives here only, laid over the prefs and never saved.
  // It comes from the server-decoded prop, so the first render matches.
  const [shared, setShared] = useState<Shared | null>(() => sharedOf(sharedIn));
  const settings = useMemo(() => effectiveOf(prefs, shared), [prefs, shared]);
  // Cloud forecasts for visual passes; radio mode never fetches them.
  const clouds = useClouds(settings.observer, settings.mode === "visual");
  // The radio chart's picked frequency (a shared view's, until one is picked).
  const pickedFreq = useRef<number | null>(sharedIn ? shared?.freqHz ?? null : null);
  // A shared link's radio frequency (?f=), read before the shell clears it.
  const [linkFreq, setLinkFreqState] = useState<number | null>(null);
  useEffect(() => {
    const hz = (parseView(window.location.search) as { freqHz: number | null } | null)?.freqHz ?? null;
    if (hz != null) {
      pickedFreq.current = hz;
      setLinkFreqState(hz);
    }
    setLinkFreq(pickedFreq.current);
    return () => setLinkFreq(null);
  }, []);
  // The view on screen, with no location (lib/share/current-view.ts).
  const headerLink = () => currentViewUrl();
  const onModeChange = useCallback((mode: PassSettings["mode"]) => {
    if (shared) setShared((s) => (s ? { ...s, mode } : s));
    else setPrefs({ mode });
  }, [shared, setPrefs]);
  const onMinElevChange = useCallback((minElevDeg: number) => {
    if (shared) setShared((s) => (s ? { ...s, minElevDeg } : s));
    else setPrefs({ minElevDeg });
  }, [shared, setPrefs]);
  // The sky type is personal: a shared view never carries or changes it.
  const onSkyTypeChange = useCallback((skyType: string) => setPrefs({ skyType }), [setPrefs]);
  const leaveShared = () => {
    setShared(null);
    // Through the router, so its tree and usePathname move off the share URL
    // too. Share pages are never marked from the list, so no origin is lost.
    router.replace(satPath(data.noradId) as string);
  };

  // First render matches the server HTML; the clock starts after mount.
  const nowMs = useTrueNow(1000, data.renderedAtMs) ?? data.renderedAtMs;

  // The followed satellites' records, so the others can ghost on the map.
  useEffect(() => {
    hydrate();
    void loadRecords();
  }, [hydrate, loadRecords]);

  const track = useMemo(() => {
    try {
      return (makeTrack as (r: unknown, e: unknown, o: { bands: string[] | null }) => unknown)(
        data.record, resolveSatellite(data.noradId), { bands: prefs.bands },
      );
    } catch {
      return null;
    }
  }, [data.record, data.noradId, prefs.bands]);

  const liveNow = useMemo(() => {
    if (!track) return null;
    try { return liveNumbers(track, new Date(nowMs)); } catch { return null; }
  }, [track, nowMs]);
  const elementsNow = useMemo(() => {
    if (!track) return null;
    try { return orbitElements(track); } catch { return null; }
  }, [track]);
  const usable = Boolean(track && liveNow && elementsNow && data.live);

  // Age from the live clock, so it never contradicts "fetched X ago". The
  // first nowMs is renderedAtMs, so the first render matches the server's.
  // data.elementEpochMs is data.epochMs, falling back to the track's epoch.
  const epochMs = data.elementEpochMs;
  const age = useMemo(() => elementAge(epochMs, nowMs), [epochMs, nowMs]);

  // The map is always focused on this satellite; the other followed ones ghost.
  const focusId = data.noradId;
  // The list hands its origin over through the module flag; this page's own
  // history entry then carries it, so Back and Forward keep it.
  // A later Next replace with preserveCustomHistoryState false (router.refresh, server actions) would drop seeksatFromList.
  useEffect(() => {
    if (!fromList()) return;
    window.history.replaceState({ ...window.history.state, seeksatFromList: true }, "", window.location.href);
    clearFromList();
  }, [data.noradId]);
  // Close: back to the list when this entry came from it, else home.
  const onClose = useCallback(() => {
    if (closeTargetFor(window.history.state) === "back") router.back();
    else router.push("/");
  }, [router]);
  // Another satellite from the map, a chip or search: a catalog one replaces
  // this page, so the list stays one step back; a pasted one has no page and
  // opens on home.
  const openOther = useCallback((id: number | null) => {
    if (id == null || id === data.noradId) return;
    const dest = focusDestinationFor(id);
    if (dest) {
      // The hop replaces this entry, so the new page re-marks its own.
      if (closeTargetFor(window.history.state) === "back") markFromList();
      router.replace(dest);
    } else router.push(focusHref("/", "", id) as string);
  }, [data.noradId, router]);
  // Tapping this page's own chip or dot, or hiding it, closes the details (hidden,
  // it is off the list's map). The second tap of a double tap that opened
  // this page lands here; ignore it.
  const openedAt = useRef(0);
  useEffect(() => {
    openedAt.current = Date.now();
  }, [data.noradId]);
  // Opening a satellite shows it again: selected means on the map. Once per
  // page, after the saved prefs load, so the eye still hides it here.
  useEffect(() => {
    if (!hydrated) return;
    const st = useHomeStore.getState();
    if (st.prefs.hidden.includes(data.noradId)) st.toggleHidden(data.noradId);
  }, [hydrated, data.noradId]);
  const selectOrClose = useCallback((id: number | null) => {
    if (id != null) openOther(id);
    else if (Date.now() - openedAt.current >= 600) onClose();
  }, [openOther, onClose]);
  const onChipHide = useCallback((id: number) => {
    const hiding = !useHomeStore.getState().prefs.hidden.includes(id);
    toggleHidden(id);
    if (id === data.noradId && hiding) onClose();
  }, [toggleHidden, data.noradId, onClose]);
  // Old Show all links carried ?map=all; drop it from the URL. (A shared
  // view's map=globe|flat is the shell's to read.)
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("map") !== "all") return;
    url.searchParams.delete("map");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const mapTracks = useMemo(() => {
    const out = new Map<number, HomeTrack>(
      followedTracks(buildTracks(records, prefs.custom, prefs.bands), prefs.following) as Map<number, HomeTrack>,
    );
    if (track && usable) out.set(data.noradId, track as HomeTrack);
    return out;
  }, [records, prefs.custom, prefs.following, prefs.bands, track, usable, data.noradId]);
  const theme = useResolvedTheme();
  const colors = useMemo(() => {
    const pal: string[] = SAT_PALETTES[theme];
    const out = new Map(prefs.following.map((id, i) => [id, pal[i % pal.length]]));
    // Not followed: the next colour, as a viewing satellite gets on the home page.
    if (!out.has(data.noradId)) out.set(data.noradId, pal[out.size % pal.length]);
    return out;
  }, [prefs.following, data.noradId, theme]);
  const layers = useMemo(() => pageLayersOf({
    followed: prefs.following, hidden: prefs.hidden, pageId: data.noradId,
  }), [prefs.following, prefs.hidden, data.noradId]);
  const { sats } = useMapSats({
    layers, tracks: mapTracks, colors, nowMs, minElevDeg: settings.minElevDeg, radio: settings.mode === "radio",
  });
  // One chip per followed satellite, as on the home page: tap to focus,
  // the eye to hide or show.
  const chips = useMemo<Chip[]>(() => prefs.following.map((id) => ({
    noradId: id,
    name: mapTracks.get(id)?.shortName ?? CATALOG.find((c) => c.noradId === id)?.shortName ?? `NORAD ${id}`,
    color: colors.get(id) ?? SAT_PALETTES[theme][0],
    hidden: prefs.hidden.includes(id),
    radio: settings.mode === "radio" && (mapTracks.get(id)?.downlinks.length ?? 0) > 0,
  })), [prefs.following, prefs.hidden, mapTracks, colors, theme, settings.mode]);

  const [nextPass, setNextPass] = useState<NextPassReport>(undefined);
  const passes = useRef<PassSectionHandle>(null);
  const fetchedText = data.fetchedAtMs != null ? `fetched ${relativeTime(data.fetchedAtMs, nowMs)}` : null;

  const following = prefs.following.includes(data.noradId);
  const blocked = followBlockedMessage(prefs.following, data.noradId) as string | null;
  const toggleFollow = () => (following ? unfollow(data.noradId) : follow(data.noradId));

  usePublishMapScene({
    sats,
    observer: settings.observer,
    projectionId: prefs.projection,
    onProjectionChange: (id) => setPrefs({ projection: id }),
    selectedId: focusId,
    minElevDeg: settings.minElevDeg,
    onSelect: selectOrClose,
    chips: hydrated && (
      <SatChips chips={chips} focusId={focusId} onFocus={selectOrClose} onToggleHidden={onChipHide} />
    ),
    top: usable && (
      <FocusBar
        name={data.shortName}
        followed={following}
        blocked={blocked}
        mode="page"
        onToggleFollow={toggleFollow}
        onClose={onClose}
      />
    ),
    // A search result opens that satellite's page; Esc in an empty search closes.
    search: { onView: openOther, onClearFocus: onClose },
  });

  // The title bar shows once the title block has scrolled out of view. It sits
  // at the bar's own `top`, so the observer's top margin is read from the CSS.
  const barRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLElement>(null);
  const [barOn, setBarOn] = useState(false);
  useEffect(() => {
    const top = topRef.current;
    const bar = barRef.current;
    if (!top || !bar || typeof IntersectionObserver === "undefined") return;
    let io: IntersectionObserver | null = null;
    const watch = () => {
      io?.disconnect();
      const pinned = Math.max(0, parseFloat(getComputedStyle(bar).top) || 0);
      io = new IntersectionObserver(
        ([entry]) => setBarOn(!entry.isIntersecting),
        { rootMargin: `-${pinned}px 0px 0px 0px` },
      );
      io.observe(top);
    };
    watch();
    window.addEventListener("resize", watch);
    window.addEventListener(HEADER_PINNED_EVENT, watch);
    return () => {
      io?.disconnect();
      window.removeEventListener("resize", watch);
      window.removeEventListener(HEADER_PINNED_EVENT, watch);
    };
  }, []);
  // While the bar shows, anchor and focus scrolls stop below it. Which
  // scroller that is (the panel when docked, else the window) is read again on
  // every resize, so crossing 1100 px moves the padding to the right one.
  useEffect(() => {
    if (!barOn) return;
    const bar = barRef.current;
    const inner = bar?.firstElementChild as HTMLElement | null;
    if (!bar || !inner) return;
    let applied: HTMLElement | null = null;
    const set = () => {
      const docked = window.matchMedia("(min-width: 1100px)").matches;
      const el = docked ? document.querySelector<HTMLElement>(".map-shell__panel") : document.documentElement;
      if (applied && applied !== el) applied.style.scrollPaddingTop = "";
      applied = el;
      if (!el) return;
      const pinned = docked ? 0 : Math.max(0, parseFloat(getComputedStyle(bar).top) || 0);
      el.style.scrollPaddingTop = `${pinned + inner.offsetHeight}px`;
    };
    set();
    window.addEventListener("resize", set);
    window.addEventListener(HEADER_PINNED_EVENT, set);
    return () => {
      window.removeEventListener("resize", set);
      window.removeEventListener(HEADER_PINNED_EVENT, set);
      if (applied) applied.style.scrollPaddingTop = "";
    };
  }, [barOn]);
  const barWhen = nextPassWhen(nextPass, nowMs);

  return (
    <>
      <div className={`sat-bar${barOn ? " sat-bar--on" : ""}`} ref={barRef}>
        <div className="sat-bar__in">
          <Button size="sm" iconOnly className="sat-bar__close" aria-label="Close details" onClick={onClose}>
            <span className="sat-bar__x" aria-hidden="true">{"\u00d7"}</span>
          </Button>
          <span className="sat-bar__name">{data.shortName}</span>
          {barWhen ? <span className="sat-bar__when">{barWhen}</span> : null}
        </div>
      </div>
      <header className="sat-top" ref={topRef}>
        {/* Back to the list, as Close does; a modified click still opens a tab. */}
        <Link
          className={cx(linkClass(), "sat-back")}
          href="/"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            onClose();
          }}
        >
          {"← Your satellites"}
        </Link>
        <h1 className="sat-title">{data.name}</h1>
        <p className="home-note">
          {`NORAD ${data.noradId}`}
          {data.intlDesignator ? ` · ${data.intlDesignator}` : ""}
        </p>
        {data.note ? <p className="home-note">{data.note}</p> : null}
        <div className="sat-follow">
          <Button
            variant="primary"
            on={following}
            pressedLook="accent"
            disabled={!following && Boolean(blocked)}
            onClick={toggleFollow}
          >
            {following ? "Following" : "Follow"}
          </Button>
          {settings.observer && (
            <ShareButton url={headerLink} title={data.name} size="button" />
          )}
        </div>
        {!following && blocked ? <p className="home-note">{blocked}</p> : null}
        <NextPassLine
          report={nextPass}
          nowMs={nowMs}
          mode={settings.mode}
          skyType={prefs.skyType}
          clouds={clouds}
          onChart={(kind, pass, e) => passes.current?.openChart(kind, pass, e)}
        />
      </header>

      {shared ? (
        <div className="sat-shared" role="status">
          <p className="sat-shared__text">{bannerOf(shared)}</p>
          <Button onClick={leaveShared}>
            Use my location and settings
          </Button>
        </div>
      ) : null}

      {usable && liveNow && elementsNow ? (
        <LiveNumbersFold>
          <DashboardTiles live={liveNow} elements={elementsNow} />
        </LiveNumbersFold>
      ) : (
        <>
          <AgeLine age={age} source={data.source} fetchedText={fetchedText} accuracyLink={false} />
          <p className="home-note">These elements can&apos;t be used to compute a position.</p>
        </>
      )}

      <PassSection
        ref={passes}
        track={usable ? track : null}
        record={data.record}
        epochMs={epochMs}
        nowMs={nowMs}
        settings={settings}
        onModeChange={onModeChange}
        onMinElevChange={onMinElevChange}
        skyType={prefs.skyType}
        onSkyTypeChange={onSkyTypeChange}
        sharedPassMs={shared?.passTimeMs ?? null}
        preferredFreqHz={shared?.freqHz ?? linkFreq}
        onFreqPicked={(hz) => { pickedFreq.current = hz; setLinkFreq(hz); }}
        onNextPass={setNextPass}
        clouds={clouds}
      />

      {usable && liveNow && elementsNow ? (
        <>
          <ElementsTable
            elements={elementsNow}
            age={age}
            source={data.source}
            fetchedText={fetchedText}
            epochMs={epochMs}
          />
          <OrbitDiagram track={track} nowMs={nowMs} />
          <OrbitCheck live={liveNow} />
        </>
      ) : null}

      <Downlinks downlinks={data.downlinks} />
      <RawElements raw={data.raw} />
      {usable ? <HowWeCompute /> : null}
      <SiteFooter />
    </>
  );
}
