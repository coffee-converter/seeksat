import TriangulateApp from "@/components/TriangulateApp";

// /triangulate — multi-observer ray triangulation page. Not linked
// from the site nav (kept private for now); reachable by URL.
//
// The component itself is "use client" and gates all window/Cesium
// access behind useEffect, so SSR only emits the empty container div
// and the real viewer setup happens on the client after the Cesium
// CDN script finishes loading.
export default function TriangulatePage() {
  return <TriangulateApp />;
}
