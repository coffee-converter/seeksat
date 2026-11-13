"use client";

import { focusBarText } from "@/lib/home/focus.mjs";
import Button from "@/components/ui/Button";

type BarText = { title: string; showAll: string };
const textOf = focusBarText as (name: string, isFollowed: boolean, total: number) => BarText;

interface Props {
  name: string;
  followed: boolean;
  /** Why following is blocked (the cap), shown instead of following. */
  blocked: string | null;
  onToggleFollow: () => void;
  /** How many satellites Show all draws. */
  total?: number;
  onShowAll?: () => void;
}

// Above the map while a pasted satellite is focused on home. (A satellite
// page has no bar: Lock on sits in the map corner, Close in the page.)
export default function FocusBar({ name, followed, blocked, onToggleFollow, total = 0, onShowAll }: Props) {
  const text = textOf(name, followed, total);
  return (
    <div className="focus-bar" role="region" aria-label="Focused satellite">
      {/* Phones drop "Viewing" and the star's word (still read out), so the bar is one row. */}
      <p className="focus-bar__title" title={text.title}>
        <span className="focus-bar__lead">Viewing </span>{name}
      </p>
      <div className="focus-bar__actions">
        <Button size="sm" className="focus-bar__follow" on={followed} disabled={!followed && Boolean(blocked)} onClick={onToggleFollow}>
          {followed ? "★" : "☆"}<span className="focus-bar__word"> {followed ? "Saved" : "Save"}</span>
        </Button>
        <Button size="sm" onClick={onShowAll}>{text.showAll}</Button>
      </div>
      {!followed && blocked && <p className="note focus-bar__note">{blocked}</p>}
    </div>
  );
}
