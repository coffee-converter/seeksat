import TriangulateApp from "@/components/TriangulateApp";

// The component itself is "use client" and gates all window/Cesium
// access behind useEffect, so SSR only emits the empty container div
// and the real viewer setup happens on the client after the Cesium
// CDN script finishes loading. No dynamic({ ssr: false }) shenanigans
// needed in App Router this way.
export default function HomePage() {
  return <TriangulateApp />;
}
