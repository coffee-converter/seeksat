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

interface Props {
  chips: Chip[];
  focusId: number | null;
  /** Tap: focus this one, or null to unfocus the focused chip. */
  onFocus: (noradId: number | null) => void;
  onToggleHidden: (noradId: number) => void;
}

// One chip per followed satellite, laid over the top of the map. The strip
// scrolls sideways inside itself, never the page.
export default function SatChips({ chips, focusId, onFocus, onToggleHidden }: Props) {
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
  }, [chips.length]);
  if (chips.length === 0) return null;
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
    </ul>
  );
}
