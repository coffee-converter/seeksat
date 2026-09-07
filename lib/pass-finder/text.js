// lib/pass-finder/text.js - small string helpers shared across chart, CSV
// and filename code. Domain-neutral on purpose: the sky-chart export path
// needs the slug too, and it has nothing to do with radio.

/** Greedy word wrap to a character budget. Never splits a word, even one
 *  longer than the budget - a truncated identifier is worse than a ragged
 *  line. Collapses runs of whitespace. */
export function wrapText(text, maxChars) {
  const out = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (!line) { line = word; continue; }
    if (line.length + 1 + word.length <= maxChars) line += ` ${word}`;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}

/** Filename-safe slug: lowercase, non-alphanumerics collapsed to hyphens,
 *  no leading or trailing hyphen. Shared so the satellite and observer parts
 *  of an export filename cannot be slugged two different ways. */
export function slug(text, fallback = "unknown") {
  const out = String(text ?? "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return out || fallback;
}
