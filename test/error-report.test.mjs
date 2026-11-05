import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanReport, errorReport } from '../lib/site/error-report.mjs';

const where = { origin: 'https://seeksat.com', page: 'https://seeksat.com/sat/25544?map=globe&f=145800000#x', userAgent: 'UA' };

test('a report keeps the path, not the query or hash', () => {
  const r = errorReport({ message: 'boom', source: 'https://seeksat.com/_next/static/chunks/a.js?dpl=1', line: 3, col: 9.7, stack: 'Error: boom\n at a' }, where);
  assert.deepEqual(r, { kind: 'error', message: 'boom', source: '/_next/static/chunks/a.js', line: 3, col: 9, stack: 'Error: boom\n at a', page: '/sat/25544', ua: 'UA' });
});

test('noise and other origins are dropped or blanked', () => {
  assert.equal(errorReport({ message: 'Script error.' }, where), null);
  assert.equal(errorReport({ message: 'ResizeObserver loop completed with undelivered notifications.' }, where), null);
  assert.equal(errorReport({ message: 'x', source: 'chrome-extension://abc/content.js' }, where), null);
  assert.equal(errorReport({ message: "TypeError: undefined is not an object (evaluating 'window.ethereum.selectedAddress = undefined')" }, where), null);
  assert.equal(errorReport({ message: 'x', source: 'https://evil.example/a.js' }, where).source, null);
});

test('long fields are trimmed', () => {
  const r = errorReport({ message: 'm'.repeat(1000), stack: Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') }, { ...where, userAgent: 'u'.repeat(500) });
  assert.equal(r.message.length, 300);
  assert.equal(r.stack.split('\n').length, 12);
  assert.equal(r.ua.length, 200);
});

test('the server cleans a posted body again and rejects non-reports', () => {
  assert.equal(cleanReport(null, 'https://seeksat.com'), null);
  assert.equal(cleanReport({ nope: 1 }, 'https://seeksat.com'), null);
  const r = cleanReport({ message: 'boom', page: '/sat/1?x=1', source: '/a.js', line: 1, ua: 'UA', extra: 'dropped' }, 'https://seeksat.com');
  assert.equal(r.page, '/sat/1');
  assert.equal(r.source, '/a.js');
  assert.equal('extra' in r, false);
});
