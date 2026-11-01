import CesiumLoader from "@/components/CesiumLoader";

// Cesium 1.141 - same version the legacy static pages used. Loaded
// as a side-effect global from CDN; CSS first so widget styles are
// present before any component mounts a Viewer. CesiumLoader is a
// tiny client component wrapping next/script's <Script onReady> so
// useCesiumViewer can await a Promise rather than poll for window.Cesium.
// Only /classic loads Cesium; the home page at / stays light.
const CESIUM_VERSION = "1.141";
const CESIUM_CDN = `https://cesium.com/downloads/cesiumjs/releases/${CESIUM_VERSION}`;

export default function ClassicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <link
        rel="stylesheet"
        href={`${CESIUM_CDN}/Build/Cesium/Widgets/widgets.css`}
        precedence="default"
      />
      {/* Preload kicks off the ~3MB Cesium.js fetch in parallel with
          React hydration / route chunks, instead of waiting for the
          afterInteractive Script tag to be parsed. Same URL the
          CesiumLoader Script tag uses, so the browser dedupes. */}
      <link rel="preload" as="script" href={`${CESIUM_CDN}/Build/Cesium/Cesium.js`} />
      <CesiumLoader src={`${CESIUM_CDN}/Build/Cesium/Cesium.js`} />
      {children}
    </>
  );
}
