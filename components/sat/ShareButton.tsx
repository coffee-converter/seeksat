"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";

interface Props {
  /** The link, or a function that builds it (so window.location.origin is read in the click handler). */
  url: string | (() => string);
  title: string;
  label?: string;
  /** "chip" for a pass row, "button" for the page header. */
  size?: "chip" | "button";
}

type State = { kind: "idle" } | { kind: "copied" } | { kind: "manual"; url: string };

// Share with the system sheet when there is one, else copy the link, else
// show it to copy by hand.
export default function ShareButton({ url, title, label = "Share", size = "chip" }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onClick = async () => {
    const link = typeof url === "function" ? url() : url;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ url: link, title });
        return;
      }
      await navigator.clipboard.writeText(link);
      setState({ kind: "copied" });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState({ kind: "idle" }), 2000);
    } catch (e) {
      if ((e as { name?: string } | null)?.name === "AbortError") return;
      setState({ kind: "manual", url: link });
    }
  };

  return (
    <>
      <Button size={size === "chip" ? "sm" : "md"} onClick={onClick}>
        {label}
      </Button>
      {state.kind === "copied" && <span className="home-note" role="status">Link copied</span>}
      {state.kind === "manual" && (
        <Field label="Copy this link:">
          <input type="text" readOnly value={state.url} onFocus={(e) => e.currentTarget.select()} />
        </Field>
      )}
    </>
  );
}
