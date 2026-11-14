// lib/reception/recency.mjs - how recently SatNOGS stations heard a downlink,
// as a class that ranks (lower first). Pure, no I/O; shared by the radio scan
// and the reception tally (lib/reception/tally.mjs).

export const RECENCY = Object.freeze({ H48: 0, D7: 1, D30: 2, UNKNOWN: 3, SILENT: 4 });
/** No reception data, or none for this downlink: ranked as before. */
export const RECENCY_UNKNOWN = RECENCY.UNKNOWN;
