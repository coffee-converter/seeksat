"use client";

import { usePathname } from "next/navigation";
import { linkClass } from "@/lib/ui/classes.mjs";
import { feedbackHref } from "@/lib/site/feedback.mjs";

/** The foot of the home and satellite pages: where to send feedback. */
export default function SiteFooter() {
  const path = usePathname();
  return (
    <footer className="home-footer">
      <span>
        Found a bug or have an idea?{" "}
        <a className={linkClass()} href={feedbackHref(`https://seeksat.com${path ?? "/"}`)}>Send feedback</a>
      </span>
    </footer>
  );
}
