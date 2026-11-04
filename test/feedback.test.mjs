import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEEDBACK_EMAIL, feedbackHref } from '../lib/site/feedback.mjs';

test('feedback mailto: subject, and the page it came from', () => {
  assert.equal(feedbackHref(), `mailto:${FEEDBACK_EMAIL}?subject=SeekSat%20feedback`);
  const href = feedbackHref('https://seeksat.com/sat/25544');
  assert.match(href, /^mailto:coffee\.becomes\.code@gmail\.com\?subject=SeekSat%20feedback&body=/);
  assert.match(decodeURIComponent(href), /\(Sent from https:\/\/seeksat\.com\/sat\/25544\)/);
  assert.doesNotMatch(href, /\+/);
});
