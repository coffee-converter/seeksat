"use client";

import type { CSSProperties } from "react";
import { cx } from "@/lib/ui/classes.mjs";
import RadioMark from "./RadioMark";

interface Props {
  /** The dot and focus-ring colour. */
  color: string;
  label: string;
  focused?: boolean;
  /** Dimmed and struck through: the thing is hidden on the map. */
  hidden?: boolean;
  onSelect: () => void;
  /** Adds the eye button; omit for a chip that only selects. */
  onToggleHidden?: () => void;
  /** Known radio downlinks (shown in radio mode): the dot becomes the radio mark. */
  radio?: boolean;
}

/** One chip: a dot and a name (selects), plus an eye (hides). Render inside a <ul>. */
export default function Chip({ color, label, focused = false, hidden = false, onSelect, onToggleHidden, radio = false }: Props) {
  return (
    <li className={cx("chip", hidden && "chip--hidden", focused && "chip--focus")} style={{ "--chip-color": color } as CSSProperties}>
      <button type="button" className="chip__name" aria-pressed={focused} onClick={onSelect}>
        {radio ? <RadioMark className="chip__radio" label="known downlinks" /> : <span className="chip__dot" aria-hidden="true" />}
        {label}
      </button>
      {onToggleHidden ? (
        <button
          type="button"
          className="chip__eye"
          aria-label={hidden ? `Show ${label} on the map` : `Hide ${label} on the map`}
          title={hidden ? "Show on the map" : "Hide on the map"}
          onClick={onToggleHidden}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M1 8s2.6-5 7-5 7 5 7 5-2.6 5-7 5-7-5-7-5z" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="8" cy="8" r="2" fill="currentColor" />
            {hidden && <path d="M2 14 14 2" stroke="currentColor" strokeWidth="1.4" />}
          </svg>
        </button>
      ) : null}
    </li>
  );
}
