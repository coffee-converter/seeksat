import Link from "next/link";
import { Details } from "@/components/ui/Disclosure";
import { linkClass } from "@/lib/ui/classes.mjs";
import { SATNOGS_URL } from "@/lib/mirror/satnogs.mjs";

export default function AboutSection() {
  return (
    <Details id="about" className="home-about" summary="About SeekSat">
      <p>SeekSat tracks any satellite in the public catalog and finds its passes from where you are, for radio or for watching.</p>
      <p>
        Positions come from SGP4, the standard model for these element sets, using elements from CelesTrak that we refresh every few hours. The map shows ground positions, the point straight below each satellite, so two dots close together can be thousands of km apart in height. Positions are predictions, usually good to a kilometre or two when the elements are fresh and drifting by a few km a day as they age: plenty for passes and tracks, not for judging how close two objects come. Each satellite&apos;s page shows how old its elements are and how every number is worked out.
      </p>
      <p>Everything runs in your browser. Your location and the satellites you follow stay on this device. Map tiles load from OpenFreeMap, which sees which part of the map you are viewing. No accounts, no ads. If the page hits an error, it sends the error message and the page&apos;s address (never your location) to our server log so we can fix it.</p>
      <p>
        Radio downlink frequencies come from{" "}
        <a className={linkClass()} href={SATNOGS_URL} target="_blank" rel="noreferrer">SatNOGS DB</a>
        {" "}(CC BY-SA 4.0), refreshed daily, except a few we check by hand. In radio mode, satellites with known downlinks show a radio mark on the map.
      </p>
      <p>Cloud forecasts from Open-Meteo and MET Norway. For cloud forecasts, SeekSat&apos;s server asks them about your area, rounded to about 11 km.</p>
      <p>Reminders work only while SeekSat is open, in a tab or as an installed app.</p>
      <p>
        The sky behind the globe: stars from the Yale Bright Star Catalogue (Hoffleit &amp; Warren), and the Milky Way from NASA&apos;s Deep Star Maps 2020 (NASA/Goddard Space Flight Center Scientific Visualization Studio).
      </p>
      <p>
        AI agents can ask the same pass engine through <Link className={linkClass()} href="/mcp">MCP</Link>.
      </p>
    </Details>
  );
}
