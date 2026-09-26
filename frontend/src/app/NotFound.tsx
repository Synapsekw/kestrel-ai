import { Link } from "react-router-dom";
import { EmptyState, buttonClass } from "@/ui";

/** Any address no route matches, inside the shell (the router's own error page is never shown). */
export function NotFound() {
  return (
    <EmptyState
      icon="search"
      title="Nothing at this address"
      action={
        <Link to="/projects" className={buttonClass("secondary", "md")}>
          Open Projects
        </Link>
      }
    >
      The page may have moved. Pick a section on the left, or open your projects.
    </EmptyState>
  );
}
