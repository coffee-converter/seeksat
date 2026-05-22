// SeekSat brand header. Floats above the Cesium canvas at z-index
// 1100 (one above the side panels, well below modals/loaders). Sized
// to fit in the gap between the left panel and the right edge of
// the canvas — see globals.css for the matching styles.
//
// Triangulate lives at /triangulate but isn't linked from the nav —
// it's a private tool for now. The brand link sends users home.
import Link from "next/link";

export default function SiteHeader() {
  return (
    <nav id="site-nav" aria-label="Primary">
      <Link href="/" className="site-brand">SeekSat</Link>
    </nav>
  );
}
