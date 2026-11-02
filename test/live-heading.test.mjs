import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnHint, headingFromOrientation } from '../lib/live/heading.mjs';

test('turnHint takes the short way and names the direction', () => {
  assert.deepEqual(turnHint(10, 350), { deltaDeg: 20, text: 'Turn right 20°' });
  assert.deepEqual(turnHint(350, 10), { deltaDeg: -20, text: 'Turn left 20°' });
  assert.equal(turnHint(100, 95).text, 'Ahead');
  assert.equal(turnHint(180, 5).text, 'Turn around');
});

test('headingFromOrientation reads iOS and absolute orientation', () => {
  assert.equal(headingFromOrientation({ webkitCompassHeading: 42 }), 42);
  assert.equal(headingFromOrientation({ absolute: true, alpha: 90 }), 270);
  assert.equal(headingFromOrientation({ absolute: false, alpha: 90 }), null);
  assert.equal(headingFromOrientation({}), null);
});

test('headingFromOrientation adds the screen angle in landscape', () => {
  assert.equal(headingFromOrientation({ webkitCompassHeading: 300 }, 90), 30);
  assert.equal(headingFromOrientation({ absolute: true, alpha: 90 }, 90), 0);
  assert.equal(headingFromOrientation({ absolute: false, alpha: 90 }, 90), null);
});
