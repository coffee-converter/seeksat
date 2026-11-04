import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { EXO2_FONT_FACE } from "@/lib/pass-finder/exo2-embed.js";
import { SITE_URL } from "@/lib/site.mjs";
import { THEME_SCRIPT } from "@/lib/ui/theme.mjs";
import { mapTokenCss } from "@/lib/ui/map-tokens.mjs";
import { chartTokenCss } from "@/lib/ui/chart-tokens.mjs";
import ThemeSync from "@/components/ThemeSync";
import SwRegister from "@/components/SwRegister";
import ErrorReporter from "@/components/ErrorReporter";
import "./globals.css";
import "./ui.css";
// Atkinson Hyperlegible Next, variable (wght 200-800), committed under
// app/fonts/ (OFL; see app/fonts/README.md) and served by next/font from
// /_next/static/media, same origin. Split as Google Fonts splits it: latin is
// preloaded; latin-ext loads only when a page uses one of its characters.
// The unicode ranges match scripts/build-atkinson-web.py (next/font needs
// literal options). The font has no arrow glyphs (U+2190/2192); those use the
// system font.
const atkinson = localFont({
  src: "./fonts/AtkinsonHyperlegibleNext-latin.woff2",
  weight: "200 800",
  variable: "--font-atkinson",
  display: "swap",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});
// No metric fallback face of its own: one would cover every character and
// shadow the latin face behind it in --font-sans.
const atkinsonExt = localFont({
  src: "./fonts/AtkinsonHyperlegibleNext-latin-ext.woff2",
  weight: "200 800",
  variable: "--font-atkinson-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
});

const SITE_NAME = "SeekSat";
// SEO title: ~57 chars (target 50-60) so search results don't truncate
// and the page reads as more than a bare brand name. SITE_NAME stays the
// short brand for og:site_name, the title template, and applicationName.
const SITE_TITLE = "SeekSat - Track Any Satellite: Live Map, Passes & Doppler";
// Meta description: ~139 chars (target 110-160). The longer marketing
// blurb was 198 chars and got truncated in results.
const SITE_DESCRIPTION =
  "Track any satellite live and see when it passes over you: sky charts for watching, Doppler and pointing charts for radio. Free, no sign-up.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Page-level <title> can override this; sub-pages without an
  // override get just SITE_NAME (default). The template is used
  // when a sub-page sets `title: "Whatever"` → "Whatever | SeekSat".
  title: { default: SITE_TITLE, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "satellite tracking", "satellite tracker", "live satellite map", "ISS pass", "satellite forecast",
    "satellite pass", "ham radio satellite", "amateur radio satellite",
    "visual satellite", "ground station", "polar plot", "sky chart",
    "satellite visibility", "NORAD", "Doppler", "geostationary",
  ],
  authors: [{ name: SITE_NAME }],
  // Canonical link element - points search engines at the apex URL
  // even when the page is reached via a www/Vercel-preview alias.
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    locale: "en_US",
    // /og.png: the 1200×630 default card, written by
    // scripts/build-og-image.mjs (satellite pages get their own, /api/og).
    images: [{
      url: "/og.png",
      width: 1200,
      height: 630,
      alt: `${SITE_NAME} - satellite pass forecasts`,
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
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
  // The web app manifest comes from app/manifest.ts; Next links it.
  formatDetection: { telephone: false, email: false, address: false },
};

// `themeColor` + `viewport` moved out of `metadata` in Next 14 - they
// belong in a separate `viewport` export. Matches the page background
// in globals.css (#11151c) so mobile address-bar / standalone-PWA
// chrome blends in instead of flashing white.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#11151c" },
    { media: "(prefers-color-scheme: light)", color: "#f3f5f8" },
  ],
  width: "device-width",
  initialScale: 1,
};

// Structured data: what SeekSat is and that it's free.
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: `${SITE_URL}/`,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      publisher: { "@id": `${SITE_URL}/#org` },
    },
    {
      "@type": "WebApplication",
      name: SITE_NAME,
      url: `${SITE_URL}/`,
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "Web",
      description: SITE_DESCRIPTION,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      creator: { "@id": `${SITE_URL}/#org` },
    },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#org`,
      name: SITE_NAME,
      url: `${SITE_URL}/`,
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${atkinson.variable} ${atkinsonExt.variable}`} suppressHydrationWarning>
      <head>
        {/* Sets data-theme on <html> before first paint (no light/dark flash). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {/* Exo 2 (subset, base64) for the SeekSat brand wordmark. Same
            embed the polar-chart export uses - inlined here so the font
            is available document-wide (e.g. the on-scene corner mark)
            with no extra network fetch or flash of fallback text. */}
        <style dangerouslySetInnerHTML={{ __html: EXO2_FONT_FACE }} />
        {/* Map colours (--map-ocean, --map-land, --map-night, --map-observer)
            generated from the map modules, so the legend and the map agree,
            and --modal-dark-bg from the charts' canvas colour. */}
        <style dangerouslySetInnerHTML={{ __html: mapTokenCss() + chartTokenCss() }} />
      </head>
      <body>
        <ThemeSync />
        <SwRegister />
        <ErrorReporter />
        {children}
        {/* Vercel Web Analytics (page views, top pages, referrers)
            and Speed Insights (Core Web Vitals from real visitors).
            Both no-op in development; only emit on Vercel deploys. */}
        <Analytics />
        <SpeedInsights />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
      </body>
    </html>
  );
}
