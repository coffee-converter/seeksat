import { test } from "node:test";
import assert from "node:assert/strict";
import { shareMetadata } from "../../lib/og/og-metadata.mjs";

test("shareMetadata swaps both images, sets robots, keeps the rest", () => {
  const base = {
    title: "T", description: "D",
    alternates: { canonical: "/sat/57166" },
    openGraph: { title: "OT", images: [{ url: "/old.png", width: 1, height: 1 }] },
    twitter: { title: "TT", images: ["/old.png"] },
  };
  const md = shareMetadata(base, { noradId: 57166, blob: "a b+c" });
  const url = "/api/og?s=a%20b%2Bc&id=57166";
  assert.equal(md.openGraph.images[0].url, url);
  assert.equal(md.openGraph.images[0].width, 1200);
  assert.equal(md.openGraph.title, "OT");
  assert.deepEqual(md.twitter.images, [url]);
  assert.equal(md.twitter.title, "TT");
  assert.deepEqual(md.robots, { index: false, follow: true });
  assert.equal(md.alternates.canonical, "/sat/57166");
  assert.equal(md.title, "T");
  assert.equal(md.description, "D");
});
