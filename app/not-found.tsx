import type { Metadata } from "next";
import Link from "next/link";
import "@/app/home.css";
import { linkClass } from "@/lib/ui/classes.mjs";

export const metadata: Metadata = {
  title: "Page not found",
  description: "There's nothing at this address on SeekSat.",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main className="home not-found">
      <Link className="home-wordmark" href="/"><span className="home-wordmark__seek">Seek</span>Sat</Link>
      <h1 className="heading-page">Page not found</h1>
      <p className="note">There&apos;s nothing at this address.</p>
      <Link className={linkClass()} href="/">Back to SeekSat</Link>
    </main>
  );
}
