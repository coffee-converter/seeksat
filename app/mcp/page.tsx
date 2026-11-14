import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/lib/site.mjs";
import {
  TOOL_SUMMARIES, RESULT_NOTES, ERROR_NOTES, RATE_LIMIT_NOTE, ACCESS_NOTE, TRANSPORT, GITHUB_URL,
  mcpUrl, claudeAddCommand, claudeAddCommandWithKey, claudeCodeJsonConfig, cursorJsonConfig,
  claudeDesktopSteps, claudeDesktopBridgeConfig, toolDocs,
} from "@/lib/mcp/discovery.mjs";
import "./mcp.css";

const MCP_ALT = "SeekSat MCP server: satellite passes and radio for AI agents, at seeksat.com/api/mcp";

export const metadata: Metadata = {
  title: "MCP Server",
  description:
    "Query SeekSat's satellite pass & position engine from AI agents over the Model Context Protocol.",
  alternates: { canonical: "/mcp" },
  openGraph: { images: [{ url: "/og-mcp.png", width: 1200, height: 630, alt: MCP_ALT }] },
  twitter: { card: "summary_large_image", images: [{ url: "/og-mcp.png", alt: MCP_ALT }] },
};

type Param = { name: string; type: string; required: boolean; range: string; description: string };
type ToolDoc = { name: string; title: string; description: string; params: Param[] };

export default function McpDocsPage() {
  const tools = toolDocs() as ToolDoc[];
  return (
    <main className="mcp-doc">
      <header>
        <h1><span className="seek">Seek</span><span className="sat">Sat</span> MCP</h1>
        <p className="lede">
          Same engine, two faces: the web app shows satellite pages and pass lists for people; this MCP server exposes the same SGP4 + visibility-physics engine to AI agents.
        </p>
      </header>

      <section>
        <h2>Connect</h2>
        <p>Endpoint ({TRANSPORT}, no sign-in):</p>
        <pre><code>{mcpUrl(SITE_URL)}</code></pre>

        <h3>Claude Code</h3>
        <pre><code>{claudeAddCommand(SITE_URL)}</code></pre>
        <p>Add <code>--scope user</code> to have it in every project. Or in a project&apos;s <code>.mcp.json</code> (a remote server needs <code>&quot;type&quot;: &quot;http&quot;</code>):</p>
        <pre><code>{claudeCodeJsonConfig(SITE_URL)}</code></pre>

        <h3>Claude Desktop and claude.ai</h3>
        <p>{claudeDesktopSteps(SITE_URL)}</p>
        <p>Where custom connectors are not available, bridge it in <code>claude_desktop_config.json</code> with mcp-remote (needs Node.js):</p>
        <pre><code>{claudeDesktopBridgeConfig(SITE_URL)}</code></pre>

        <h3>Cursor</h3>
        <p>In <code>~/.cursor/mcp.json</code> (or <code>.cursor/mcp.json</code> in a project):</p>
        <pre><code>{cursorJsonConfig(SITE_URL)}</code></pre>
      </section>

      <section>
        <h2>Access and limits</h2>
        <p>{ACCESS_NOTE}</p>
        <p>To send a key from Claude Code:</p>
        <pre><code>{claudeAddCommandWithKey(SITE_URL)}</code></pre>
        <p>From Cursor:</p>
        <pre><code>{cursorJsonConfig(SITE_URL, { withKey: true })}</code></pre>
        <p>{RATE_LIMIT_NOTE}</p>
      </section>

      <section>
        <h2>Errors</h2>
        <ul>
          {ERROR_NOTES.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </section>

      <section>
        <h2>Tools</h2>
        <table>
          <thead><tr><th>Tool</th><th>What it does</th></tr></thead>
          <tbody>
            {TOOL_SUMMARIES.map((t) => (
              <tr key={t.name}><td><a href={`#${t.name}`}><code>{t.name}</code></a></td><td>{t.summary}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>What results include</h2>
        <ul>
          {RESULT_NOTES.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </section>

      <section>
        <h2>Tool parameters</h2>
        {tools.map((t) => (
          <div key={t.name} id={t.name}>
            <h3><code>{t.name}</code>: {t.title}</h3>
            <p>{t.description}</p>
            {t.params.length ? (
              <table>
                <thead><tr><th>Parameter</th><th>Type</th><th>Details</th></tr></thead>
                <tbody>
                  {t.params.map((p) => (
                    <tr key={p.name}>
                      <td><code>{p.name}</code>{p.required ? " (required)" : ""}</td>
                      <td>{p.type}{p.range ? `, ${p.range}` : ""}</td>
                      <td>{p.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p>No parameters.</p>}
          </div>
        ))}
      </section>

      <section>
        <h2>Design decisions</h2>
        <ul>
          <li><strong>Deterministic core.</strong> Pass geometry, magnitude, visibility and the
            observer&apos;s time zone are worked out on the server with no outside calls. Only three
            things reach other services: geocoding a place name (OpenStreetMap), the cloud forecast
            (Open-Meteo and MET Norway, for <code>get_pass_weather</code> and visual <code>best_pass</code>),
            and fetching a satellite missing from the catalog snapshot (CelesTrak).</li>
          <li><strong>Cron-cached, epoch-guarded TLEs.</strong> A 4-hour cron mirrors the
            CelesTrak catalog into Vercel Blob; requests read from that snapshot, with a
            rate-limited CelesTrak lookup only for satellites not in it. A flaky
            source returning an older element set can&apos;t clobber good data, and an upstream
            outage just means serving the last-known-good TLE, still SGP4-valid for days.</li>
          <li><strong>Whole-catalog questions stay fast.</strong> <code>whats_up_now</code> and
            <code> identify_satellite</code> take one orbit step per satellite at one moment. The
            <code> best_pass</code> scans sweep their candidates for rough passes (elevation only,
            skipping time a satellite cannot rise; for visual passes also sunlight and a dark sky),
            cache that per area and hour, and run the full engine only on the best candidates.</li>
          <li><strong>Engine reuse.</strong> Every pass number comes from the same unit-tested
            <code> lib/pass-finder/*</code> modules that drive the web app, so the two faces
            can&apos;t drift.</li>
        </ul>
      </section>

      <footer>
        <Link href="/">← Back to SeekSat</Link>
        {GITHUB_URL && (
          <> · <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">Source</a></>
        )}
      </footer>
    </main>
  );
}
