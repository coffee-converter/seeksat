"use client";

import { useState, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import { lowFoldLabel, splitLowRows } from "@/lib/ui/low-fold.mjs";

type Rowish = { key: string; pass: { startMs: number; endMs: number } };

const split = splitLowRows as unknown as <R extends Rowish>(rows: R[], nowMs: number) => { shown: R[]; folded: R[] };

/** One day's rows with the very low passes folded into a quiet line at the
 *  end. The folded rows keep their keys, so opening and closing still work;
 *  a folded row opened from elsewhere (the timeline, or a shared link) opens
 *  the fold, and it stays open. Renders the `li`s for a pass list's `ul`. */
export default function LowFold<R extends Rowish>({ rows, nowMs, openKey, renderRow }: {
  rows: R[];
  nowMs: number;
  openKey: string | null;
  renderRow: (row: R) => ReactNode;
}) {
  const { shown, folded } = split(rows, nowMs);
  const [chosen, setChosen] = useState(false);
  const holdsOpen = openKey != null && folded.some((r) => r.key === openKey);
  // A folded row opened from outside (the timeline, the Best line, a shared
  // link) opens the fold, and it stays open: closing that row must not pull
  // the rows, and the button just pressed, out from under the reader. Only the
  // moment it becomes open counts, so the fold's own button can still close it.
  const [held, setHeld] = useState(false);
  if (holdsOpen !== held) {
    setHeld(holdsOpen);
    if (holdsOpen) setChosen(true);
  }
  const expanded = chosen;
  return (
    <>
      {shown.map(renderRow)}
      {expanded && folded.map(renderRow)}
      {folded.length > 0 && (
        <li className="pass-row pass-row--fold">
          <Button
            variant="quiet"
            size="sm"
            className="pass-fold__btn"
            aria-expanded={expanded}
            onClick={() => setChosen(!expanded)}
          >
            {lowFoldLabel(folded.length)}
            <Icon name={expanded ? "chevron-up" : "chevron-down"} />
          </Button>
        </li>
      )}
    </>
  );
}
