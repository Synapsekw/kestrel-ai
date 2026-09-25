import type { ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Skeleton } from "@/ui";
import { useProjectKindState, type ProjectKind } from "./useProjectKind";

/** A screen-shaped placeholder while a screen's kind or its code is still loading. */
export function ScreenPlaceholder() {
  return (
    <div role="status" aria-label="Loading" className="flex max-w-3xl flex-col gap-3">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-40 w-full rounded-lg" />
    </div>
  );
}

/**
 * Renders a project screen only for the project kinds in `allow`; any other kind lands on the
 * project's Home. While the kind loads the screen area holds a placeholder. When the kind cannot
 * be loaded the screen renders anyway: the backend refuses wrong-kind requests on its own.
 */
export function KindRoute({ allow, children }: { allow: ProjectKind[]; children: ReactNode }) {
  const { projectId } = useParams();
  const { kind, failed } = useProjectKindState(projectId);
  if (failed || !projectId) return <>{children}</>;
  if (!kind) return <ScreenPlaceholder />;
  if (!allow.includes(kind)) return <Navigate to={`/p/${projectId}`} replace />;
  return <>{children}</>;
}
