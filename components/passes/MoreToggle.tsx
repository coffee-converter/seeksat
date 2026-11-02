"use client";

import type { ReactNode } from "react";

interface Props {
  /** Id of the panel the button controls. */
  id: string;
  open: boolean;
  onToggle: () => void;
  /** What the actions are for, e.g. "the 14:02 to 14:13 pass". */
  label: string;
  children: ReactNode;
}

// A More/Less button and the less-used actions it reveals. The accessible
// name starts with the visible word (WCAG 2.5.3) and says which pass it is for.
export default function MoreToggle({ id, open, onToggle, label, children }: Props) {
  const word = open ? "Less" : "More";
  return (
    <>
      <button
        type="button"
        className="home-chip more-toggle"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${word} actions for ${label}`}
        onClick={onToggle}
      >
        {word}
      </button>
      <div id={id} className="more-panel" hidden={!open}>
        {children}
      </div>
    </>
  );
}
