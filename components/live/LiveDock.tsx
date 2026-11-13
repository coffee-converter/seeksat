"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import { LIVE_DOCK_HOST_ID, useLiveDock } from "@/lib/live/dock-store";

interface Props {
  title: string;
  /** The satellite, which the map selects and locks on to while docked. */
  noradId: number;
  onClose: () => void;
  children: ReactNode;
}

/**
 * The live view in the desktop panel, in place of the page (from 1100 px).
 * It renders into the shell's dock host; while it is there, CSS hides the
 * panel's other children (app/home.css), so the page underneath stays as it
 * was. Focus moves to the heading, Escape closes (unless a dialog or a field
 * has it), and closing puts the panel's scroll back. The opener gets focus
 * back from the chart hooks' onClose.
 */
export default function LiveDock({ title, noradId, onClose, children }: Props) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Before the dock shows, while the page still has its height: note where
  // the panel was scrolled. Closing puts it back once the dock has left the
  // DOM (a cleanup runs while it is still there).
  useLayoutEffect(() => {
    const el = document.getElementById(LIVE_DOCK_HOST_ID);
    const panel = el?.closest<HTMLElement>(".map-shell__panel") ?? null;
    if (!el || !panel) return;
    const top = panel.scrollTop;
    setHost(el);
    return () => queueMicrotask(() => { panel.scrollTop = top; });
  }, []);

  // Shown: the panel starts at the top, focus on the heading.
  useLayoutEffect(() => {
    if (!host) return;
    const panel = host.closest<HTMLElement>(".map-shell__panel");
    if (panel) panel.scrollTop = 0;
    headingRef.current?.focus({ preventScroll: true });
  }, [host]);

  // The map selects the satellite and locks on (components/map/MapLayoutShell).
  useEffect(() => {
    const { setNoradId } = useLiveDock.getState();
    setNoradId(noradId);
    return () => setNoradId(null);
  }, [noradId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // A dialog over the page, or a field (the search box), has its own Escape.
      if (document.querySelector('[aria-modal="true"]')) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      // Caught on the way down, as the Modal does, so the page's own Escape
      // (leaving a focus or the satellite page) never sees it.
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  if (!host) return null;
  return createPortal(
    <section className="live-dock" aria-labelledby={titleId}>
      <header className="live-dock__head">
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="heading-page live-dock__title">{title}</h2>
        <Button variant="quiet" tone="danger" iconOnly aria-label="Close" onClick={() => onCloseRef.current()}>
          <Icon name="close" />
        </Button>
      </header>
      {children}
    </section>,
    host,
  );
}
