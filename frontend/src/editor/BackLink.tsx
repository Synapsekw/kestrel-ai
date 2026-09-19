import { Link } from "react-router-dom";
import { Icon, buttonClass } from "@/ui";
import { useNavigationStore } from "@/store/navigation";

/** Leads back to the list that opened the editor, with that list's filter (a run's review) intact. */
export function BackLink({ projectId }: { projectId: string }) {
  const source = useNavigationStore((s) => s.source);
  const returnTo = useNavigationStore((s) => s.returnTo);
  const review = source === "review";
  return (
    <Link
      to={returnTo ?? `/p/${projectId}/${review ? "review" : "data"}`}
      aria-label={review ? "Back to the review queue" : "Back to Images"}
      className={buttonClass("ghost", "sm", "-ml-1.5 !px-1.5")}
    >
      <Icon name="arrow-left" size={13} />
      {review ? "Review" : "Images"}
    </Link>
  );
}
