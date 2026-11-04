"use client";

// A satellite page that could not load: the catalog was unreachable, or this
// object is not in the snapshot and the hourly CelesTrak lookups are used up.
// Next serves no cached copy of a failed render, so trying again is a fresh
// attempt; the map keeps its scene.

import { startTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "@/app/home.css";
import Button from "@/components/ui/Button";
import { linkClass } from "@/lib/ui/classes.mjs";
import NotFoundScene from "./NotFoundScene";

export default function SatError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  // refresh() asks the server again; reset() then re-renders this segment.
  const retry = () => startTransition(() => {
    router.refresh();
    reset();
  });
  return (
    <section className="home">
      <NotFoundScene />
      <h1 className="home-heading">Couldn&apos;t load this satellite</h1>
      <p className="home-note">
        The satellite catalog is busy or out of reach right now. Try again in a minute.
      </p>
      <p className="home-note">
        <Button onClick={retry}>Try again</Button>
      </p>
      <Link className={linkClass()} href="/">Back to SeekSat</Link>
    </section>
  );
}
