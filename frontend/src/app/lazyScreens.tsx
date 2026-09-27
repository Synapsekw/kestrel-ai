import { lazy, Suspense, type ReactNode } from "react";
import { Skeleton } from "@/ui";

// Lazy screens: the Clouds screen pulls in three and potree-core (about 1 MB), which the rest of
// the app never pays for (spec 2026-09-23-point-clouds section 2, "Viewer lifecycle").
export const CloudsScreen = lazy(() =>
  import("@/screens/CloudsScreen").then((m) => ({ default: m.CloudsScreen })),
);
export const VolumesScreen = lazy(() =>
  import("@/screens/VolumesScreen").then((m) => ({ default: m.VolumesScreen })),
);
export const AboutScreen = lazy(() =>
  import("@/screens/AboutScreen").then((m) => ({ default: m.AboutScreen })),
);
export const JobsScreen = lazy(() => import("@/jobs/JobsScreen").then((m) => ({ default: m.JobsScreen })));
export const CatalogueScreen = lazy(() =>
  import("@/catalogue/CatalogueScreen").then((m) => ({ default: m.CatalogueScreen })),
);
export const DatasetsScreen = lazy(() =>
  import("@/models/DatasetsScreen").then((m) => ({ default: m.DatasetsScreen })),
);

/** A screen-shaped placeholder while a screen's code is still loading. */
export function ScreenPlaceholder() {
  return (
    <div role="status" aria-label="Loading" className="flex max-w-3xl flex-col gap-3">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-40 w-full rounded-panel" />
    </div>
  );
}

/** A lazy screen with a placeholder while its code loads. */
export function Later({ children }: { children: ReactNode }) {
  return <Suspense fallback={<ScreenPlaceholder />}>{children}</Suspense>;
}
