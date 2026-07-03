"use client";

import { useEffect } from "react";

// Toggle a class on document.body while the calling component is
// mounted AND `enabled` is true. Cleanup removes the class on unmount
// or when the dependency flips to false. Convenience wrapper for the
// "store-slice mirrors onto a body-class for global CSS selectors"
// pattern - same useEffect every time, this gives it a name.
//
// We attach to <body> rather than a component-owned <div> because the
// CSS rules (e.g. body.panel-collapsed #panel-left) target descendant
// selectors that aren't all in the same React subtree - the site nav
// in app/layout.tsx is a sibling of the page content, and CSS only
// reaches across the layout boundary through a body-level toggle.
export function useBodyClass(className: string, enabled: boolean): void {
  useEffect(() => {
    document.body.classList.toggle(className, enabled);
    return () => document.body.classList.remove(className);
  }, [className, enabled]);
}
