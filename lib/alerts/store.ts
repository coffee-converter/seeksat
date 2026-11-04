import { ALERTS_KEY, parseAlerts } from "./alerts.mjs";

export interface PassAlert {
  id: string; noradId: number; name: string; startMs: number; peakMs: number;
  maxElevDeg: number; leadMin: number; url: string;
}

/** Same-tab changes; other tabs raise the native "storage" event. */
export const ALERTS_EVENT = "seeksat:alerts";

export function readAlerts(): PassAlert[] {
  try {
    return parseAlerts(window.localStorage.getItem(ALERTS_KEY), window.location.origin) as PassAlert[];
  } catch {
    return [];
  }
}

export function writeAlerts(list: PassAlert[]): void {
  try {
    window.localStorage.setItem(ALERTS_KEY, JSON.stringify(list));
  } catch {
    /* storage blocked: the reminder just isn't kept */
  }
  window.dispatchEvent(new Event(ALERTS_EVENT));
}

/** Calls fn on any change to the list, from this tab or another. */
export function watchAlerts(fn: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === ALERTS_KEY) fn(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener(ALERTS_EVENT, fn);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(ALERTS_EVENT, fn);
  };
}
