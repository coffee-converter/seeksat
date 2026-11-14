// app/(map)/shared-view/page.tsx - the home page as opened from a shared map
// view (/?map=...): middleware.ts routes those here so this page can name a
// share image of that view, while the plain home page stays statically built.
// The address bar keeps the shared link; the view itself is read on the client.
import type { Metadata } from "next";
import HomePage from "../page";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    if (typeof v === "string") params.set(k, v);
  }
  const image = `/api/og/view?${params.toString()}`;
  return {
    title: "A shared satellite map",
    openGraph: { images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", images: [image] },
    robots: { index: false, follow: true },
    alternates: { canonical: "/" },
  };
}

export default function SharedView() {
  return <HomePage />;
}
