"use client";

import { useState } from "react";

// Copies a deep-linkable URL (observers + mode + active pass) to the
// clipboard. URL construction lives in the scene island (it reads
// state we haven't yet migrated — observers blob, active window
// timestamp); we call into it via window.__passesBuildShareUrl.
export default function ShareButton() {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  const onClick = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const build = (window as any).__passesBuildShareUrl;
    if (typeof build !== "function") return;
    let ok = true;
    try {
      await navigator.clipboard.writeText(build());
    } catch {
      ok = false;
    }
    setStatus(ok ? "copied" : "failed");
    window.setTimeout(() => setStatus("idle"), 1500);
  };

  const title =
    status === "copied" ? "Link copied"
    : status === "failed" ? "Copy failed"
    : "Copy a link to this observer setup";

  return (
    <button
      id="share-btn"
      type="button"
      className={status === "copied" ? "copied" : status === "failed" ? "failed" : ""}
      title={title}
      aria-label="Copy link"
      onClick={onClick}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 17H7a5 5 0 0 1 0-10h2" />
        <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
        <line x1="8" y1="12" x2="16" y2="12" />
      </svg>
    </button>
  );
}
