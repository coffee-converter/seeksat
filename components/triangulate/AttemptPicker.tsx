"use client";

import { FormEvent, useState } from "react";
import { useTriangulateStore } from "@/lib/store";
import {
  fetchAttemptData,
  persistUserAttempt,
  deleteUserAttempt,
} from "@/lib/triangulate-attempts";
import type { Observation } from "@/lib/types";

// Attempt dropdown + new/download/delete buttons + the inline "new
// attempt" form. State (attempts list, currentAttemptId) lives in the
// store; the picker drives selectAttempt + applyAttemptData when the
// user changes selection, and writes through localStorage for new /
// delete. The bootstrap subscribes to currentAttemptId to reframe the
// camera (Phase C will fold that in too).
export default function AttemptPicker() {
  const attempts = useTriangulateStore((s) => s.attempts);
  const currentAttemptId = useTriangulateStore((s) => s.currentAttemptId);
  const currentAttemptSource = useTriangulateStore(
    (s) => s.currentAttemptSource,
  );
  const observations = useTriangulateStore((s) => s.observations);
  const timestampUTC = useTriangulateStore((s) => s.timestampUTC);
  const tle = useTriangulateStore((s) => s.tle);
  const setAttempts = useTriangulateStore((s) => s.setAttempts);
  const setCurrentAttempt = useTriangulateStore((s) => s.setCurrentAttempt);
  const applyAttemptData = useTriangulateStore((s) => s.applyAttemptData);

  const [showNewForm, setShowNewForm] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newUtc, setNewUtc] = useState("");
  const [newCopy, setNewCopy] = useState(false);

  const activeEntry = attempts.find((a) => a.id === currentAttemptId);
  const isUserAttempt = activeEntry?.source === "user";

  const onChangeAttempt = async (id: string) => {
    const entry = attempts.find((a) => a.id === id);
    if (!entry) return;
    const data = await fetchAttemptData(entry);
    // applyAttemptData BEFORE setCurrentAttempt so the bootstrap's
    // subscriber sees fresh observations/timestamp/tle when it reacts
    // to currentAttemptId changing (which triggers a camera reframe).
    applyAttemptData(data);
    setCurrentAttempt(id, entry.source);
    if (typeof history !== "undefined") {
      history.replaceState(null, "", `#attempt=${id}`);
    }
  };

  const openNewForm = () => {
    setNewLabel("");
    setNewUtc(new Date().toISOString());
    setNewCopy(false);
    setShowNewForm(true);
  };

  const onSubmitNew = async (ev: FormEvent) => {
    ev.preventDefault();
    const label = newLabel.trim();
    if (!label) return;
    const slug = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const id = `user-${slug || "attempt"}-${Date.now().toString(36)}`;
    // Deep-clone copied observations and reassign ids so the new
    // attempt doesn't share rows with the source.
    const obs: Observation[] = newCopy
      ? (JSON.parse(JSON.stringify(observations)) as Observation[]).map(
          (o) => ({
            ...o,
            id: `obs-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          }),
        )
      : [];
    persistUserAttempt({
      source: "user",
      id,
      label,
      timestampUTC: newUtc,
      observations: obs,
      createdAt: new Date().toISOString(),
    });
    // Refresh attempts list from disk so the new entry shows up.
    const { loadUserAttempts } = await import("@/lib/store");
    setAttempts([
      ...attempts.filter((a) => a.source !== "user"),
      ...loadUserAttempts(),
    ]);
    setShowNewForm(false);
    await onChangeAttempt(id);
  };

  const onDownload = () => {
    if (!activeEntry) return;
    const exported = {
      timestampUTC,
      observations,
      ...(tle.name.trim() || tle.line1.trim() || tle.line2.trim()
        ? { defaultTle: tle }
        : {}),
    };
    const blob = new Blob([JSON.stringify(exported, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const slug = activeEntry.label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    a.href = url;
    a.download = `${slug || "attempt"}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const onDelete = async () => {
    if (currentAttemptSource !== "user" || !currentAttemptId) return;
    if (
      !confirm(`Delete this attempt? (browser-local only - won't touch data/)`)
    ) {
      return;
    }
    deleteUserAttempt(currentAttemptId);
    const { loadUserAttempts } = await import("@/lib/store");
    const next = [
      ...attempts.filter((a) => a.source !== "user"),
      ...loadUserAttempts(),
    ];
    setAttempts(next);
    if (next[0]) await onChangeAttempt(next[0].id);
  };

  return (
    <>
      <div id="attempt-picker">
        <label htmlFor="attempt-select">Attempt</label>
        <select
          id="attempt-select"
          value={currentAttemptId ?? ""}
          onChange={(e) => onChangeAttempt(e.target.value)}
          title="Switch between triangulation attempts"
        >
          {attempts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.source === "user" ? `${a.label}  (local)` : a.label}
            </option>
          ))}
        </select>
        <button
          id="attempt-new"
          type="button"
          title="Create a new attempt"
          onClick={openNewForm}
        >
          +
        </button>
        <button
          id="attempt-download"
          type="button"
          hidden={!activeEntry}
          title="Download JSON for this attempt"
          onClick={onDownload}
        >
          ⬇
        </button>
        <button
          id="attempt-delete"
          type="button"
          hidden={!isUserAttempt}
          title="Delete this attempt (browser-local only)"
          onClick={onDelete}
        >
          ✕
        </button>
      </div>

      <form id="attempt-new-form" hidden={!showNewForm} onSubmit={onSubmitNew}>
        <label className="af-row">
          <span>Label</span>
          <input
            type="text"
            id="af-label"
            placeholder="e.g. Wednesday evening"
            required
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
          />
        </label>
        <label className="af-row">
          <span>UTC</span>
          <input
            type="text"
            id="af-utc"
            placeholder="2026-05-16T22:35:00Z"
            required
            value={newUtc}
            onChange={(e) => setNewUtc(e.target.value)}
          />
        </label>
        <label className="af-row af-check">
          <input
            type="checkbox"
            id="af-copy"
            checked={newCopy}
            onChange={(e) => setNewCopy(e.target.checked)}
          />
          <span>Copy current observations</span>
        </label>
        <div className="af-actions">
          <button
            type="button"
            id="af-cancel"
            onClick={() => setShowNewForm(false)}
          >
            Cancel
          </button>
          <button type="submit" id="af-create">
            Create
          </button>
        </div>
      </form>
    </>
  );
}
