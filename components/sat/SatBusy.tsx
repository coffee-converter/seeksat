"use client";

// The satellite page when the catalog couldn't answer (lib/sat/busy.ts, and
// the error boundary). The map keeps an empty scene.

import Link from "next/link";
import "@/app/home.css";
import Button from "@/components/ui/Button";
import { linkClass } from "@/lib/ui/classes.mjs";
import NotFoundScene from "@/app/(map)/sat/[id]/NotFoundScene";

export default function SatBusy({ onRetry }: { onRetry?: () => void }) {
  const retry = onRetry ?? (() => window.location.reload());
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
