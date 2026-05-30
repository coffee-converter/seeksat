import { test } from "node:test";
import assert from "node:assert/strict";
import { ogResponse } from "../../lib/og/og-response.mjs";

test("missing ?s redirects (302) to /og.png", async () => {
  const res = await ogResponse(new Request("https://seeksat.com/api/og"));
  assert.equal(res.status, 302);
  assert.equal(new URL(res.headers.get("location"), "https://seeksat.com").pathname, "/og.png");
});

test("malformed ?s redirects (302) to /og.png", async () => {
  const res = await ogResponse(new Request("https://seeksat.com/api/og?s=%%%not-base64%%%"));
  assert.equal(res.status, 302);
});
