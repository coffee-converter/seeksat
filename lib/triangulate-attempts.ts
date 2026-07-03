// lib/triangulate-attempts.ts - pure data layer for the triangulate
// attempt list. Fetches the read-only manifest from /data/, overlays
// browser-local manifest overrides + user attempts from localStorage,
// and provides helpers for persisting / deleting user attempts.

import type {
  AttemptData,
  AttemptEntry,
  ManifestAttemptEntry,
  UserAttemptEntry,
} from "./types";
import {
  USER_ATTEMPTS_KEY,
  loadManifestOverrides,
  loadUserAttempts,
  saveManifestOverride,
} from "./store";

/** Fetch the manifest of built-in attempts. Falls back to a single
 *  hard-coded entry if the manifest is missing/malformed (matches
 *  legacy behaviour). */
export async function loadManifestAttempts(): Promise<ManifestAttemptEntry[]> {
  try {
    const m: ManifestAttemptEntry[] = await fetch("/data/attempts.json").then(
      (r) => r.json(),
    );
    return m.map((a) => ({ ...a, source: "manifest" as const }));
  } catch {
    return [
      {
        id: "monday",
        label: "Monday",
        file: "monday.json",
        source: "manifest" as const,
      },
    ];
  }
}

/** Resolve an attempt entry to its data payload (observations + tle
 *  + timestamp). User attempts come from localStorage; manifest
 *  attempts are fetched from /data/, then overlaid with any browser-
 *  local override the user has edited. */
export async function fetchAttemptData(
  entry: AttemptEntry | undefined,
): Promise<AttemptData> {
  if (!entry) return { timestampUTC: "", observations: [] };
  if (entry.source === "user") {
    const users = loadUserAttempts();
    const u = users.find((a) => a.id === entry.id);
    if (!u) return { timestampUTC: "", observations: [] };
    return {
      timestampUTC: u.timestampUTC,
      observations: u.observations,
      defaultTle: u.defaultTle,
    };
  }
  const fileData: AttemptData = await fetch(`/data/${entry.file}`).then((r) =>
    r.json(),
  );
  const override = loadManifestOverrides()[entry.id];
  if (override) {
    return {
      ...fileData,
      timestampUTC: override.timestampUTC ?? fileData.timestampUTC,
      observations: override.observations ?? fileData.observations,
      defaultTle:
        override.defaultTle !== undefined
          ? override.defaultTle
          : fileData.defaultTle,
    };
  }
  return fileData;
}

/** Append/overwrite a user attempt in localStorage. */
export function persistUserAttempt(attempt: UserAttemptEntry): void {
  const users = loadUserAttempts();
  const idx = users.findIndex((a) => a.id === attempt.id);
  const next = [...users];
  if (idx >= 0) next[idx] = attempt;
  else next.push(attempt);
  // Re-use saveUserAttempts logic inline so we don't need to export
  // it separately - drops the transient `source` flag before serialise.
  if (typeof localStorage === "undefined") return;
  const serializable = next.map(({ source: _s, ...rest }) => rest);
  localStorage.setItem(USER_ATTEMPTS_KEY, JSON.stringify(serializable));
}

/** Delete a user attempt from localStorage (manifest attempts can't
 *  be deleted; the UI hides the button for them). */
export function deleteUserAttempt(id: string): void {
  if (typeof localStorage === "undefined") return;
  const remaining = loadUserAttempts().filter((a) => a.id !== id);
  const serializable = remaining.map(({ source: _s, ...rest }) => rest);
  localStorage.setItem(USER_ATTEMPTS_KEY, JSON.stringify(serializable));
}

/** Persist the current store state under the right key. User
 *  attempts get the full record; manifest attempts get a partial
 *  override that overlays /data/ on next load. Returns void; caller
 *  is responsible for knowing the source. */
export function persistCurrent(
  id: string,
  source: "manifest" | "user",
  timestampUTC: string,
  observations: AttemptData["observations"],
  defaultTle: AttemptData["defaultTle"] | null,
): void {
  if (source === "user") {
    const users = loadUserAttempts();
    const existing = users.find((a) => a.id === id);
    persistUserAttempt({
      source: "user",
      id,
      label: existing?.label ?? "Untitled",
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      timestampUTC,
      observations,
      defaultTle: defaultTle ?? undefined,
    });
  } else {
    saveManifestOverride(id, {
      timestampUTC,
      observations,
      defaultTle: defaultTle ?? undefined,
    });
  }
}

/** Read ?attempt=… from the URL hash, falling back to the first
 *  entry in the combined list. */
export function pickInitialAttemptId(
  attempts: AttemptEntry[],
): string | null {
  const hash = (typeof location !== "undefined" ? location.hash : "").replace(
    /^#/,
    "",
  );
  const params = new URLSearchParams(hash);
  const id = params.get("attempt");
  return (
    attempts.find((a) => a.id === id)?.id ?? attempts[0]?.id ?? null
  );
}
