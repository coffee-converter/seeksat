import type { ReactNode } from "react";

interface Props {
  /** The slim top bar: wordmark, search and clock. */
  top: ReactNode;
  /** The map (a FlatMap with `fill`). */
  map: ReactNode;
  /** Everything else, in reading order. */
  panel: ReactNode;
  /** Extra class on the root, for page-specific styles. */
  className?: string;
}

/**
 * The map-first frame shared by / and /sat/<id> (styles in app/home.css).
 * From 1100 px the map fills the window under the top bar, with the panel
 * scrolling on its own at the right and the page itself still. Narrower, one
 * column: the top bar sticks, a tall map, then the panel flows below.
 */
export default function MapShell({ top, map, panel, className }: Props) {
  return (
    <div className={className ? `map-shell ${className}` : "map-shell"}>
      <header className="map-shell__top">{top}</header>
      <div className="map-shell__map">{map}</div>
      <main className="map-shell__panel">{panel}</main>
    </div>
  );
}
