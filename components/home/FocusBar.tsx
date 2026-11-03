"use client";

import { focusBarText } from "@/lib/home/focus.mjs";
import { useFollow } from "@/lib/map/follow-store";

type BarText = { title: string; showAll: string; follow: string; lock: { off: string; on: string } };
const textOf = focusBarText as (name: string, isFollowed: boolean, total: number) => BarText;

interface Props {
  name: string;
  followed: boolean;
  /** Why following is blocked (the cap), shown instead of following. */
  blocked: string | null;
  onToggleFollow: () => void;
  /** "page" on a satellite page (camera lock, Details, Close); "home" for a pasted satellite on home (Show all). */
  mode: "page" | "home";
  onClose: () => void;
  /** How many satellites Show all draws (home mode). */
  total?: number;
  onShowAll?: () => void;
}

function reducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Above the map while one satellite is focused.
export default function FocusBar({ name, followed, blocked, onToggleFollow, mode, onClose, total = 0, onShowAll }: Props) {
  const text = textOf(name, followed, total);
  const locked = useFollow((s) => s.following);
  const setFollowing = useFollow((s) => s.setFollowing);
  return (
    <div className="focus-bar" role="region" aria-label="Focused satellite">
      <p className="focus-bar__title">{text.title}</p>
      <div className="focus-bar__actions">
        <button
          type="button"
          className={`home-chip focus-bar__follow${followed ? " home-chip--on" : ""}`}
          disabled={!followed && Boolean(blocked)}
          onClick={onToggleFollow}
        >
          {text.follow}
        </button>
        {mode === "page" ? (
          <>
            <button
              type="button"
              className={`home-chip${locked ? " home-chip--on" : ""}`}
              aria-pressed={locked}
              onClick={() => setFollowing(!locked)}
            >
              {locked ? text.lock.on : text.lock.off}
            </button>
            <button
              type="button"
              className="home-chip focus-bar__details"
              onClick={() =>
                document.querySelector(".sat-top")?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" })
              }
            >
              Details
            </button>
            <button type="button" className="home-chip focus-bar__close" aria-label="Close details" onClick={onClose}>
              {"×"}
            </button>
          </>
        ) : (
          <button type="button" className="home-chip" onClick={onShowAll}>{text.showAll}</button>
        )}
      </div>
      {!followed && blocked && <p className="focus-bar__note">{blocked}</p>}
    </div>
  );
}
