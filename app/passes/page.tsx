import PassFinderApp from "@/components/PassFinderApp";
import "./pass-finder.css";

// /passes — multi-observer ISS pass finder. The component itself is
// "use client" and waits for window.Cesium inside useEffect, so SSR
// only emits the DOM skeleton; the bootstrap runs entirely on the
// client.
export default function PassesPage() {
  return <PassFinderApp />;
}
