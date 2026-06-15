// lib/onboarding/tour.js — onboarding tour content + show-once logic.
// Pure: storage is injectable so the gating is unit-testable without a
// browser, and unavailable storage (private mode / SSR) degrades to
// "don't show" without throwing.

// Versioned: bump the suffix to re-trigger the tour after a material change.
export const STORAGE_KEY = 'seeksat_onboarding_v1';

// Ordered steps. A step with no `element` renders as a centered modal.
// Selectors target existing PassFinderApp anchors.
export const TOUR_STEPS = [
  {
    title: 'Welcome to SeekSat',
    description: 'A 30-second tour of how to see when satellites pass over you.',
  },
  {
    element: '#satellite-details',
    title: 'Pick a satellite',
    description: 'Defaults to the ISS — five to choose from, from bright stations to a polar weather sat.',
  },
  {
    element: '#observers-details',
    title: 'Set your location',
    description: 'Click the globe, or add an observer station, to choose where you are watching from.',
  },
  {
    element: '#windows-section',
    title: 'Your passes',
    description: 'Upcoming passes appear here, each scored by how good a view it is.',
  },
  {
    element: '.passes-controls',
    title: 'Tune the search',
    description: 'Switch between visual and radio passes, and set a minimum elevation.',
  },
  {
    element: '#bottom-controls',
    title: 'Watch it fly',
    description: 'Scrub time to follow a pass across the sky. Building an agent? Query all of this over our MCP — the ⓘ button, top-right.',
  },
];

// window.localStorage when usable, else null. Probes with a write because
// Safari private mode exposes localStorage but throws on setItem.
export function safeLocalStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const probe = '__seeksat_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

export function shouldShowTour(storage = safeLocalStorage()) {
  if (!storage) return false;
  try {
    return storage.getItem(STORAGE_KEY) == null;
  } catch {
    return false;
  }
}

export function markTourDone(storage = safeLocalStorage()) {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, '1');
  } catch {
    /* storage full / blocked — silently skip */
  }
}
