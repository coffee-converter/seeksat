import PassFinderApp from "@/components/PassFinderApp";
import "./pass-finder.css";

// Home page: multi-observer satellite pass finder. The component is
// "use client" and waits for window.Cesium inside useEffect, so SSR
// only emits the DOM skeleton; the bootstrap runs entirely on the
// client.
export default function HomePage() {
  return <PassFinderApp />;
}
