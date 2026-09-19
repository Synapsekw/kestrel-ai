import { Link } from "react-router-dom";
import { useNavigationStore } from "@/store/navigation";

/** Leads back to the list that opened the editor, with that list's filter (a run's review) intact. */
export function BackLink({ projectId }: { projectId: string }) {
  const source = useNavigationStore((s) => s.source);
  const returnTo = useNavigationStore((s) => s.returnTo);
  const review = source === "review";
  return (
    <Link
      to={returnTo ?? `/p/${projectId}/${review ? "review" : "data"}`}
      aria-label={review ? "Back to the review queue" : "Back to the Data Manager"}
      className="rounded border border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-800"
    >
      ← {review ? "Review queue" : "Data"}
    </Link>
  );
}
