"use client";

import { useEffect, useId, useRef, useState } from "react";
import QualityBadge, { type Quality } from "@/components/passes/QualityBadge";
import { ratingWords } from "@/lib/passes/rating-words.mjs";

const wordsOf = ratingWords as (mode: "radio" | "visual") => string;

/** A pass's rating badge as a button: tapping it says what the rating is based
 *  on. A small popover under the badge; Esc or a press outside closes it and
 *  Esc gives focus back to the badge. */
export default function RatingExplainer({ pass, rating, mode }: {
  pass: { maxElevDeg?: number }; rating?: Quality; mode: "radio" | "visual";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    // Caught on the way down so the page's own Esc handlers do not also act.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div className="rating-explainer" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="rating-explainer__btn"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="What this rating means"
        onClick={() => setOpen((o) => !o)}
      >
        <QualityBadge pass={pass} rating={rating} maxShown pill />
      </button>
      <p id={panelId} className="rating-explainer__panel note note--sm" hidden={!open}>
        {wordsOf(mode)}
      </p>
    </div>
  );
}
