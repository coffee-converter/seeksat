"use client";

// An unexpected error on a satellite page after it loaded (a client render,
// or a navigation's server render). A catalog that can't answer is handled
// in the page itself (lib/sat/busy.ts): a prerender's throw never reaches here.

import { startTransition } from "react";
import { useRouter } from "next/navigation";
import SatBusy from "@/components/sat/SatBusy";

export default function SatError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  // refresh() asks the server again; reset() then re-renders this segment.
  return <SatBusy onRetry={() => startTransition(() => { router.refresh(); reset(); })} />;
}
