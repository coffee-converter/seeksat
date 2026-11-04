// Guard: the pass engine is satellite-neutral. No export of the pure
// pass modules may carry an ISS-specific name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'lib/pass-finder');

// These really do fetch the ISS (home-page preview, triangulate page).
const ALLOWED = new Set(['fetchIssTle', 'getIssTle']);

// Modules that cannot be imported under node at all go here, with a reason.
const UNIMPORTABLE = new Set([]);

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !UNIMPORTABLE.has(f))
  .map((f) => path.join(dir, f));
files.push(path.join(root, 'lib/mcp/passes.mjs'));

for (const file of files) {
  test(`no ISS-specific exports: ${path.relative(root, file)}`, async () => {
    const mod = await import(pathToFileURL(file).href);
    const bad = Object.keys(mod).filter((k) => /iss/i.test(k) && !ALLOWED.has(k));
    assert.deepEqual(bad, []);
  });
}
