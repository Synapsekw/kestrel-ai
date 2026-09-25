import { lazy, Suspense, type ReactNode } from "react";
import { ScreenPlaceholder } from "./KindRoute";

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

/** A lazy screen with a placeholder while its code loads. */
export function Later({ children }: { children: ReactNode }) {
  return <Suspense fallback={<ScreenPlaceholder />}>{children}</Suspense>;
}
