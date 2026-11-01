"use client";

import { useEffect } from "react";
import { safeUrl as safeUrlFn, alertText, fireAt, planTimer, pruneAlerts, removeAlert } from "@/lib/alerts/alerts.mjs";
import { readAlerts, watchAlerts, writeAlerts, type PassAlert } from "@/lib/alerts/store";

type Plan = { delayMs: number; alert: PassAlert } | null;
const plan = planTimer as (l: PassAlert[], nowMs: number) => Plan;
const prune = pruneAlerts as (l: PassAlert[], nowMs: number) => PassAlert[];
const remove = removeAlert as (l: PassAlert[], id: string) => PassAlert[];
const when = fireAt as (a: PassAlert) => number;
const safeUrl = safeUrlFn as (u: string, origin: string) => string;
const text = alertText as (a: PassAlert, nowMs: number) => string;

/** Arms one timer for the next reminder and shows it. Renders nothing. */
export default function AlertRunner() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      let list = readAlerts();
      const pruned = prune(list, Date.now());
      if (pruned.length !== list.length) {
        list = pruned;
        writeAlerts(list); // re-enters arm() through the change event
        return;
      }
      const p = plan(list, Date.now());
      if (!p) return;
      timer = setTimeout(() => fire(p.alert), p.delayMs);
    };

    // Android throws "Illegal constructor" for new Notification(), so try the
    // service worker first. Its notificationclick handler (public/sw.js)
    // focuses a SeekSat window and opens data.url.
    const show = async (alert: PassAlert, body: string) => {
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) {
          await reg.showNotification("SeekSat", { body, tag: alert.id, data: { url: safeUrl(alert.url, location.origin) } });
          return;
        }
      } catch {
        /* fall through to the constructor */
      }
      try {
        const n = new Notification("SeekSat", { body, tag: alert.id });
        n.onclick = () => {
          window.focus();
          location.assign(safeUrl(alert.url, location.origin));
          n.close();
        };
      } catch {
        /* the browser refused; the reminder is dropped */
      }
    };

    const fire = (alert: PassAlert) => {
      timer = null;
      const now = Date.now();
      // setTimeout capped or fired early: wait again.
      if (now < when(alert)) return arm();
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        void show(alert, text(alert, now));
      }
      writeAlerts(remove(readAlerts(), alert.id)); // change event re-arms
    };

    const onVisible = () => { if (document.visibilityState === "visible") arm(); };
    arm();
    const stop = watchAlerts(arm);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
