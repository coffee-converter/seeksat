"use client";

import { focusBarText } from "@/lib/home/focus.mjs";
import { useFollow } from "@/lib/map/follow-store";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";

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
  const following = useFollow((s) => s.following);
  const setFollowing = useFollow((s) => s.setFollowing);
  return (
    <div className={mode === "page" ? "focus-bar focus-bar--page" : "focus-bar"} role="region" aria-label="Focused satellite">
      {/* Phones drop "Viewing" and the star's word (still read out), so the bar is one row. */}
      <p className="focus-bar__title" title={text.title}>
        <span className="focus-bar__lead">Viewing </span>{name}
      </p>
      <div className="focus-bar__actions">
        <Button size="sm" className="focus-bar__follow" on={followed} disabled={!followed && Boolean(blocked)} onClick={onToggleFollow}>
          {followed ? "★" : "☆"}<span className="focus-bar__word"> {followed ? "Following" : "Follow"}</span>
        </Button>
        {mode === "page" ? (
          <>
            <Button size="sm" pressed={following} onClick={() => setFollowing(!following)}>
              {following ? text.lock.on : text.lock.off}
            </Button>
            <Button
              size="sm"
              className="focus-bar__details"
              onClick={() =>
                document.querySelector(".sat-top")?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" })
              }
            >
              Details
            </Button>
            <Button size="sm" iconOnly className="focus-bar__close" aria-label="Close details" onClick={onClose}>
              <Icon name="close" />
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={onShowAll}>{text.showAll}</Button>
        )}
      </div>
      {!followed && blocked && <p className="note focus-bar__note">{blocked}</p>}
    </div>
  );
}
