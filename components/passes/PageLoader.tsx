"use client";

import { useEffect, useState } from "react";

// Kerbal-style flavor text. The actual loading work happens in
// Cesium + the scene init; these messages just keep the user
// entertained while it grinds. Cycled in random order so the same
// load session never repeats verbatim.
const FLAVOR = [
  "Reticulating ephemeris splines…",
  "Wrangling SGP4 propagators…",
  "Polishing the cosmos…",
  "Apologizing to Tycho Brahe…",
  "Negotiating with the ionosphere…",
  "Bribing satellites for accurate positions…",
  "Convincing photons to arrive on time…",
  "Calibrating refraction correction…",
  "Sweeping cosmic dust off the antenna…",
  "Translating from Keplerian to ECEF…",
  "Warming up the radio receivers…",
  "Asking the moon for permission…",
  "Sampling sub-satellite points…",
  "Looking up your zip code in the celestial sphere…",
  "Tuning Doppler shift…",
  "Filing flight plans with NORAD…",
  "Aligning antenna boresight…",
  "Quantizing photon arrivals…",
  "Refraction-correcting horizon…",
  "Buffering starlight…",
  "Triangulating triangulation…",
  "Asking ISS to slow down…",
  "Counting stars (twice for redundancy)…",
  "Loading two-line elements…",
  "Greasing the orbital mechanics…",
  "Reading the night-sky almanac…",
  "Decoding satellite beacons…",
  "Polishing telescope optics…",
  "Plotting a great-circle path…",
  "Inflating the cubemap…",
];

// Shuffle once per mount so the sequence isn't deterministic between
// loads. (Fisher-Yates; modifies in place.)
function shuffled<T>(arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function PageLoader({ done }: { done: boolean }) {
  // The shuffled order is computed only AFTER mount (in useEffect),
  // never during render. Otherwise server-rendered and client-
  // rendered HTML would disagree on the first message → React
  // hydration error (#418). On the server we render FLAVOR[0], then
  // the client re-orders and re-renders post-hydration.
  const [messages, setMessages] = useState<readonly string[]>(FLAVOR);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setMessages(shuffled(FLAVOR));
  }, []);

  useEffect(() => {
    if (done) return;
    const id = window.setInterval(() => {
      // Loop around if we run out — page is taking a while.
      setIdx((i) => (i + 1) % messages.length);
    }, 1100);
    return () => window.clearInterval(id);
  }, [done, messages.length]);

  return (
    <div id="page-loader" className={done ? "hidden" : ""}>
      <div className="loader-spinner" aria-hidden="true" />
      <span className="loader-label">{messages[idx]}</span>
      <div className="loader-bar" aria-hidden="true">
        <div className="loader-bar-fill" />
      </div>
    </div>
  );
}
