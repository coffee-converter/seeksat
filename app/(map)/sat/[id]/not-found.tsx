import Link from "next/link";
import "@/app/home.css";
import { linkClass } from "@/lib/ui/classes.mjs";
import NotFoundScene from "./NotFoundScene";

export default function NotFound() {
  return (
    <section className="home">
      <NotFoundScene />
      <h1 className="heading-page">Satellite not found</h1>
      <p className="note">
        That satellite isn&apos;t in our catalog. It may have come down, or the number may be wrong.
      </p>
      <Link className={linkClass()} href="/">Back to SeekSat</Link>
    </section>
  );
}
