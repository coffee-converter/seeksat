// lib/mcp/llms-txt.mjs - pure builder for the /llms.txt body. Follows the
// llms.txt convention (plain text, markdown-ish headings + links) and
// points agents at the MCP. Testable without the route.

import {
  TOOL_SUMMARIES, RESULT_NOTES, ERROR_NOTES, RATE_LIMIT_NOTE, ACCESS_NOTE, TRANSPORT,
  mcpUrl, claudeAddCommand, claudeCodeJsonConfig, cursorJsonConfig, claudeDesktopSteps, claudeDesktopBridgeConfig, toolDocs,
} from './discovery.mjs';

/** One parameter as a list line: "- name (number, 0 to 90, required): description". */
function paramLine(p) {
  const facts = [p.type, p.range, p.required ? 'required' : ''].filter(Boolean).join(', ');
  return `  - ${p.name} (${facts}): ${p.description}`;
}

export function buildLlmsTxt(origin) {
  return [
    '# SeekSat',
    '',
    '> Satellite & ISS pass forecasts. The same SGP4 + visibility engine that',
    '> powers the web app is exposed to AI agents over MCP.',
    '',
    '## MCP server',
    '',
    `Endpoint: ${mcpUrl(origin)}`,
    `Transport: ${TRANSPORT} (no sign-in).`,
    '',
    `Claude Code: ${claudeAddCommand(origin)}`,
    '(add --scope user to have it in every project)',
    '',
    'Claude Code project file (.mcp.json):',
    claudeCodeJsonConfig(origin),
    '',
    `Claude Desktop or claude.ai: ${claudeDesktopSteps(origin)}`,
    'Or, in claude_desktop_config.json through the mcp-remote bridge:',
    claudeDesktopBridgeConfig(origin),
    '',
    'Cursor (~/.cursor/mcp.json):',
    cursorJsonConfig(origin),
    '',
    `Access: ${ACCESS_NOTE}`,
    '',
    `Rate limit: ${RATE_LIMIT_NOTE}`,
    '',
    '## Errors',
    '',
    ...ERROR_NOTES.map((n) => `- ${n}`),
    '',
    '## Tools',
    '',
    ...TOOL_SUMMARIES.map((t) => `- ${t.name}: ${t.summary}`),
    '',
    '## Results',
    '',
    ...RESULT_NOTES.map((n) => `- ${n}`),
    '',
    '## Tool parameters',
    '',
    ...toolDocs().flatMap((t) => [
      `### ${t.name}`,
      '',
      t.description,
      '',
      ...(t.params.length ? t.params.map(paramLine) : ['  (no parameters)']),
      '',
    ]),
    '## Docs',
    '',
    `- ${origin}/mcp - human-readable MCP documentation`,
    '',
  ].join('\n');
}
