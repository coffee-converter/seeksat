// lib/mcp/inputs.mjs - tool inputs as the handlers take them: an old
// parameter name still works as an alias of the new one, and numbers are
// range-checked with a clear error. The zod schemas (tool-specs.mjs) check
// the same ranges for MCP calls; this covers callers that skip them.

/** The first of `names` the input has a value for. */
export function pick(input, ...names) {
  for (const n of names) if (input?.[n] != null) return input[n];
  return undefined;
}

/**
 * A number input under any of `names` (the first is the one to use, the
 * rest are old names), `def` when absent. Throws when it is not a number in
 * range: min to max, above min when minExclusive, whole when integer.
 */
export function numberInput(input, names, { def, min, max, minExclusive = false, integer = false, unit = '' }) {
  const v = pick(input, ...names);
  if (v == null) return def;
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  const ok = typeof n === 'number' && Number.isFinite(n)
    && (minExclusive ? n > min : n >= min) && n <= max
    && (!integer || Number.isInteger(n));
  if (!ok) {
    const range = minExclusive ? `more than ${min} and at most ${max}` : `${min} to ${max}`;
    throw new Error(`${names[0]} must be ${integer ? 'a whole number ' : ''}${range}${unit} (got ${JSON.stringify(v)})`);
  }
  return n;
}
