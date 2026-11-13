import Link from "next/link";
import "@/app/home.css";
import { linkClass } from "@/lib/ui/classes.mjs";

export default function NotFound() {
  return (
    <main className="home">
      <h1 className="heading-page">Page not found</h1>
      <p className="note">There&apos;s nothing at this address.</p>
      <Link className={linkClass()} href="/">Back to SeekSat</Link>
    </main>
  );
}
