import Link from "next/link";
import "@/app/home.css";

export default function NotFound() {
  return (
    <main className="home">
      <h1 className="home-heading">Page not found</h1>
      <p className="home-note">There&apos;s nothing at this address.</p>
      <Link className="home-link" href="/">Back to SeekSat</Link>
    </main>
  );
}
