"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { useHomeStore } from "@/lib/home/store";
import { satName } from "@/lib/home/names.mjs";
import { markFromList } from "@/lib/home/list-origin.mjs";
import { satPath } from "@/lib/sat/page-data.mjs";
import { linkClass } from "@/lib/ui/classes.mjs";

const nameFor = satName as (
  id: number,
  from: { records: Map<number, { name?: string }>; custom: Array<{ noradId: number; name: string }> },
) => string;

interface Props {
  open: boolean;
  onClose: () => void;
  colors: ReadonlyMap<number, string>;
}

/**
 * The followed satellites, each in its map colour: its name opens its page
 * (a pasted satellite has none), then Hide or Show on the map, and Unfollow.
 * Opened by the Following button over the pass list.
 */
export default function FollowingSheet({ open, onClose, colors }: Props) {
  const prefs = useHomeStore((s) => s.prefs);
  const records = useHomeStore((s) => s.records);
  const toggleHidden = useHomeStore((s) => s.toggleHidden);
  const unfollow = useHomeStore((s) => s.unfollow);
  const pasted = new Set(prefs.custom.map((c) => c.noradId));

  return (
    <Modal open={open} onClose={onClose} size="sheet" title="Following">
      {prefs.following.length === 0 ? (
        <p className="following-sheet__empty">No satellites followed yet. Search to add one.</p>
      ) : (
        <ul className="following-sheet">
          {prefs.following.map((id) => {
            const name = nameFor(id, { records, custom: prefs.custom });
            const hidden = prefs.hidden.includes(id);
            return (
              <li
                key={id}
                className="following-sheet__sat"
                style={{ "--sat-color": colors.get(id) ?? "var(--map-muted)" } as CSSProperties}
              >
                <span className="following-sheet__dot" aria-hidden="true" />
                {pasted.has(id) ? (
                  <span className="following-sheet__name">{name}</span>
                ) : (
                  <Link
                    className={`following-sheet__name ${linkClass()}`}
                    href={satPath(id) as string}
                    onClick={() => {
                      markFromList();
                      onClose();
                    }}
                  >
                    {`${name} ›`}
                  </Link>
                )}
                <Button size="sm" aria-label={`${hidden ? "Show" : "Hide"} ${name} on map`} onClick={() => toggleHidden(id)}>
                  {hidden ? "Show" : "Hide"}
                </Button>
                <Button size="sm" tone="danger" aria-label={`Unfollow ${name}`} onClick={() => unfollow(id)}>
                  Unfollow
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
