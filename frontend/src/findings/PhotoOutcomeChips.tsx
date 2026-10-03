import { Link } from "react-router-dom";
import { imagesReviewPath, type ReviewEntry } from "@/images/workspace/entryParams";
import { cx, focusRing, pressable, transition } from "@/ui";

const OUTCOMES: { review: ReviewEntry; label: string }[] = [
  { review: "uncertain", label: "Uncertain photos" },
  { review: "none", label: "No finding" },
  { review: "all", label: "All photos" },
];

/** Spec §9 Register: the photo outcome chips open the image browser filtered by review status. */
export function PhotoOutcomeChips({ projectId }: { projectId: string }) {
  return (
    <nav aria-label="Photo outcomes" className="flex flex-wrap items-center gap-1.5">
      {OUTCOMES.map((o) => (
        <Link
          key={o.review}
          to={imagesReviewPath(projectId, o.review)}
          className={cx(
            "inline-flex h-7 items-center rounded-chip border border-line px-2.5 text-xs text-muted hover:bg-hover hover:text-ink",
            focusRing,
            transition,
            pressable,
          )}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}
