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

// A "⋯" button and the less-used actions it reveals. It is outlined like the
// buttons beside it, so it reads as one; its accessible name says More or
// Less and which pass it is for, and the tooltip says what it does.
export default function MoreToggle({ id, open, onToggle, label, children }: Props) {
  const word = open ? "Less" : "More";
  return (
    <>
      <button
        type="button"
        className={`home-chip more-toggle${open ? " home-chip--on" : ""}`}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${word} actions for ${label}`}
        title={`${word} actions`}
        onClick={onToggle}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      <div id={id} className="more-panel" hidden={!open}>
        {children}
      </div>
    </>
  );
}
