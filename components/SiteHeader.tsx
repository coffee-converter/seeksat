"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Top-center pill nav. Floats above the Cesium canvas at z-index 1100
// (one above the side panels, well below modals/loaders). Sized to fit
// in the gap between the left panel and the right edge of the canvas —
// see globals.css for the matching styles.
export default function SiteHeader() {
  const pathname = usePathname();
  const isPasses = pathname?.startsWith("/passes");
  const isTriangulate = !isPasses;

  return (
    <nav id="site-nav" aria-label="Primary">
      <span className="site-brand">ISS</span>
      <Link
        href="/"
        className={`site-nav-link ${isTriangulate ? "active" : ""}`}
      >
        Triangulate
      </Link>
      <Link
        href="/passes"
        className={`site-nav-link ${isPasses ? "active" : ""}`}
      >
        Passes
      </Link>
    </nav>
  );
}
