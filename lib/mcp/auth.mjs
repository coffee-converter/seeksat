// lib/mcp/auth.mjs - pure API-key → tier resolution for the MCP server.
// Dormant by default: with no MCP_PRO_KEYS configured, every caller is
// 'free'. Never returns or logs the raw key - only a masked keyId.

import { createHash } from 'node:crypto';

// Parse the comma-separated MCP_PRO_KEYS env value into a Set of keys.
export function parseProKeys(envValue) {
  if (!envValue) return new Set();
  return new Set(envValue.split(',').map((s) => s.trim()).filter(Boolean));
}

// Resolve a presented key to { tier, keyId }. tier is 'pro' iff the key
// is non-empty and present in proKeys, else 'free'. keyId is a short,
// non-reversible label for logs ('key_' + 6 hex of SHA-256) when a key
// is presented, or null when the caller is anonymous.
export function resolveTier(presentedKey, proKeys) {
  const key = presentedKey && presentedKey.trim();
  if (!key) return { tier: 'free', keyId: null };
  const keyId = 'key_' + createHash('sha256').update(key).digest('hex').slice(0, 6);
  return { tier: proKeys.has(key) ? 'pro' : 'free', keyId };
}
