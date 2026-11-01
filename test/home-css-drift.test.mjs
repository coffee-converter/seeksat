// The home screen carries its own copy of the classic chart-modal styles
// (app/home.css does not load app/pass-finder.css). Until the classic app is
// removed, every copied rule must declare exactly what the classic rule does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** Map of "media | selector" to its merged declarations, later ones winning.
 *  Enough CSS for these files: comments, plain rules and one level of @media. */
function rulesBySelector(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Map();
  const add = (media, selectorText, body) => {
    const decls = {};
    for (const part of body.split(';')) {
      const i = part.indexOf(':');
      if (i < 0) continue;
      decls[part.slice(0, i).trim()] = part.slice(i + 1).trim().replace(/\s+/g, ' ');
    }
    for (const raw of selectorText.split(',')) {
      const key = `${media} | ${raw.trim().replace(/\s+/g, ' ')}`;
      out.set(key, { ...(out.get(key) ?? {}), ...decls });
    }
  };
  let i = 0;
  const walk = (media, end) => {
    while (i < end) {
      const open = src.indexOf('{', i);
      if (open < 0 || open >= end) return;
      const head = src.slice(i, open).trim();
      if (head.startsWith('@media')) {
        let depth = 1;
        let j = open + 1;
        while (depth > 0) {
          if (src[j] === '{') depth++;
          else if (src[j] === '}') depth--;
          j++;
        }
        i = open + 1;
        walk(head.replace(/\s+/g, ' '), j - 1);
        i = j;
      } else {
        const close = src.indexOf('}', open);
        add(media, head, src.slice(open + 1, close));
        i = close + 1;
      }
    }
  };
  walk('', src.length);
  return out;
}

const MODAL = /(#|\.)(polar|radio)-modal/;
const home = rulesBySelector(read('app/home.css'));
const classic = rulesBySelector(read('app/pass-finder.css'));
const copied = [...home.keys()].filter((k) => MODAL.test(k.split(' | ')[1]));

test('home.css still carries the chart modal rules', () => {
  assert.ok(copied.includes(' | #polar-modal'));
  assert.ok(copied.includes(' | #radio-modal'));
  assert.ok(copied.length > 10, `only ${copied.length} modal rules found`);
});

test('each modal rule in home.css declares exactly what pass-finder.css does', () => {
  for (const key of copied) {
    assert.ok(classic.has(key), `${key} has no counterpart in pass-finder.css`);
    assert.deepEqual(home.get(key), classic.get(key), `${key} has drifted`);
  }
});
