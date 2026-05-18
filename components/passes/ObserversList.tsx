"use client";

import { usePassFinderStore } from "@/lib/pass-finder-store";
import ObserverCard from "./ObserverCard";

// Renders one ObserverCard per observer in the store. The scene
// subscribes to store.observers separately for Cesium-entity
// reconciliation.
export default function ObserversList() {
  const observers = usePassFinderStore((s) => s.observers);
  return (
    <div id="obs-list">
      {observers.map((obs) => (
        <ObserverCard key={obs.id} obs={obs} />
      ))}
    </div>
  );
}
