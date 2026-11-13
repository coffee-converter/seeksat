"use client";

import { useEffect, useId, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { type Quality } from "@/components/passes/QualityBadge";
import { passQuality } from "@/lib/passes/quality.mjs";
import { ratingWords } from "@/lib/passes/rating-words.mjs";

const wordsOf = ratingWords as (mode: "radio" | "visual") => string;
const qualityOf = passQuality as (pass: { maxElevDeg?: number }) => Quality;

/** "Why Fair?": a link-style button that says what the rating is based on, in
 *  a small popover under it (the row above already shows the badge). Esc or a
 *  press outside closes it, and Esc gives focus back to the button. */
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
      <Button
        ref={buttonRef}
        variant="link"
        size="sm"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        {`Why ${(rating ?? qualityOf(pass)).label}?`}
      </Button>
      <p id={panelId} className="rating-explainer__panel note note--sm" hidden={!open}>
        {wordsOf(mode)}
      </p>
    </div>
  );
}
