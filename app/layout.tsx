import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import CesiumLoader from "@/components/CesiumLoader";
import "./globals.css";

// Canonical site URL. All relative URLs in openGraph / twitter / etc.
// resolve against this. Switch to https://seeksat.com once the domain
// is attached; until then the Vercel-assigned production alias works.
const SITE_URL = "https://seeksat.com";
const SITE_NAME = "SeekSat";
const SITE_DESCRIPTION =
  "Satellite pass forecasts. Place ground stations on a 3D globe and " +
  "find when satellites pass overhead at all of them at once — visual " +
  "or radio. Polar sky charts with sun/moon/planet context per pass.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Page-level <title> can override this; sub-pages without an
  // override get just SITE_NAME (default). The template is used
  // when a sub-page sets `title: "Whatever"` → "Whatever | SeekSat".
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "satellite tracking", "ISS pass", "satellite forecast",
    "satellite pass", "ham radio satellite", "amateur radio satellite",
    "visual satellite", "ground station", "polar plot", "sky chart",
    "satellite visibility",
  ],
  authors: [{ name: SITE_NAME }],
  // Canonical link element — points search engines at the apex URL
  // even when the page is reached via a www/Vercel-preview alias.
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: "/",
    locale: "en_US",
    // /og.png is a 1200×630 image that doesn't exist yet — drop one
    // in public/og.png to populate. Until it exists, social previews
    // fall back to whatever the platform scrapes from the page.
    images: [{
      url: "/og.png",
      width: 1200,
      height: 630,
      alt: `${SITE_NAME} — satellite pass forecasts`,
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: ["/og.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  // Hints to browsers/PWA installers. `manifest` is omitted — drop a
  // public/manifest.webmanifest in later if a PWA install matters.
  formatDetection: { telephone: false, email: false, address: false },
};

// `themeColor` + `viewport` moved out of `metadata` in Next 14 — they
// belong in a separate `viewport` export. Matches the page background
// in globals.css (#0a0e1a) so mobile address-bar / standalone-PWA
// chrome blends in instead of flashing white.
export const viewport: Viewport = {
  themeColor: "#0a0e1a",
  width: "device-width",
  initialScale: 1,
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
        {/* Preload kicks off the ~3MB Cesium.js fetch in parallel with
            React hydration / route chunks, instead of waiting for the
            afterInteractive Script tag to be parsed. Same URL the
            CesiumLoader Script tag uses, so the browser dedupes. */}
        <link rel="preload" as="script" href={`${CESIUM_CDN}/Build/Cesium/Cesium.js`} />
      </head>
      <body>
        <CesiumLoader src={`${CESIUM_CDN}/Build/Cesium/Cesium.js`} />
        {children}
        {/* Vercel Web Analytics (page views, top pages, referrers)
            and Speed Insights (Core Web Vitals from real visitors).
            Both no-op in development; only emit on Vercel deploys. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
