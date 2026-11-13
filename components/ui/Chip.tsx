"use client";

import type { CSSProperties } from "react";
import { cx } from "@/lib/ui/classes.mjs";
import RadioMark from "./RadioMark";
import Icon from "./Icon";

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
  /** A selected satellite you do not follow: a dashed chip that follows it
   *  when tapped anywhere (onSelect and the eye are unused). */
  onFollow?: () => void;
  /** Why following is blocked (the cap): the follow button is off, this its tip. */
  followBlocked?: string | null;
}

/** One chip: a dot and a name (selects), plus an eye (hides). Render inside a <ul>. */
export default function Chip({ color, label, focused = false, hidden = false, onSelect, onToggleHidden, radio = false, onFollow, followBlocked = null }: Props) {
  return (
    <li className={cx("chip", hidden && "chip--hidden", focused && "chip--focus", onFollow && "chip--unfollowed")} style={{ "--chip-color": color } as CSSProperties}>
      {onFollow ? (
        // Not followed: the whole chip follows it.
        <button
          type="button"
          className="chip__name chip__whole"
          aria-label={`Follow ${label}`}
          title={followBlocked ?? `Follow ${label}`}
          disabled={Boolean(followBlocked)}
          onClick={onFollow}
        >
          {radio ? <RadioMark className="chip__radio" label="known downlinks" /> : <span className="sat-dot sat-dot--sm" aria-hidden="true" />}
          {label}
          <span className="chip__follow" aria-hidden="true">
            <Icon name="star" size={14} />
            Follow
          </span>
        </button>
      ) : (
        <>
          <button type="button" className="chip__name" aria-pressed={focused} onClick={onSelect}>
            {radio ? <RadioMark className="chip__radio" label="known downlinks" /> : <span className="sat-dot sat-dot--sm" aria-hidden="true" />}
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
              <Icon name={hidden ? "eye-off" : "eye"} size={14} />
            </button>
          ) : null}
        </>
      )}
    </li>
  );
}
