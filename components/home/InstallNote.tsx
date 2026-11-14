"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import { surfaceClass } from "@/lib/ui/classes.mjs";
import {
  INSTALL_TEXT, IOS_STEPS, countVisit, dismissInstall, installDismissed, installPath, iosBrowser,
} from "@/lib/home/install-note.mjs";

/** Chrome's install event (not in the DOM types). */
type InstallEvent = Event & { prompt: () => Promise<unknown> };

type IosBrowser = "safari" | "chrome" | "other" | null;
const pathOf = installPath as (o: {
  visits: number; dismissed: boolean; standalone: boolean; ios: IosBrowser; hasPrompt: boolean;
}) => "prompt" | "ios" | null;

/** A small dismissible note to add SeekSat to the home screen, from the second
 *  visit on: an Install button where the browser offers one (Android Chrome),
 *  on iPhone the steps for that browser (Safari's Share, Chrome's, or through
 *  Safari from Brave and the rest), nothing otherwise or once installed. It
 *  draws nothing until storage and the browser have been read. Mounted
 *  whenever home is, so the install event is caught whenever it fires; `show`
 *  says whether the pass list is on screen. */
export default function InstallNote({ show }: { show: boolean }) {
  const [visits, setVisits] = useState(0);
  const [dismissed, setDismissed] = useState(true);
  const [standalone, setStandalone] = useState(true);
  const [ios, setIos] = useState<IosBrowser>(null);
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);

  useEffect(() => {
    try { setVisits((countVisit as (l: Storage, s: Storage) => number)(window.localStorage, window.sessionStorage)); } catch { /* none */ }
    try { setDismissed((installDismissed as (l: Storage) => boolean)(window.localStorage)); } catch { /* stays dismissed */ }
    try {
      const nav = navigator as Navigator & { standalone?: boolean };
      setStandalone(window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true);
      setIos((iosBrowser as (o: { userAgent: string; maxTouchPoints: number; brave: boolean }) => IosBrowser)({
        userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints,
        brave: typeof (navigator as Navigator & { brave?: unknown }).brave !== "undefined",
      }));
    } catch { /* stays hidden */ }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallEvent);
    };
    const onInstalled = () => { setPrompt(null); setStandalone(true); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const path = pathOf({ visits, dismissed, standalone, ios, hasPrompt: prompt != null });
  if (!show || !path) return null;

  const dismiss = () => {
    setDismissed(true);
    try { (dismissInstall as (l: Storage) => void)(window.localStorage); } catch { /* ignore */ }
  };
  const install = async () => {
    const ev = prompt;
    if (!ev) return;
    // The event works once, whatever the answer.
    setPrompt(null);
    try { await ev.prompt(); } catch { /* the browser declined */ }
  };

  return (
    <div className={`${surfaceClass({ padded: "sm" })} install-note`} role="note">
      <p className="install-note__text">
        {INSTALL_TEXT}
        {path === "ios" && ios && <> {(IOS_STEPS as Record<string, string>)[ios]}</>}
      </p>
      {path === "prompt" && <Button size="sm" onClick={install}>Install</Button>}
      <Button size="sm" variant="quiet" iconOnly aria-label="Dismiss" onClick={dismiss}>
        <Icon name="close" />
      </Button>
    </div>
  );
}
