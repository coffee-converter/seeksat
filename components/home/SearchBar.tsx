"use client";

import { useEffect, useId, useRef, useState } from "react";
import { searchQuery, searchUrl } from "@/lib/home/search.mjs";
import { followBlockedMessage } from "@/lib/home/actions.mjs";
import { followLabel } from "@/lib/home/focus.mjs";
import { useHomeStore } from "@/lib/home/store";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import RadioMark from "@/components/ui/RadioMark";

interface Result {
  noradId: number;
  name: string;
  /** Known radio downlinks, and the bands they are in (lib/radio/bands.mjs). */
  radio?: boolean;
  bands?: string[];
  /** How well the name matched, lower is better (lib/mirror/fuzzy.mjs rankHits). */
  tier?: number;
}
type Status = "idle" | "loading" | "done" | "error";

const DEBOUNCE_MS = 250;

interface Props {
  /** View a result: focus it on the map (search means view, not follow). */
  onView: (noradId: number) => void;
  /** Esc in an empty search with the list closed: leave focus. */
  onClearFocus: () => void;
}

export function SearchBar({ onView, onClearFocus }: Props) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [text, setText] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [queried, setQueried] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [limitError, setLimitError] = useState<string | null>(null);

  const following = useHomeStore((s) => s.prefs.following);
  // Radio mode ranks satellites with known downlinks first and marks them.
  const mode = useHomeStore((s) => s.prefs.mode);
  const myBands = useHomeStore((s) => s.prefs.bands);
  // Radio mode: a result counts as radio only with a downlink this radio can hear.
  const hearable = (r: Result) => r.radio === true && (myBands == null || (r.bands ?? []).some((b) => myBands.includes(b)));
  // Hearable ones first among equally good name matches: a better match (SDO
  // for "sdo") stays above weaker ones this radio can hear. Stable, so the
  // server's order holds inside a group.
  const shown = mode === "radio"
    ? [...results].sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || (hearable(a) ? 0 : 1) - (hearable(b) ? 0 : 1))
    : results;
  const follow = useHomeStore((s) => s.follow);
  const unfollow = useHomeStore((s) => s.unfollow);
  const addCustom = useHomeStore((s) => s.addCustom);
  const hydrate = useHomeStore((s) => s.hydrate);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    hydrate();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      abort.current?.abort();
    };
  }, [hydrate]);

  function onChange(value: string) {
    setText(value);
    setActive(-1);
    setLimitError(null);
    setResults([]);
    if (timer.current) clearTimeout(timer.current);
    abort.current?.abort();
    const q = searchQuery(value);
    if (!q) {
      setStatus("idle");
      setOpen(false);
      return;
    }
    setOpen(true);
    setStatus("loading");
    timer.current = setTimeout(async () => {
      const ctl = new AbortController();
      abort.current = ctl;
      try {
        const res = await fetch(searchUrl(q, mode), { signal: ctl.signal });
        if (ctl.signal.aborted) return;
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { results: Result[] };
        if (ctl.signal.aborted) return;
        setResults(body.results);
        setQueried(q);
        setStatus("done");
      } catch (e) {
        if (ctl.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        setResults([]);
        setStatus("error");
      }
    }, DEBOUNCE_MS);
  }

  // The star: follow or unfollow, keeping the list open.
  function toggleFollow(r: Result) {
    if (following.includes(r.noradId)) {
      setLimitError(null);
      unfollow(r.noradId);
      return;
    }
    // At the cap, following would do nothing: say so.
    const blocked = followBlockedMessage(following, r.noradId);
    if (blocked) {
      setLimitError(blocked);
      return;
    }
    follow(r.noradId);
  }

  function choose(r: Result) {
    if (timer.current) clearTimeout(timer.current);
    abort.current?.abort();
    onView(r.noradId);
    setLimitError(null);
    setOpen(false);
    setText("");
    setResults([]);
    setStatus("idle");
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      // Nothing left for Esc to close here: it leaves focus instead.
      if (!open && text === "") onClearFocus();
      setOpen(false);
      setActive(-1);
      setLimitError(null);
    } else if (e.key === "ArrowDown" && results.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp" && results.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter" && open) {
      const r = shown[active >= 0 ? active : 0];
      if (r) {
        e.preventDefault();
        choose(r);
      }
    }
  }

  function onAdd() {
    const out = addCustom(pasted);
    if (out.ok) {
      setPasted("");
      setPasteError(null);
      setPasteOpen(false);
    } else {
      setPasteError(out.message);
    }
  }

  const showList = open && status !== "idle";
  const listVisible = showList && results.length > 0;

  useEffect(() => {
    if (active >= 0) document.getElementById(`${uid}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, uid]);

  return (
    <div
      className="search-bar"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
          setActive(-1);
          setLimitError(null);
        }
      }}
    >
      <div className="search-bar__row">
        <Field label="Search satellites" hideLabel>
          <input
            type="search"
            role="combobox"
            aria-expanded={listVisible}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${uid}-opt-${active}` : undefined}
            placeholder="Name or NORAD ID"
            autoComplete="off"
            value={text}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => text && setOpen(true)}
          />
        </Field>
        <Button
          className="search-bar__paste-button"
          aria-expanded={pasteOpen}
          aria-label="Paste elements"
          title="Paste elements"
          onClick={() => setPasteOpen((v) => !v)}
        >
          <span className="search-bar__paste-full" aria-hidden="true">Paste elements</span>
          <span className="search-bar__paste-short" aria-hidden="true">+</span>
        </Button>
      </div>

      {/* Everything under the input row. In the map shell's top bar it drops
          down over the page, so the bar keeps its height. */}
      <div className="search-bar__below">
      <ul
        id={listId}
        role="listbox"
        aria-label="Search results"
        className="search-bar__list"
        hidden={!listVisible}
      >
        {shown.map((r, i) => {
          const followed = following.includes(r.noradId);
          return (
            <li
              key={r.noradId}
              id={`${uid}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className="search-bar__option"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(r)}
            >
              <span className="search-bar__name">
                {r.name} <span className="search-bar__id">{r.noradId}</span>
                {mode === "radio" && hearable(r) && <RadioMark className="search-bar__radio" label="known downlinks" />}
              </span>
              {/* Out of the tab order: the focus bar has the same toggle for keyboards. */}
              <Button
                variant="quiet"
                iconOnly
                tabIndex={-1}
                className="search-bar__star"
                aria-label={followLabel(r.name, followed)}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFollow(r);
                }}
              >
                <span className={`search-bar__star-glyph${followed ? " search-bar__star-glyph--on" : ""}`} aria-hidden="true">
                  {followed ? "\u2605" : "\u2606"}
                </span>
              </Button>
            </li>
          );
        })}
      </ul>
      {showList && limitError && (
        <p className="search-bar__error" role="alert">
          {limitError}
        </p>
      )}
      {showList && status === "done" && results.length === 0 && (
        <p className="search-bar__note">No satellites match &quot;{queried}&quot;.</p>
      )}
      {showList && status === "error" && (
        <p className="search-bar__note" role="alert">
          Search isn&apos;t available right now.
        </p>
      )}

      {pasteOpen && (
        <div className="search-bar__paste">
          <Field label="Paste a 2LE or 3LE element set" error={pasteError ?? undefined}>
            <textarea
              id={`${uid}-paste`}
              className="search-bar__tle"
              rows={4}
              spellCheck={false}
              value={pasted}
              onChange={(e) => {
                setPasted(e.target.value);
                setPasteError(null);
              }}
            />
          </Field>
          <Button className="search-bar__add" onClick={onAdd}>
            Add
          </Button>
        </div>
      )}
      </div>
    </div>
  );
}
