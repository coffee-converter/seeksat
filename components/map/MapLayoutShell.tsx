"use client";

// The one MapShell for / and /sat/<id>. It stays mounted across navigation, so
// the MapLibre map persists; each page publishes its scene to the store.

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import "@/app/home.css";
import "@/app/sat.css";
import FlatMap from "@/components/home/FlatMap";
import MapShell from "@/components/MapShell";
import { shellClassFor } from "@/lib/map/shell-route.mjs";
import { useMapScene } from "@/lib/map/scene-store";
import { useHomeStore, watchPrefs } from "@/lib/home/store";
import { useLock } from "@/lib/map/lock-store";
import { useMapClock } from "@/lib/map/map-clock";
import { reverseGeocodeName } from "@/lib/pass-finder/geocode.js";
import { usePassViewStore } from "@/lib/ui/pass-view";
import { setPendingCamera } from "@/lib/map/share-camera";
import { LIVE_DOCK_HOST_ID, useLiveDock } from "@/lib/live/dock-store";
import { dockFollowStep } from "@/lib/live/dock-follow.mjs";
import { parseView, stripView } from "@/lib/share/view-link.mjs";
import { currentViewUrl } from "@/lib/share/current-view";
import ShareButton from "@/components/sat/ShareButton";
import Button from "@/components/ui/Button";
import SiteHeader from "./SiteHeader";

/** Two decimals, about 1 km: where a lookup asks about, not the exact spot. */
const roundKm = (deg: number) => Math.round(deg * 100) / 100;

type ParsedView = {
  projection: string; lock: boolean; zoom: number | null; center: [number, number] | null;
  following: number[] | null; hidden: number[]; mode: "radio" | "visual" | null; freqHz: number | null;
};
const parseViewOf = parseView as (search: string) => ParsedView | null;

/** While a shared view is shown: keep it, or go back. Docked it heads the
 *  panel; narrower it sits above the map, where it is seen (app/sat.css). */
function SharedViewBanner({ at }: { at: "map" | "panel" }) {
  const shared = useHomeStore((s) => s.shared);
  const keep = useHomeStore((s) => s.keepShared);
  const leave = useHomeStore((s) => s.leaveShared);
  if (!shared) return null;
  const n = shared.following?.length ?? 0;
  return (
    <div className={`sat-shared shared-view shared-view--${at}`} role="status">
      <p className="sat-shared__text">
        {`You're looking at a shared map${shared.following ? ` with ${n} satellite${n === 1 ? "" : "s"}` : ""}. Your own list is unchanged.`}
      </p>
      <div className="shared-view__actions">
        <Button onClick={keep}>Keep this view</Button>
        <Button variant="quiet" onClick={leave}>Back to mine</Button>
      </div>
    </div>
  );
}

const noop = () => {};

type DockFollow = { id: number; prev: boolean; on: boolean } | null;
const followStep = dockFollowStep as (state: DockFollow, now: {
  dockId: number | null; shownId: number | null; publishedId: number | null; following: boolean;
}) => { state: DockFollow; follow: boolean | null };

export default function MapLayoutShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const scene = useMapScene((s) => s.scene);
  const projection = useHomeStore((s) => s.prefs.projection);
  const setPrefs = useHomeStore((s) => s.setPrefs);

  // Settings changed in another tab apply here too, so this tab never saves
  // over them with its older copy.
  useEffect(() => watchPrefs(), []);

  // Lock on carries over a hop between satellites (the map eases over to the
  // new one); it ends where nothing is selected (the map's own rule).

  // A shared link's view (lib/share/view-link.mjs): laid over the prefs until
  // kept, its camera handed to the map. The parameters then leave the address
  // bar, so a reload or a copied address is the visitor's own view again.
  useEffect(() => {
    const v = parseViewOf(window.location.search);
    if (!v) return;
    useHomeStore.getState().applyShared({
      projection: v.projection,
      ...(v.following ? { following: v.following, hidden: v.hidden } : {}),
      ...(v.mode ? { mode: v.mode } : {}),
    });
    if (v.zoom != null || v.lock) {
      setPendingCamera({ view: v.projection, zoom: v.zoom, center: v.center, lock: v.lock, at: Date.now() });
    }
    const { pathname: path, search, hash } = window.location;
    window.history.replaceState(window.history.state, "", path + stripView(search) + hash);
    // Once, on the page the link opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The live view docked in the panel locks the camera on its satellite
  // once the map shows it selected, and closing puts Lock on back as it was
  // once the map is back on the page's own selection (lib/live/dock-follow).
  // An effect here runs after FlatMap's, which turns Lock on off on a new
  // selection.
  const dockId = useLiveDock((s) => s.noradId);
  const shownId = scene?.selectedId ?? null;
  const dockFollow = useRef<DockFollow>(null);
  useEffect(() => {
    const { locked: following, setLocked } = useLock.getState();
    const publishedId = useMapScene.getState().scene?.selectedId ?? null;
    const step = followStep(dockFollow.current, { dockId, shownId, publishedId, following });
    dockFollow.current = step.state;
    if (step.follow != null) setLocked(step.follow);
    // Locking on for the live view also zooms so its footprint fills the map.
    if (step.follow === true && dockId != null) useLock.getState().fitFootprint();
  }, [dockId, shownId]);

  // A new page starts at the top of the panel, but the first render does not.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.querySelector(".map-shell__panel")?.scrollTo(0, 0);
  }, [pathname]);

  // A location typed as coordinates or a grid square is named after the
  // numbers; it is looked up once and given a place name ("Mendoza,
  // Argentina"; a grid square keeps its locator in front). No name found
  // (offline, open ocean): it keeps the numbers.
  const loc = useHomeStore((s) => s.prefs.location);
  // Keyed on the values, not the object: every settings save makes a new one.
  const locLat = loc?.latDeg;
  const locLon = loc?.lonDeg;
  const locName = loc?.name;
  const locSource = loc?.source;
  const locElev = loc?.elevM;
  useEffect(() => {
    if (locLat == null || locLon == null || locName == null || (locSource !== "coords" && locSource !== "grid")) return;
    const numbersOnly = locSource === "coords" ? /^-?\d+(\.\d+)?, -?\d+(\.\d+)?$/.test(locName) : !locName.includes(" ");
    if (!numbersOnly) return;
    let gone = false;
    // Asked about the area (about 1 km), not the exact point.
    void (reverseGeocodeName as (lat: number, lon: number) => Promise<string | null>)(roundKm(locLat), roundKm(locLon)).then((place) => {
      if (gone || !place) return;
      const now = useHomeStore.getState().prefs.location;
      if (!now || now.latDeg !== locLat || now.lonDeg !== locLon || now.name !== locName) return;
      useHomeStore.getState().setPrefs({ location: { ...now, name: locSource === "grid" ? `${locName} · ${place}` : place } });
    });
    return () => { gone = true; };
  }, [locLat, locLon, locName, locSource]);

  // The location's ground height, looked up once through this site's own
  // /api/elevation and kept with it: the pass math and the brightness use it.
  // Asked about the area (about 1 km), which also lets nearby visitors share
  // the cached answer. A failed lookup leaves it at sea level, to try again
  // next visit.
  useEffect(() => {
    if (locLat == null || locLon == null || locElev != null) return;
    let gone = false;
    fetch(`/api/elevation?lat=${roundKm(locLat)}&lon=${roundKm(locLon)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { elevM: number | null } | null) => {
        if (gone || j?.elevM == null) return;
        const now = useHomeStore.getState().prefs.location;
        if (!now || now.latDeg !== locLat || now.lonDeg !== locLon) return;
        useHomeStore.getState().setPrefs({ location: { ...now, elevM: j.elevM } });
      })
      .catch(() => {});
    return () => { gone = true; };
  }, [locLat, locLon, locElev]);

  // Paused on a pass: stacked layouts give the map more of the screen.
  const mapPaused = useMapClock((s) => s.paused != null);
  // A pass open on a phone: the map pinned under the header and the card
  // below it (app/home.css .pass-view). The page cannot scroll meanwhile, so
  // the header's bottom, measured as it opens, is where the map starts.
  const passView = usePassViewStore((s) => s.open);
  const pendingRelease = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    if (!passView) return;
    // A close's pending let-go (below) happens now, before this open
    // measures the page.
    pendingRelease.current?.();
    const root = document.documentElement;
    // The list stays where it was, and goes back there when the pass view
    // closes: the pinned map leaves the page's flow meanwhile, and the
    // browser's scroll anchoring would follow the rows; it is held off.
    const scrollY = usePassViewStore.getState().scrollY ?? window.scrollY;
    usePassViewStore.setState({ scrollY: null });
    const openedOn = window.location.pathname;
    const anchor = root.style.overflowAnchor;
    root.style.overflowAnchor = "none";
    // Held at its height too, so a shorter page never clamps the scroll.
    const shell = document.querySelector<HTMLElement>(".map-shell");
    const minHeight = shell?.style.minHeight ?? "";
    if (shell) shell.style.minHeight = `${root.scrollHeight}px`;
    window.scrollTo(0, scrollY);
    const place = () => {
      const header = document.querySelector<HTMLElement>(".map-shell__top");
      root.style.setProperty("--pass-view-top", `${Math.max(0, Math.round(header?.getBoundingClientRect().bottom ?? 0))}px`);
    };
    place();
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      root.style.removeProperty("--pass-view-top");
      // Left for another page: that page keeps its own scroll.
      const samePage = window.location.pathname === openedOn;
      if (samePage) window.scrollTo(0, scrollY);
      const release = () => {
        window.clearTimeout(timer);
        pendingRelease.current = null;
        root.style.overflowAnchor = anchor;
        if (shell) shell.style.minHeight = minHeight;
      };
      // Let go once the map has eased back to its resting height.
      const timer = window.setTimeout(() => {
        if (samePage && window.location.pathname === openedOn) window.scrollTo(0, scrollY);
        release();
      }, samePage ? 400 : 0);
      pendingRelease.current = release;
    };
  }, [passView]);

  return (
    <MapShell
      className={[shellClassFor(pathname, scene?.shellClass), mapPaused && "map-paused", passView && "pass-view"].filter(Boolean).join(" ") || undefined}
      top={<SiteHeader />}
      notice={scene?.notice}
      offlineFromCache={scene?.offlineFromCache ?? false}
      map={(
        <>
          <SharedViewBanner at="map" />
          {scene?.above}
          <FlatMap
            fill
            sats={scene?.sats ?? []}
            observer={scene?.observer ?? null}
            projectionId={scene?.projectionId ?? projection}
            onProjectionChange={scene?.onProjectionChange ?? ((id) => setPrefs({ projection: id }))}
            selectedId={scene?.selectedId ?? null}
            minElevDeg={scene?.minElevDeg ?? 0}
            onSelect={scene?.onSelect ?? noop}
            top={scene?.top ?? null}
            chips={scene?.chips ?? null}
            share={<ShareButton url={() => currentViewUrl()} title="SeekSat map" label="Share this view" size="link" />}
          />
        </>
      )}
      panel={(
        <>
          <SharedViewBanner at="panel" />
          {children}
          {/* The docked live view (components/live/LiveDock) renders here. */}
          <div id={LIVE_DOCK_HOST_ID} className="live-dock-host" />
        </>
      )}
    />
  );
}
