import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/lib/site.mjs";
import {
  TOOL_SUMMARIES, mcpUrl, claudeAddCommand, mcpJsonConfig, ACCESS_NOTE, GITHUB_URL,
} from "@/lib/mcp/discovery.mjs";
import "./mcp.css";

export const metadata: Metadata = {
  title: "MCP Server",
  description:
    "Query SeekSat's satellite pass & position engine from AI agents over the Model Context Protocol.",
  alternates: { canonical: "/mcp" },
};

export default function McpDocsPage() {
  return (
    <main className="mcp-doc">
      <header>
        <h1><span className="seek">Seek</span><span className="sat">Sat</span> MCP</h1>
        <p className="lede">
          Same engine, two faces: the web app renders satellite passes in a 3D globe for
          humans; this MCP server exposes the same SGP4 + visibility-physics engine to AI agents.
        </p>
      </header>

      <section>
        <h2>Connect</h2>
        <p>Streamable HTTP endpoint:</p>
        <pre><code>{mcpUrl(SITE_URL)}</code></pre>
        <p>Add to Claude Code:</p>
        <pre><code>{claudeAddCommand(SITE_URL)}</code></pre>
        <p>Or in an MCP client config:</p>
        <pre><code>{mcpJsonConfig(SITE_URL)}</code></pre>
      </section>

      <section>
        <h2>Tools</h2>
        <table>
          <thead><tr><th>Tool</th><th>What it does</th></tr></thead>
          <tbody>
            {TOOL_SUMMARIES.map((t) => (
              <tr key={t.name}><td><code>{t.name}</code></td><td>{t.summary}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Access</h2>
        <p>{ACCESS_NOTE}</p>
      </section>

      <section>
        <h2>Design decisions</h2>
        <ul>
          <li><strong>Deterministic, offline core.</strong> Pass geometry, magnitude, and
            visibility run with zero network calls; weather is the only network-dependent tool
            and is deliberately separate.</li>
          <li><strong>Cron-cached, epoch-guarded TLEs.</strong> A 6-hour cron refreshes TLEs
            into Edge Config; requests read from the cache (sub-ms), never upstream. A flaky
            source returning an older element set can&apos;t clobber good data, and an upstream
            outage just means serving the last-known-good TLE - still SGP4-valid for days.</li>
          <li><strong>Engine reuse.</strong> Every pass number comes from the same unit-tested
            <code> lib/pass-finder/*</code> modules that drive the web app, so the two faces
            can&apos;t drift.</li>
        </ul>
      </section>

      <footer>
        <Link href="/">← Back to the globe</Link>
        {GITHUB_URL && (
          <> · <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">Source</a></>
        )}
      </footer>
    </main>
  );
}
