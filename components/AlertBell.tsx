"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { addAlert, makeAlert, removeAlert, DEFAULT_LEAD_MIN } from "@/lib/alerts/alerts.mjs";
import { readAlerts, watchAlerts, writeAlerts, type PassAlert } from "@/lib/alerts/store";

export const OPEN_TAB_NOTE = "Reminders work while SeekSat is open in a tab or installed as an app.";
const BLOCKED_NOTE = "Your browser blocked notifications. Allow them for this site to get reminders.";
const UNSUPPORTED_NOTE = "This browser can't show reminders. On iPhone, add SeekSat to your Home Screen first.";
const NOTE_MS = 6000;

interface Props {
  noradId: number;
  name: string;
  pass: { startMs: number; peakMs?: number; maxElevDeg?: number };
  /** The page to open when the notification is clicked; read at click time. */
  url: () => string;
}

const makeIt = makeAlert as unknown as (o: Record<string, unknown>) => PassAlert;
const add = addAlert as (l: PassAlert[], a: PassAlert) => PassAlert[];
const remove = removeAlert as (l: PassAlert[], id: string) => PassAlert[];

/** A 🔔 chip: remind me 10 minutes before this pass, while SeekSat is open. */
export default function AlertBell({ noradId, name, pass, url }: Props) {
  const id = `${noradId}:${pass.startMs}`;
  const [on, setOn] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const sync = () => setOn(readAlerts().some((a) => a.id === id));
    sync();
    return watchAlerts(sync);
  }, [id]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const show = useCallback((text: string) => {
    setNote(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(null), NOTE_MS);
  }, []);

  const toggle = async () => {
    if (on) {
      writeAlerts(remove(readAlerts(), id));
      setNote(null);
      return;
    }
    if (!("Notification" in window)) return show(UNSUPPORTED_NOTE);
    let permission: NotificationPermission = Notification.permission;
    if (permission === "denied") return show(BLOCKED_NOTE);
    if (permission !== "granted") {
      try {
        permission = await Notification.requestPermission();
      } catch {
        return show(UNSUPPORTED_NOTE);
      }
      if (permission !== "granted") return show(BLOCKED_NOTE);
    }
    writeAlerts(add(readAlerts(), makeIt({
      noradId, name, pass: { startMs: pass.startMs, peakMs: pass.peakMs ?? pass.startMs, maxElevDeg: pass.maxElevDeg ?? 0 }, url: url(), leadMin: DEFAULT_LEAD_MIN,
    })));
    show(OPEN_TAB_NOTE);
  };

  return (
    <>
      <button
        type="button"
        className={on ? "home-chip home-chip--on" : "home-chip"}
        aria-pressed={on}
        aria-label={on ? "Cancel reminder" : "Remind me before this pass"}
        title={on ? "Cancel reminder" : `Reminder ${DEFAULT_LEAD_MIN} min before`}
        onClick={toggle}
      >
        {"🔔"}
      </button>
      {note && <span className="alert-note" role="status">{note}</span>}
    </>
  );
}
