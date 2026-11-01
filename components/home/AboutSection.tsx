import Link from "next/link";

export default function AboutSection() {
  return (
    <details className="home-about">
      <summary>About SeekSat</summary>
      <p>SeekSat tracks any satellite in the public catalog and finds its passes from where you are, for radio or for watching.</p>
      <p>
        Positions come from SGP4, the standard model for these element sets, using elements from CelesTrak that we refresh every few hours. Each satellite&apos;s page shows how old its elements are and how every number is worked out.
      </p>
      <p>Everything runs in your browser. Your location and the satellites you follow stay on this device. No accounts, no ads.</p>
      <p>
        AI agents can ask the same pass engine through <Link href="/mcp">MCP</Link>.
      </p>
    </details>
  );
}
