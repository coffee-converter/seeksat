"use client";

import { useRouter } from "next/navigation";
import BandPicker from "@/components/home/BandPicker";
import NightToggle from "@/components/NightToggle";
import ThemeToggle from "@/components/ThemeToggle";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Modal from "@/components/ui/Modal";
import SettingRow from "@/components/ui/SettingRow";
import { useHomeStore } from "@/lib/home/store";
import { MIN_ELEV_MAX, stepMinElev } from "@/lib/home/view.mjs";
import { SKY_TYPES } from "@/lib/sky/visual-rating.mjs";
import { FEEDBACK_EMAIL } from "@/lib/site/feedback.mjs";
import { linkClass } from "@/lib/ui/classes.mjs";
import Icon from "@/components/ui/Icon";

const skyTypes = SKY_TYPES as ReadonlyArray<{ id: string; label: string }>;
const stepElev = stepMinElev as (deg: number, dir: 1 | -1) => number;

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Everything that is set once and left: the sky where you watch, the lowest
 * pass to show, radio bands, theme and night vision, then About and feedback.
 * Opened by the header's gear button. Followed satellites have their own
 * sheet, opened over the pass list (FollowingSheet).
 */
export default function SettingsSheet({ open, onClose }: Props) {
  const router = useRouter();
  const hydrated = useHomeStore((s) => s.hydrated);
  const prefs = useHomeStore((s) => s.prefs);
  const setPrefs = useHomeStore((s) => s.setPrefs);
  const { minElevDeg } = prefs;

  const showAbout = () => {
    onClose();
    const about = document.getElementById("about") as HTMLDetailsElement | null;
    if (!about) {
      // Only the home page has the About fold; go there and open it.
      router.push("/#about");
      return;
    }
    about.open = true;
    // After the sheet has unmounted and given the page its scroll back.
    requestAnimationFrame(() => about.scrollIntoView({ block: "start" }));
  };

  return (
    <Modal open={open} onClose={onClose} size="sheet" title="Settings">
      <div className="settings-sheet">
        <SettingRow label="Sky where you watch">
          <Field label="Sky where you watch" hideLabel>
            <select value={prefs.skyType} disabled={!hydrated} onChange={(e) => setPrefs({ skyType: e.target.value })}>
              {skyTypes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
        </SettingRow>

        <SettingRow label="Lowest pass to show">
          <div className="home-controls__elev" role="group" aria-label="Lowest pass to show">
            <Button
              variant="quiet"
              iconOnly
              aria-label="Lower the lowest pass"
              disabled={!hydrated || minElevDeg <= 0}
              onClick={() => setPrefs({ minElevDeg: stepElev(minElevDeg, -1) })}
            >
              {"−"}
            </Button>
            <span className="home-controls__value" aria-live="polite">
              <span className={hydrated ? undefined : "home-controls__pending"}>{minElevDeg}°</span>
            </span>
            <Button
              variant="quiet"
              iconOnly
              aria-label="Raise the lowest pass"
              disabled={!hydrated || minElevDeg >= MIN_ELEV_MAX}
              onClick={() => setPrefs({ minElevDeg: stepElev(minElevDeg, 1) })}
            >
              +
            </Button>
          </div>
        </SettingRow>

        <SettingRow label="Radio bands">
          <BandPicker ready={hydrated} />
        </SettingRow>

        <SettingRow label="Theme"><ThemeToggle /></SettingRow>
        <SettingRow label="Night vision"><NightToggle /></SettingRow>

        <div className="settings-sheet__nav">
          <Button variant="quiet" className="settings-sheet__link" onClick={showAbout}>
            <span>About SeekSat</span><Icon name="chevron-right" />
          </Button>
        </div>
        <div className="settings-sheet__nav">
          <a className={`${linkClass()} settings-sheet__link`} href={`mailto:${FEEDBACK_EMAIL}`}>
            <span>Send feedback</span><Icon name="chevron-right" />
          </a>
        </div>
      </div>
    </Modal>
  );
}
