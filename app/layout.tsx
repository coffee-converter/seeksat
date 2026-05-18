import type { Metadata } from "next";
import Script from "next/script";
import SiteHeader from "@/components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "ISS Triangulation",
  description:
    "Triangulate the ISS from multiple ground observations and find shared visibility windows.",
};

// Cesium 1.141 — same version the legacy static pages used. Loaded as
// a side-effect global from CDN; CSS first so widget styles are
// present before any component mounts a Viewer. afterInteractive is
// fine: the only pages that touch Cesium are client components that
// gate their viewer setup behind a window.Cesium check inside
// useEffect, so a slight load delay doesn't cause SSR errors.
const CESIUM_VERSION = "1.141";
const CESIUM_CDN = `https://cesium.com/downloads/cesiumjs/releases/${CESIUM_VERSION}`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href={`${CESIUM_CDN}/Build/Cesium/Widgets/widgets.css`} />
      </head>
      <body>
        <Script
          src={`${CESIUM_CDN}/Build/Cesium/Cesium.js`}
          strategy="afterInteractive"
        />
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
