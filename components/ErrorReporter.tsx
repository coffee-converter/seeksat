"use client";

import { useEffect } from "react";
import { errorReport, MAX_REPORTS, REPORT_PATH } from "@/lib/site/error-report.mjs";

// Sends uncaught errors and unhandled promise rejections to the server log,
// so a page that breaks in someone else's browser is seen. A few per page
// load at most, each distinct one once.
export default function ErrorReporter() {
  useEffect(() => {
    const seen = new Set<string>();
    const send = (e: { message?: string; source?: string; line?: number; col?: number; stack?: string; kind?: string }) => {
      if (seen.size >= MAX_REPORTS) return;
      const report = errorReport(e, { origin: location.origin, page: location.href, userAgent: navigator.userAgent });
      if (!report) return;
      const key = `${report.message}|${report.source}|${report.line}`;
      if (seen.has(key)) return;
      seen.add(key);
      const body = JSON.stringify(report);
      try {
        if (navigator.sendBeacon?.(REPORT_PATH, new Blob([body], { type: "application/json" }))) return;
      } catch {
        // fall through to fetch
      }
      void fetch(REPORT_PATH, { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {});
    };
    const onError = (ev: ErrorEvent) =>
      send({ message: ev.message, source: ev.filename, line: ev.lineno, col: ev.colno, stack: ev.error?.stack });
    const onRejection = (ev: PromiseRejectionEvent) => {
      const r = ev.reason;
      send({ kind: "rejection", message: r instanceof Error ? r.message : String(r), stack: r instanceof Error ? r.stack : undefined });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
