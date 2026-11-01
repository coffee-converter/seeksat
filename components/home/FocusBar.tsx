"use client";

import Link from "next/link";
import { focusBarText } from "@/lib/home/focus.mjs";

type BarText = { title: string; showAll: string; follow: string };
const textOf = focusBarText as (name: string, isFollowed: boolean, total: number) => BarText;

interface Props {
  name: string;
  followed: boolean;
  /** Why following is blocked (the cap), shown instead of following. */
  blocked: string | null;
  /** How many satellites Show all draws. */
  total: number;
  /** The satellite's page, or null where there is none or it is this page. */
  pageHref: string | null;
  onToggleFollow: () => void;
  onShowAll: () => void;
}

// Above the map while one satellite is focused.
export default function FocusBar({ name, followed, blocked, total, pageHref, onToggleFollow, onShowAll }: Props) {
  const text = textOf(name, followed, total);
  return (
    <div className="focus-bar" role="region" aria-label="Focused satellite">
      <p className="focus-bar__title">{text.title}</p>
      <div className="focus-bar__actions">
        <button
          type="button"
          className="home-chip focus-bar__follow"
          aria-pressed={followed}
          disabled={!followed && Boolean(blocked)}
          onClick={onToggleFollow}
        >
          {text.follow}
        </button>
        {pageHref && <Link className="home-chip" href={pageHref}>Open page</Link>}
        <button type="button" className="home-chip" onClick={onShowAll}>{text.showAll}</button>
      </div>
      {!followed && blocked && <p className="focus-bar__note">{blocked}</p>}
    </div>
  );
}
