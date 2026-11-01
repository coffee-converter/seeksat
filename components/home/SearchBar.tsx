"use client";

import { useEffect, useId, useRef, useState } from "react";
import { searchQuery, searchUrl } from "@/lib/home/search.mjs";
import { useHomeStore } from "@/lib/home/store";

interface Result {
  noradId: number;
  name: string;
}
type Status = "idle" | "loading" | "done" | "error";

const DEBOUNCE_MS = 250;

export function SearchBar() {
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

  const following = useHomeStore((s) => s.prefs.following);
  const follow = useHomeStore((s) => s.follow);
  const addCustom = useHomeStore((s) => s.addCustom);
  const setSelectedId = useHomeStore((s) => s.setSelectedId);
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
    if (timer.current) clearTimeout(timer.current);
    abort.current?.abort();
    const q = searchQuery(value);
    if (!q) {
      setResults([]);
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
        const res = await fetch(searchUrl(q), { signal: ctl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { results: Result[] };
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

  function choose(r: Result) {
    follow(r.noradId);
    setSelectedId(r.noradId);
    setOpen(false);
    setText("");
    setResults([]);
    setStatus("idle");
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    } else if (e.key === "ArrowDown" && results.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp" && results.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter" && open) {
      const r = results[active >= 0 ? active : 0];
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

  return (
    <div className="search-bar">
      <div className="search-bar__row">
        <input
          className="search-bar__input"
          type="search"
          role="combobox"
          aria-label="Search satellites"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${uid}-opt-${active}` : undefined}
          placeholder="Search by name or NORAD ID"
          autoComplete="off"
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => text && setOpen(true)}
        />
        <button
          type="button"
          className="search-bar__button"
          aria-expanded={pasteOpen}
          onClick={() => setPasteOpen((v) => !v)}
        >
          Paste elements
        </button>
      </div>

      <ul
        id={listId}
        role="listbox"
        aria-label="Search results"
        className="search-bar__list"
        hidden={!showList || results.length === 0}
      >
        {results.map((r, i) => (
          <li
            key={r.noradId}
            id={`${uid}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            className="search-bar__option"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(r)}
          >
            <span>
              {r.name} <span className="search-bar__id">{r.noradId}</span>
            </span>
            {following.includes(r.noradId) && <span className="search-bar__tag">Following</span>}
          </li>
        ))}
      </ul>
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
          <label htmlFor={`${uid}-paste`}>Paste a 2LE or 3LE element set</label>
          <textarea
            id={`${uid}-paste`}
            rows={4}
            spellCheck={false}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          {pasteError && (
            <p className="search-bar__error" role="alert">
              {pasteError}
            </p>
          )}
          <button type="button" className="search-bar__button" onClick={onAdd}>
            Add
          </button>
        </div>
      )}
    </div>
  );
}
