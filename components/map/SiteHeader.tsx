"use client";

// The header shared by every map page. It lives in the layout shell, so it
// stays mounted (with its own clock) while the page underneath changes.
// Phones (under 1100 px): wordmark, location pill, a search button that opens
// the search in a row under the header, then the settings gear. Desktop:
// wordmark, search, pill, clock, gear (app/home.css).

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SearchBar } from "@/components/home/SearchBar";
import LiveClock from "@/components/LiveClock";
import { useMapClock } from "@/lib/map/map-clock";
import Button from "@/components/ui/Button";
import { cx } from "@/lib/ui/classes.mjs";
import { useTrueNow } from "@/lib/ui/use-true-now";
import { isHomePath } from "@/lib/map/shell-route.mjs";
import { satPath } from "@/lib/sat/page-data.mjs";
import { useMapScene } from "@/lib/map/scene-store";
import LocationPill from "./LocationPill";
import LocationSheet from "./LocationSheet";
import SettingsSheet from "./SettingsSheet";
import Icon from "@/components/ui/Icon";

export default function SiteHeader() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const nowMs = useTrueNow();
  const pausedMs = useMapClock((s) => s.paused?.atMs ?? null);
  // The page's search handlers are read when called, so a scene publish
  // never re-renders the header.
  const onView = useCallback((id: number) => {
    const search = useMapScene.getState().scene?.search;
    if (search) search.onView(id);
    else router.push(satPath(id) as string);
  }, [router]);
  const onClearFocus = useCallback(() => useMapScene.getState().scene?.search?.onClearFocus(), []);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Phones only: the search row under the header. Desktop always shows it.
  const [findOpen, setFindOpen] = useState(false);
  const findId = useId();
  const findRef = useRef<HTMLDivElement>(null);
  const findButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (findOpen) findRef.current?.querySelector("input")?.focus();
  }, [findOpen]);
  const searchEmpty = () => !findRef.current?.querySelector("input")?.value;

  return (
    <>
      {isHomePath(pathname) ? (
        <h1 className="home-wordmark"><span className="home-wordmark__seek">Seek</span>Sat</h1>
      ) : (
        <Link className="home-wordmark" href="/"><span className="home-wordmark__seek">Seek</span>Sat</Link>
      )}
      <div
        ref={findRef}
        id={findId}
        className={cx("map-shell__search", findOpen && "map-shell__search--open")}
        onKeyDown={(e) => {
          if (e.key === "Escape" && findOpen && searchEmpty()) {
            setFindOpen(false);
            findButtonRef.current?.focus();
          }
        }}
        onBlur={(e) => {
          const to = e.relatedTarget as Node | null;
          // Leaving for the search button: its click does the closing.
          if (to === findButtonRef.current) return;
          if (findOpen && !e.currentTarget.contains(to) && searchEmpty()) setFindOpen(false);
        }}
      >
        <SearchBar
          onView={onView}
          onClearFocus={onClearFocus}
        />
      </div>
      <div className="map-shell__end">
        <LocationPill onOpen={() => setPlaceOpen(true)} />
        <Button
          ref={findButtonRef}
          variant="quiet"
          iconOnly
          className="map-shell__find"
          aria-label="Search satellites"
          aria-expanded={findOpen}
          aria-controls={findId}
          onClick={() => setFindOpen((v) => !v)}
        >
          <Icon name="search" size={20} />
        </Button>
        <LiveClock nowMs={nowMs} pausedMs={pausedMs} compact />
        <Button variant="quiet" iconOnly className="map-shell__more" aria-label="Settings" aria-haspopup="dialog" onClick={() => setSettingsOpen(true)}>
          <Icon name="settings" size={20} />
        </Button>
      </div>
      <LocationSheet open={placeOpen} onClose={() => setPlaceOpen(false)} />
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
