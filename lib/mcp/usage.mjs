// lib/mcp/usage.mjs — per-call usage metering for the MCP. Emits one
// structured JSON line to stdout (Vercel captures stdout as logs); the
// foundation for future metered/paid tiers. Returns the record so it is
// unit-testable without capturing console output. Must never throw into
// the request path.

/** @param {{ tool: string, tier: string, keyId: string | null, satellite?: string | null }} opts */
export function logUsage({ tool, tier, keyId = null, satellite = null }) {
  const record = { evt: 'mcp_tool', tool, tier, keyId, satellite, ts: Date.now() };
  console.log(JSON.stringify(record));
  return record;
}
