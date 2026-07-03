// lib/mcp/request-context.mjs - AsyncLocalStorage carrying the resolved
// { tier, keyId } for the current MCP request, so the statically-
// registered tool callbacks can read per-request auth without rebuilding
// the handler. ALS propagates through awaited promises (Node guarantee),
// so it survives mcp-handler's async tool dispatch.

import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();
const DEFAULT = { tier: 'free', keyId: null };

export function runWithRequestContext(ctx, fn) {
  return als.run(ctx, fn);
}

// Defaults to free/anonymous when called outside any scope (e.g. a unit
// test importing a handler), so tools degrade safely.
export function getRequestContext() {
  return als.getStore() ?? DEFAULT;
}
