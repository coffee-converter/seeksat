import { test } from "node:test";
import assert from "node:assert/strict";
import { ogImageMetadata, shareMetadata } from "../../lib/og/og-metadata.mjs";

test("ogImageMetadata points og/twitter image at /api/og when s present", () => {
  const md = ogImageMetadata("ABC-123");
  assert.equal(md.openGraph.images[0].url, "/api/og?s=ABC-123");
  assert.equal(md.openGraph.images[0].width, 1200);
  assert.equal(md.openGraph.images[0].height, 630);
  assert.equal(md.twitter.images[0], "/api/og?s=ABC-123");
});

test("ogImageMetadata encodes the blob and returns empty when no s", () => {
  assert.match(ogImageMetadata("a b+c").openGraph.images[0].url, /\/api\/og\?s=a%20b%2Bc/);
  assert.deepEqual(ogImageMetadata(undefined), {});
  assert.deepEqual(ogImageMetadata(""), {});
});

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
