"use client";

export interface Chip {
  noradId: number;
  name: string;
  color: string;
  hidden: boolean;
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
  if (chips.length === 0) return null;
  return (
    <ul className="sat-chips" aria-label="Followed satellites">
      {chips.map((c) => {
        const focused = c.noradId === focusId;
        return (
          <li
            key={c.noradId}
            className={`sat-chip${c.hidden ? " sat-chip--hidden" : ""}${focused ? " sat-chip--focus" : ""}`}
            style={{ "--sat-color": c.color } as React.CSSProperties}
          >
            <button
              type="button"
              className="sat-chip__name"
              aria-pressed={focused}
              onClick={() => onFocus(focused ? null : c.noradId)}
            >
              <span className="sat-chip__dot" aria-hidden="true" />
              {c.name}
            </button>
            <button
              type="button"
              className="sat-chip__eye"
              aria-label={c.hidden ? `Show ${c.name} on the map` : `Hide ${c.name} on the map`}
              title={c.hidden ? "Show on the map" : "Hide on the map"}
              onClick={() => onToggleHidden(c.noradId)}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M1 8s2.6-5 7-5 7 5 7 5-2.6 5-7 5-7-5-7-5z" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <circle cx="8" cy="8" r="2" fill="currentColor" />
                {c.hidden && <path d="M2 14 14 2" stroke="currentColor" strokeWidth="1.4" />}
              </svg>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
