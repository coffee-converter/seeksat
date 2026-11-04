// lib/site/feedback.mjs - where feedback goes, for the footer and About.

export const FEEDBACK_EMAIL = 'coffee.becomes.code@gmail.com';

/** A mailto link with a subject, and the page it was sent from in the body
 *  when given (an absolute URL with no query, so no shared view comes along).
 *  @param {string | null} [pageUrl] */
export function feedbackHref(pageUrl = null) {
  const params = new URLSearchParams({ subject: 'SeekSat feedback' });
  if (pageUrl) params.set('body', `\n\n(Sent from ${pageUrl})`);
  // mailto wants %20, not +, for spaces.
  return `mailto:${FEEDBACK_EMAIL}?${params.toString().replace(/\+/g, '%20')}`;
}
