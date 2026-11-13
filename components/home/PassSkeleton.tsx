import { passRowsClass } from "./PassRow";

/** Placeholder rows, the height of real ones, while passes are found. The
 *  text inside only sets the size of each block; it is hidden from readers,
 *  and `label` is spoken as a status instead. */
export default function PassSkeleton({ label = "Finding passes...", rows = 4 }: { label?: string; rows?: number }) {
  return (
    <div className="pass-skel">
      <p className="sr-only" role="status">{label}</p>
      <ul className={`${passRowsClass} pass-skel__rows`} aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="pass-row">
            <div className="pass-row__btn pass-skel__row">
              <span className="pass-row__when">
                <span className="pass-row__time pass-skel__bit">10:45 PM</span>
                <span className="pass-row__sub pass-skel__bit">in 42 min</span>
              </span>
              <span className="pass-row__what">
                <span className="pass-row__name pass-skel__bit">Satellite name</span>
                <span className="pass-row__detail pass-skel__bit">54° · 5 min · SW→NE</span>
              </span>
              <span className="pass-row__rating"><span className="pass-skel__bit">Excellent</span></span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
