"use client";

import type { MouseEvent } from "react";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import { cx, surfaceClass } from "@/lib/ui/classes.mjs";

type Words = { label: string; text: string };

/** "Best tonight: ISS 9:44 PM, 72°, look NW": the whole line opens that pass's row. */
export function BestLine({ words, onOpen }: { words: Words; onOpen: () => void }) {
  return (
    // A whole line that opens a row, like a pass row: an interactive Surface.
    <button type="button" className={`best-line best-line--best ${surfaceClass({ padded: "sm", interactive: true })}`} onClick={onOpen}>
      <Icon name="star" className="best-line__icon" />
      <span className="best-line__words">
        <span className="best-line__label">{words.label}</span> {words.text}
      </span>
      <Icon name="chevron-right" className="best-line__go" />
    </button>
  );
}

/** "Up now: ISS, look NE, 4 min left", with Live when the live view can open. */
export function UpNowLine({ words, onLive }: { words: Words; onLive: ((e: MouseEvent<HTMLButtonElement>) => void) | null }) {
  return (
    <div className={cx(surfaceClass({ padded: "sm" }), "best-line best-line--now")}>
      <span className="best-line__words">
        <span className="best-line__label">{words.label}</span> {words.text}
      </span>
      {onLive && (
        <Button size="sm" className="best-line__live" onClick={onLive}>
          <span className="live-dot" aria-hidden="true" />Live
        </Button>
      )}
    </div>
  );
}
