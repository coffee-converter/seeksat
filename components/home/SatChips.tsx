"use client";

import { useEffect, useRef, useState } from "react";
import ChipView from "@/components/ui/Chip";

export interface Chip {
  noradId: number;
  name: string;
  color: string;
  hidden: boolean;
  /** Known radio downlinks, in radio mode. */
  radio?: boolean;
}

/** A selected satellite you do not follow, shown dashed after the others. */
export interface PendingChip {
  noradId: number;
  name: string;
  color: string;
  radio?: boolean;
  /** Why following is blocked (the cap), or null. */
  blocked: string | null;
}

interface Props {
  chips: Chip[];
  pending?: PendingChip | null;
  onFollow?: (noradId: number) => void;
  focusId: number | null;
  /** Tap: focus this one, or null to unfocus the focused chip. */
  onFocus: (noradId: number | null) => void;
  onToggleHidden: (noradId: number) => void;
}

// One chip per followed satellite, laid over the top of the map. The strip
// scrolls sideways inside itself, never the page.
export default function SatChips({ chips, pending = null, onFollow, focusId, onFocus, onToggleHidden }: Props) {
  // Which ends have chips scrolled out of sight ("start", "end"), for the fade.
  const ref = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState("");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      const start = el.scrollLeft > 1;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setMore([start && "start", end && "end"].filter(Boolean).join(" "));
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(check) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      ro?.disconnect();
    };
  }, [chips.length, pending?.noradId]);
  // The dashed chip sits last, where it stays once followed: scrolled into
  // the strip's view when it appears.
  const pendingId = pending?.noradId;
  useEffect(() => {
    if (pendingId == null) return;
    // After layout (and the chip's font) settles: to the strip's very end.
    const id = requestAnimationFrame(() => {
      const el = ref.current;
      if (el) el.scrollLeft = el.scrollWidth;
    });
    return () => cancelAnimationFrame(id);
  }, [pendingId]);
  if (chips.length === 0 && !pending) return null;
  return (
    <ul className="sat-chips" aria-label="Followed satellites" ref={ref} data-more={more || undefined}>
      {chips.map((c) => {
        const focused = c.noradId === focusId;
        return (
          <ChipView
            key={c.noradId}
            color={c.color}
            label={c.name}
            focused={focused}
            hidden={c.hidden}
            radio={c.radio}
            onSelect={() => onFocus(focused ? null : c.noradId)}
            onToggleHidden={() => onToggleHidden(c.noradId)}
          />
        );
      })}
      {pending && (
        <ChipView
          key={`pending-${pending.noradId}`}
          color={pending.color}
          label={pending.name}
          focused={pending.noradId === focusId}
          radio={pending.radio}
          onSelect={() => onFocus(pending.noradId === focusId ? null : pending.noradId)}
          onFollow={() => {
            onFollow?.(pending.noradId);
            // Followed, it becomes the last ordinary chip: focus goes to it.
            requestAnimationFrame(() => {
              const last = ref.current?.lastElementChild?.querySelector<HTMLButtonElement>(".chip__name");
              last?.focus({ preventScroll: true });
            });
          }}
          followBlocked={pending.blocked}
        />
      )}
    </ul>
  );
}
