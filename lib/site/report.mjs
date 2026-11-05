// lib/site/report.mjs - a notice for the error log: something the page caught
// and fixed itself but should not have happened, so it is seen. ErrorReporter
// (components/ErrorReporter.tsx) sends it, under the same per-load cap.

export const REPORT_EVENT = 'seeksat:report';

/** Send a notice. Never throws. */
export function reportNotice(message) {
  try {
    window.dispatchEvent(new CustomEvent(REPORT_EVENT, { detail: { kind: 'notice', message: String(message) } }));
  } catch {
    // no window (server) or no CustomEvent: nothing to send
  }
}
