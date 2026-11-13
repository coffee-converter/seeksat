"use client";

import { useState, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import { lowFoldLabel, splitLowRows } from "@/lib/ui/low-fold.mjs";

type Rowish = { key: string; pass: { startMs: number; endMs: number } };

const split = splitLowRows as unknown as <R extends Rowish>(rows: R[], nowMs: number) => { shown: R[]; folded: R[] };

/** One day's rows with the very low passes folded into a quiet line at the
 *  end. The folded rows keep their keys, so opening and closing still work;
 *  a folded row that is the open one (from the timeline, or a shared link)
 *  keeps the fold open. Renders the `li`s for a pass list's `ul`. */
export default function LowFold<R extends Rowish>({ rows, nowMs, openKey, renderRow }: {
  rows: R[];
  nowMs: number;
  openKey: string | null;
  renderRow: (row: R) => ReactNode;
}) {
  const { shown, folded } = split(rows, nowMs);
  const [chosen, setChosen] = useState(false);
  const holdsOpen = openKey != null && folded.some((r) => r.key === openKey);
  const expanded = chosen || holdsOpen;
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
