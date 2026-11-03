"use client";

// The header shared by every map page. It lives in the layout shell, so it
// stays mounted (with its own clock) while the page underneath changes.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SearchBar } from "@/components/home/SearchBar";
import LiveClock from "@/components/LiveClock";
import NightToggle from "@/components/NightToggle";
import ThemeToggle from "@/components/ThemeToggle";
import { trueNow } from "@/lib/pass-finder/clock-sync.js";
import { isHomePath } from "@/lib/map/shell-route.mjs";
import { useMapScene } from "@/lib/map/scene-store";

export default function SiteHeader() {
  const pathname = usePathname() ?? "";
  const search = useMapScene((s) => s.scene?.search);
  const [nowMs, setNowMs] = useState<number | null>(null);

  // Starts after mount so server render and hydration agree; stops while hidden.
  useEffect(() => {
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

  return (
    <>
      {isHomePath(pathname) ? (
        <h1 className="home-wordmark">SeekSat</h1>
      ) : (
        <Link className="home-wordmark" href="/">SeekSat</Link>
      )}
      <div className="map-shell__search">
        <SearchBar
          onView={(id) => search?.onView(id)}
          onClearFocus={() => search?.onClearFocus()}
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
