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
  const md = shareMetadata(base, { noradId: 57166, blob: "a b+c", name: "METEOR-M2 3" });
  const url = "/api/og?s=a%20b%2Bc&id=57166";
  assert.equal(md.openGraph.images[0].url, url);
  assert.equal(md.openGraph.images[0].width, 1200);
  assert.equal(md.openGraph.title, "OT");
  assert.equal(md.openGraph.url, "/sat/57166/share/a b+c");
  const alt = "A METEOR-M2 3 pass on a globe: its track, the part you can see, and the place it is seen from";
  assert.equal(md.openGraph.images[0].alt, alt);
  assert.deepEqual(md.twitter.images, [{ url, alt }]);
  assert.equal(md.twitter.title, "TT");
  assert.deepEqual(md.robots, { index: false, follow: true });
  assert.equal(md.alternates.canonical, "/sat/57166");
  assert.equal(md.title, "T");
  assert.equal(md.description, "D");
});

test('a shared pass is titled and described as that pass, from that place, at its time there', async () => {
  const { sharedPassText, shareMetadata } = await import('../../lib/og/og-metadata.mjs');
  const shared = { observers: [{ name: 'Chicago', latDeg: 41.88, lonDeg: -87.63 }], passTimeMs: Date.parse('2026-11-14T14:28:00Z'), mode: 'visual' };
  const t = sharedPassText({ satName: 'SAUDISAT 1C (SO-50)', shortName: 'SO-50', shared });
  assert.equal(t.title, 'SO-50 pass from Chicago, Sat 8:28 AM');
  assert.match(t.description, /^SO-50 from Chicago, Sat 8:28 AM: when and where to look/);
  // "My location" from an older link reads as coordinates; radio says what radio gets.
  const mine = sharedPassText({ satName: 'SAUDISAT 1C (SO-50)', shared: { ...shared, observers: [{ name: 'My location', latDeg: 41.99, lonDeg: -88.19 }], mode: 'radio' } });
  assert.equal(mine.title, 'SO-50 pass from 42.0°N, 88.2°W, Sat 8:28 AM');
  assert.match(mine.description, /Doppler/);
  const md = shareMetadata({ title: 'T', openGraph: {}, twitter: {}, alternates: {} }, { noradId: 27607, blob: 'b', name: 'SAUDISAT 1C (SO-50)', shortName: 'SO-50', shared });
  assert.equal(md.title, t.title);
  assert.equal(md.openGraph.title, t.title);
  assert.equal(md.twitter.description, t.description);
});
