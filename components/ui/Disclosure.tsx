"use client";

import type { ReactNode } from "react";
import Button from "./Button";
import { cx } from "@/lib/ui/classes.mjs";

interface DisclosureProps {
  /** Id of the panel the button controls. */
  id: string;
  open: boolean;
  onToggle: () => void;
  /** What the actions are for, e.g. "the 14:02 to 14:13 pass". */
  label: string;
  children: ReactNode;
}

// A "⋯" button and the less-used actions it reveals. It is outlined like the
// buttons beside it, so it reads as one; its accessible name says More or
// Less and which pass it is for, and the tooltip says what it does. The
// wrapper and panel are display: contents, so the actions join the row.
export function Disclosure({ id, open, onToggle, label, children }: DisclosureProps) {
  const word = open ? "Less" : "More";
  return (
    <div className="disclosure">
      <Button
        size="sm"
        className="disclosure__toggle"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${word} actions for ${label}`}
        title={`${word} actions`}
        onClick={onToggle}
      >
        <span aria-hidden="true">⋯</span>
      </Button>
      <div id={id} className="disclosure__panel" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

/** A native fold: <details> with a chevron summary. Pass `open` and
 *  `onToggle` to control it; `className` places it in a layout. */
export function Details({ summary, defaultOpen, open, onToggle, className, children }: {
  summary: ReactNode; defaultOpen?: boolean; open?: boolean; onToggle?: (open: boolean) => void; className?: string; children: ReactNode;
}) {
  return (
    <details
      className={cx("details", className)}
      open={open ?? defaultOpen}
      onToggle={onToggle ? (e) => onToggle(e.currentTarget.open) : undefined}
    >
      <summary className="details__summary">{summary}</summary>
      {children}
    </details>
  );
}

export default Disclosure;
