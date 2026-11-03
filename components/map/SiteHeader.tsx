"use client";

// The header shared by every map page. It lives in the layout shell, so it
// stays mounted (with its own clock) while the page underneath changes.

import { useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SearchBar } from "@/components/home/SearchBar";
import LiveClock from "@/components/LiveClock";
import NightToggle from "@/components/NightToggle";
import ThemeToggle from "@/components/ThemeToggle";
import { useTrueNow } from "@/lib/ui/use-true-now";
import { isHomePath } from "@/lib/map/shell-route.mjs";
import { satPath } from "@/lib/sat/page-data.mjs";
import { useMapScene } from "@/lib/map/scene-store";

export default function SiteHeader() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const nowMs = useTrueNow();
  // The page's search handlers are read when called, so a scene publish
  // never re-renders the header.
  const onView = useCallback((id: number) => {
    const search = useMapScene.getState().scene?.search;
    if (search) search.onView(id);
    else router.push(satPath(id) as string);
  }, [router]);
  const onClearFocus = useCallback(() => useMapScene.getState().scene?.search?.onClearFocus(), []);

  return (
    <>
      {isHomePath(pathname) ? (
        <h1 className="home-wordmark">SeekSat</h1>
      ) : (
        <Link className="home-wordmark" href="/">SeekSat</Link>
      )}
      <div className="map-shell__search">
        <SearchBar
          onView={onView}
          onClearFocus={onClearFocus}
        />
      </div>
      <div className="map-shell__end">
        <LiveClock nowMs={nowMs} compact />
        <ThemeToggle />
        <NightToggle />
      </div>
    </>
  );
}
