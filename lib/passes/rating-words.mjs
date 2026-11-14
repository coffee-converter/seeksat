// lib/passes/rating-words.mjs - what a rating is based on, in plain words,
// one sentence set per mode. Written from the rating code, not from memory:
//   radio  (lib/passes/quality.mjs): only the pass's highest point, in
//          bands at 10, 20, 40 and 60 degrees.
//   visual (lib/sky/visual-rating.mjs): the satellite's peak magnitude
//          against the faintest star the sky type and Sun height allow,
//          stepped down by cloud. A satellite of unknown size gets a cautious
//          guessed magnitude and stops at Fair. With no magnitude at all it
//          falls back to the pass height and the Sun.
// The popover on an open row and the About section both read these.

export const RATING_WORDS = {
  radio: 'Based on how high the pass climbs. Higher passes are longer and closer, so easier to receive.',
  visual: 'Based on how bright the satellite gets against how dark your sky is, then cloud. When its size isn\'t known, the brightness is a cautious guess and the rating stops at Fair.',
};

/** The explainer for a mode. */
export const ratingWords = (mode) => (mode === 'visual' ? RATING_WORDS.visual : RATING_WORDS.radio);
