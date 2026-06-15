// lib/mcp/llms-txt.mjs — pure builder for the /llms.txt body. Follows the
// llms.txt convention (plain text, markdown-ish headings + links) and
// points agents at the MCP. Testable without the route.

import { TOOL_SUMMARIES, mcpUrl, claudeAddCommand } from './discovery.mjs';

export function buildLlmsTxt(origin) {
  return [
    '# SeekSat',
    '',
    '> Satellite & ISS pass forecasts. The same SGP4 + visibility engine that',
    '> powers the 3D web app is exposed to AI agents over MCP.',
    '',
    '## MCP server',
    '',
    `Streamable HTTP endpoint: ${mcpUrl(origin)}`,
    '',
    `Add to Claude Code: ${claudeAddCommand(origin)}`,
    '',
    '## Tools',
    '',
    ...TOOL_SUMMARIES.map((t) => `- ${t.name}: ${t.summary}`),
    '',
    '## Docs',
    '',
    `- ${origin}/mcp — human-readable MCP documentation`,
    '',
  ].join('\n');
}
