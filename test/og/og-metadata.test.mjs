import { test } from "node:test";
import assert from "node:assert/strict";
import { ogImageMetadata } from "../../lib/og/og-metadata.mjs";

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
