// lib/home/first-visit.mjs - marks a first visit (no saved location) on <html>
// before first paint, so the home map is drawn at its first-visit height from
// the start (app/home.css). Without it the server's full height shrank once the
// page read storage, and the map's canvas was resized while it loaded.
// HomeApp removes the mark once hydrated; its home-first-visit class takes over.

import { PREFS_KEY } from './prefs.mjs';
import { LS_STATE_KEY } from '../pass-finder/state-blob.js';

export const FIRST_VISIT_ATTR = 'firstVisit';

// Pre-paint script (minified by hand). Home page only. Saved prefs without a
// location, or none at all and no classic-app state to bring over, is a first
// visit; any error is not (the old shrink, nothing worse).
export const FIRST_VISIT_SCRIPT =
  '(function(){try{if(location.pathname!=="/")return;var s=localStorage,p=s.getItem(' + JSON.stringify(PREFS_KEY) + ');' +
  'if(p?JSON.parse(p).location:s.getItem(' + JSON.stringify(LS_STATE_KEY) + '))return;' +
  'document.documentElement.dataset.' + FIRST_VISIT_ATTR + '="1"}catch(e){}})();';
