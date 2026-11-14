// lib/sat/json-ld.mjs - structured data for a satellite page. Server only (the
// page renders it); kept out of page-data.mjs, which the browser bundles too.
import { satPath } from './page-data.mjs';

/** A satellite page's structured data: its place in the site (a breadcrumb
 *  trail search results can show). `siteUrl` without a trailing slash. */
export function satJsonLd(data, siteUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'SeekSat', item: `${siteUrl}/` },
      { '@type': 'ListItem', position: 2, name: data.name, item: `${siteUrl}${satPath(data.noradId)}` },
    ],
  };
}
