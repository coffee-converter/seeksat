import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import CesiumLoader from "@/components/CesiumLoader";
import "./globals.css";

export const metadata: Metadata = {
  title: "ISS Triangulation",
  description:
    "Triangulate the ISS from multiple ground observations and find shared visibility windows.",
};

// Cesium 1.141 — same version the legacy static pages used. Loaded
// as a side-effect global from CDN; CSS first so widget styles are
// present before any component mounts a Viewer. CesiumLoader is a
// tiny client component wrapping next/script's <Script onReady> so
// useCesiumViewer can await a Promise rather than poll for window.Cesium.
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
        <CesiumLoader src={`${CESIUM_CDN}/Build/Cesium/Cesium.js`} />
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
