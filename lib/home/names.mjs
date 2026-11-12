// lib/home/names.mjs - the display name for a satellite id.

import { CATALOG } from '../catalog.mjs';

/** Catalog short name, then the fetched record's name, then a pasted
 *  satellite's name, then "NORAD {id}".
 *  @param {number} id
 *  @param {{ records: Map<number, { name?: string }>, custom: Array<{ noradId: number, name: string }> }} from */
export function satName(id, { records, custom }) {
  return CATALOG.find((s) => s.noradId === id)?.shortName
    ?? records.get(id)?.name
    ?? custom.find((c) => c.noradId === id)?.name
    ?? `NORAD ${id}`;
}
