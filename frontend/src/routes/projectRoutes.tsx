import type { RouteObject } from "react-router-dom";
import { CloudsScreen, Later, VolumesScreen } from "@/app/lazyScreens";
import { FindingsScreen } from "@/findings/FindingsScreen";
import { MapWorkspace } from "@/mapws/MapWorkspace";
import { MeasurementsScreen } from "@/measurements/MeasurementsScreen";
import { OverviewScreen } from "@/overview/OverviewScreen";
import { ReportsPlaceholder } from "@/reports/ReportsPlaceholder";
import { AnalyticsScreen } from "@/screens/AnalyticsScreen";
import { DataManagerScreen } from "@/screens/DataManagerScreen";
import { EditorScreen } from "@/screens/EditorScreen";
import { ExportScreen } from "@/screens/ExportScreen";
import { MapEvaluateRoute } from "@/screens/MapEvaluateScreen";
import { QueryScreen } from "@/screens/QueryScreen";
import { ReviewScreen } from "@/screens/ReviewScreen";
import { RunsScreen } from "@/screens/RunsScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { SiteAreasScreen } from "@/screens/SiteAreasScreen";

/**
 * The project routes, relative to `p/:projectId` (spec 2026-09-26-foundation section 5.3). S1, I,
 * M, C and R add or swap entries here only; `routes.tsx` and `routes/tree.tsx` stay SH's.
 */
export const projectRoutes: RouteObject[] = [
  // F §9.1: the project opens here.
  { path: "overview", element: <OverviewScreen /> },
  // Images: interim host, today's screens (I replaces them).
  { path: "images", element: <DataManagerScreen /> },
  { path: "images/:imageId", element: <EditorScreen /> },
  // Maps: the map workspace (M-W1).
  { path: "maps", element: <MapWorkspace /> },
  // Maps: one map's labels, evaluation zones and score in pixels, and the maps without coordinates
  // (spec 2026-09-26-map-workspace section 11). `maps/:mapId` is a redirect (legacyRedirects).
  { path: "maps/:mapId/evaluate", element: <MapEvaluateRoute /> },
  // The 3D jump contract (spec 2026-09-23-point-clouds section 10), used unchanged by the
  // maps -> 3D jump, the 3D -> map jump and the Volumes screen's "View in 3D":
  //   /p/:projectId/clouds/:cloudId?at=x,y[&fp=x1,y1;x2,y2;x3,y3;x4,y4]
  //   /p/:projectId/maps/:mapId?at=x,y
  // Point clouds workspace additions (spec 2026-09-26-point-cloud-workspace section 10.4, helpers in
  // clouds/jump.ts): /p/:projectId/clouds/:cloudId?finding=<id> opens a pin, ?from_image=<imageId>&px=u,v
  // looks through that photo and picks at the pixel; the cloud -> image jump is
  //   /p/:projectId/images/:imageId?at=px,py&r=rpx&from=cloud:<cloudId> (stored-image pixels, I section 6.5).
  // Coordinates are in the DESTINATION's native CRS; the source screen converts them with
  // proj4 (both entities carry `proj4`), so the destination never knows where the caller came
  // from. `fp` is a box footprint's four corners. The screen reads them once per navigation.
  {
    path: "clouds",
    element: (
      <Later>
        <CloudsScreen />
      </Later>
    ),
  },
  {
    path: "clouds/:cloudId",
    element: (
      <Later>
        <CloudsScreen />
      </Later>
    ),
  },
  // F §8.6: the list, and the inspector at findings/:findingId (the canonical finding link).
  { path: "findings/:findingId?", element: <FindingsScreen /> },
  // Measurements (R8, M-W6): the union list; the kept volume view lives under it. The old
  // `measurements/:measurementId` volume links redirect to `measurements/volumes/:measurementId`
  // (legacyRedirects.tsx).
  { path: "measurements", element: <MeasurementsScreen /> },
  {
    path: "measurements/volumes",
    element: (
      <Later>
        <VolumesScreen />
      </Later>
    ),
  },
  {
    path: "measurements/volumes/:measurementId",
    element: (
      <Later>
        <VolumesScreen />
      </Later>
    ),
  },
  { path: "reports", element: <ReportsPlaceholder /> },
  { path: "settings", element: <SettingsScreen /> },
  // Secondary routes without a tab: the tab strip's More menu and the palette reach them.
  { path: "runs", element: <RunsScreen /> },
  { path: "review", element: <ReviewScreen /> },
  { path: "analytics", element: <AnalyticsScreen /> },
  { path: "site-areas", element: <SiteAreasScreen /> },
  { path: "query", element: <QueryScreen /> },
  { path: "export", element: <ExportScreen /> },
];
