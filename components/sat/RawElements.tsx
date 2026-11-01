"use client";

import { useRef, useState } from "react";
import type { SatPageData } from "./SatApp";

function Block({ title, text }: { title: string; text: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      const el = ref.current;
      const sel = window.getSelection();
      if (el && sel) {
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  };
  return (
    <div className="sat-raw">
      <div className="sat-raw-head">
        <h3>{title}</h3>
        <button type="button" className="home-button" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre ref={ref}>{text}</pre>
    </div>
  );
}

export default function RawElements({ raw }: { raw: SatPageData["raw"] }) {
  return (
    <section id="raw-elements">
      <h2 className="home-heading">Raw elements</h2>
      {raw.tooBigForTle ? (
        <p className="home-note">
          This catalog number is too big for the TLE format, so only the OMM form exists.
        </p>
      ) : (
        <>
          {raw.twoLine ? <Block title="2LE" text={raw.twoLine} /> : null}
          {raw.threeLine ? <Block title="3LE" text={raw.threeLine} /> : null}
        </>
      )}
      {raw.omm ? <Block title="OMM" text={raw.omm} /> : null}
    </section>
  );
}
