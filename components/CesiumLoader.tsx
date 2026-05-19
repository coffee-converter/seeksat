"use client";

import Script from "next/script";
import { markCesiumLoaded, markCesiumError } from "@/lib/cesium-loaded";

// Loads the Cesium CDN script and resolves lib/cesium-loaded's
// shared promise when it's ready. Lives in a tiny client component
// because next/script's onReady/onError props are functions and
// can't cross the server→client boundary directly; layout (a Server
// Component) just renders <CesiumLoader src=... />.
export default function CesiumLoader({ src }: { src: string }) {
  return (
    <Script
      src={src}
      strategy="afterInteractive"
      // onReady fires after the script first loads AND on every
      // remount (e.g. SPA navigation back to a Cesium page), which
      // is what we want — useCesiumViewer subscribes per mount.
      onReady={() => markCesiumLoaded()}
      onError={() => markCesiumError()}
    />
  );
}
