import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXTS = ['', '.ts', '.tsx', '.js', '.mjs'];

export function resolveSpec(spec, fromFile) {
  const base = spec.startsWith('@/')
    ? path.join(ROOT, spec.slice(2))
    : path.resolve(path.dirname(fromFile), spec);
  const candidates = [];
  for (const e of EXTS) candidates.push(base + e);
  for (const e of EXTS.slice(1)) candidates.push(path.join(base, 'index' + e));
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

// Static module specifiers: import ... from, side-effect imports, export ... from.
// `import type` lines are skipped. With { lazy: true }, import('x') expressions
// and new URL('x', import.meta.url) worker targets are included too.
export function staticSpecs(src, { lazy = false } = {}) {
  const specs = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[2]) continue;
    specs.push(m[3]);
  }
  if (lazy) {
    const dyn = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = dyn.exec(src))) specs.push(m[1]);
    const url = /new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;
    while ((m = url.exec(src))) specs.push(m[1]);
  }
  return specs;
}

// Local files reachable from entry, plus every package specifier they import.
export function walk(entry, opts = {}) {
  const seen = new Set();
  const packages = new Set();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const spec of staticSpecs(src, opts)) {
      if (!spec.startsWith('.') && !spec.startsWith('@/')) { packages.add(spec); continue; }
      const r = resolveSpec(spec, file);
      if (r) stack.push(r);
    }
  }
  return { files: new Set([...seen].map((f) => path.relative(ROOT, f))), packages };
}

export function reachable(entry) {
  return walk(entry).files;
}
