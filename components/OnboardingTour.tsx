"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePassFinderStore } from "@/lib/pass-finder-store";
import { TOUR_STEPS, shouldShowTour, markTourDone } from "@/lib/onboarding/tour.js";
import "driver.js/dist/driver.css";

// Renders nothing; orchestrates the driver.js onboarding tour. Auto-starts
// once on first visit after the page loader has faded, and re-starts on a
// `seeksat:start-tour` window event (the About pane's "Replay" link).
export default function OnboardingTour() {
  const firstSearchComplete = usePassFinderStore((s) => s.firstSearchComplete);
  const startedRef = useRef(false);

  const startTour = useCallback(async () => {
    // Mark done on open: seeing the tour counts, so closing early won't
    // re-trigger it next load. Replay always works via the event.
    markTourDone();
    try {
      const { driver } = await import("driver.js");
      const steps = TOUR_STEPS
        .filter((s) => !s.element || document.querySelector(s.element))
        .map((s) => ({
          element: s.element,
          popover: { title: s.title, description: s.description },
        }));
      if (steps.length === 0) return;
      driver({ showProgress: true, popoverClass: "driverjs-theme", steps }).drive();
    } catch {
      /* driver.js failed to load - no tour, no crash */
    }
  }, []);

  // Auto-start once: when the loader has faded (firstSearchComplete), or
  // after a fallback delay so the tour still appears if no search runs.
  useEffect(() => {
    if (startedRef.current || !shouldShowTour()) return;
    const begin = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      startTour();
    };
    if (firstSearchComplete) {
      begin();
      return;
    }
    const fallback = setTimeout(begin, 6000);
    return () => clearTimeout(fallback);
  }, [firstSearchComplete, startTour]);

  // Replay on demand (About pane dispatches this).
  useEffect(() => {
    const onReplay = () => startTour();
    window.addEventListener("seeksat:start-tour", onReplay);
    return () => window.removeEventListener("seeksat:start-tour", onReplay);
  }, [startTour]);

  return null;
}
