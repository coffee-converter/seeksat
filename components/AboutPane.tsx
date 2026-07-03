"use client";

import { useEffect, useRef, useState } from "react";
import { SITE_URL } from "@/lib/site.mjs";
import { mcpUrl, claudeAddCommand, GITHUB_URL } from "@/lib/mcp/discovery.mjs";

// Inconspicuous "i" button near the brand-mark that opens a small modal
// card surfacing the MCP endpoint + a copy-able connect command, with a
// link to the full /mcp docs. Esc and backdrop click close it.
export default function AboutPane() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Keep Tab focus inside the dialog while it's open — aria-modal="true"
  // promises focus containment, so enforce it (no library, just cycle
  // between the first and last focusable controls).
  const trapTab = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const focusable = modalRef.current?.querySelectorAll<HTMLElement>("button, a[href]");
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const onFirst = document.activeElement === first;
    const onLast = document.activeElement === last;
    if (e.shiftKey ? onFirst : onLast) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  };

  useEffect(() => {
    if (!open) return;
    // Focus the dialog itself (not a control) so opening doesn't paint a
    // focus ring on the close button; Tab still moves into the controls.
    modalRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const copyCmd = async () => {
    try {
      await navigator.clipboard?.writeText(claudeAddCommand(SITE_URL));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure origin) — the command stays selectable */
    }
  };

  return (
    <>
      <button
        type="button"
        className="about-button"
        aria-label="About SeekSat and its MCP API"
        title="About SeekSat & its API"
        onClick={() => setOpen(true)}
      >
        i
      </button>
      {open && (
        <div className="about-backdrop" onClick={() => setOpen(false)}>
          <div
            ref={modalRef}
            className="about-modal"
            role="dialog"
            aria-modal="true"
            aria-label="About SeekSat"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={trapTab}
          >
            <button type="button" className="about-close" aria-label="Close" onClick={() => setOpen(false)}>
              ×
            </button>
            <h2 className="about-title"><span className="seek">Seek</span><span className="sat">Sat</span></h2>
            <p>Satellite &amp; ISS pass forecasts — a 3D globe with multi-station overhead timing and per-pass sky charts.</p>

            <h3>Agent-queryable via MCP</h3>
            <p>The same SGP4 + visibility engine is exposed to AI agents over the Model Context Protocol:</p>
            <code className="about-endpoint">{mcpUrl(SITE_URL)}</code>
            <button type="button" className="about-copy" onClick={copyCmd}>
              {copied ? "Copied!" : "Copy connect command"}
            </button>

            <div className="about-footer">
              <a className="about-link" href="/mcp">Full API docs →</a>
              <button
                type="button"
                className="about-link"
                onClick={() => {
                  setOpen(false);
                  window.dispatchEvent(new Event("seeksat:start-tour"));
                }}
              >
                Replay walkthrough
              </button>
              {GITHUB_URL && (
                <a className="about-link" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">Source</a>
              )}
            </div>
            <p className="about-stack">Next.js · Cesium · satellite.js · SGP4</p>
            <p className="about-stack">
              built by{" "}
              <a
                className="about-link"
                href="https://aaronhanson.dev"
                target="_blank"
                rel="noopener"
              >
                Aaron Hanson
              </a>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
