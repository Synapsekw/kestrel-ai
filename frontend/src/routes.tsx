import type { ReactNode } from "react";
import { createBrowserRouter } from "react-router-dom";
import { KindRoute } from "@/app/KindRoute";
import { Shell } from "@/app/Shell";
import type { ProjectKind } from "@/app/useProjectKind";
import { LibraryScreen } from "@/library/LibraryScreen";
import { ProjectsScreen } from "@/screens/ProjectsScreen";
import { HomeScreen } from "@/screens/HomeScreen";
import { DataManagerScreen } from "@/screens/DataManagerScreen";
import { EditorScreen } from "@/screens/EditorScreen";
import { LabelResolverScreen } from "@/screens/LabelResolverScreen";
import { ReviewScreen } from "@/screens/ReviewScreen";
import { DatasetsScreen } from "@/screens/DatasetsScreen";
import { TrainScreen } from "@/screens/TrainScreen";
import { QueryScreen } from "@/screens/QueryScreen";
import { MapsScreen } from "@/screens/MapsScreen";
import { PastDetectionsScreen } from "@/screens/PastDetectionsScreen";
import { SourcesScreen } from "@/screens/SourcesScreen";
import { RunsScreen } from "@/screens/RunsScreen";
import { AnalyticsScreen } from "@/screens/AnalyticsScreen";
import { SiteAreasScreen } from "@/screens/SiteAreasScreen";
import { SurveysRedirect } from "@/sources/SurveysRedirect";
import { ExportScreen } from "@/screens/ExportScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { AppSettingsScreen } from "@/screens/AppSettingsScreen";

const TRAIN: ProjectKind[] = ["train"];
const DETECT: ProjectKind[] = ["detect"];

/** A project screen that exists for `allow` kinds only; any other kind lands on Home. */
const only = (allow: ProjectKind[], screen: ReactNode) => <KindRoute allow={allow}>{screen}</KindRoute>;

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <ProjectsScreen /> },
      { path: "library", element: <LibraryScreen /> },
      { path: "settings", element: <AppSettingsScreen /> },
      // Both kinds.
      { path: "p/:projectId", element: <HomeScreen /> },
      { path: "p/:projectId/data", element: <DataManagerScreen /> },
      { path: "p/:projectId/review", element: <ReviewScreen /> },
      // Review opens its images in the editor, so the editor serves both kinds.
      { path: "p/:projectId/edit/:imageId", element: <EditorScreen /> },
      { path: "p/:projectId/export", element: <ExportScreen /> },
      { path: "p/:projectId/settings", element: <SettingsScreen /> },
      // Training projects.
      { path: "p/:projectId/label", element: only(TRAIN, <LabelResolverScreen />) },
      { path: "p/:projectId/datasets", element: only(TRAIN, <DatasetsScreen />) },
      { path: "p/:projectId/train", element: only(TRAIN, <TrainScreen />) },
      { path: "p/:projectId/past", element: only(TRAIN, <PastDetectionsScreen />) },
      { path: "p/:projectId/past/maps/:mapId", element: only(TRAIN, <PastDetectionsScreen />) },
      // Detection projects: Sources, Runs, Review (above, it branches on kind), Analytics, Export;
      // Site areas below the divider. A map opens in the viewer from Sources.
      { path: "p/:projectId/sources", element: only(DETECT, <SourcesScreen />) },
      { path: "p/:projectId/runs", element: only(DETECT, <RunsScreen />) },
      { path: "p/:projectId/analytics", element: only(DETECT, <AnalyticsScreen />) },
      { path: "p/:projectId/site-areas", element: only(DETECT, <SiteAreasScreen />) },
      { path: "p/:projectId/maps/:mapId", element: only(DETECT, <MapsScreen />) },
      // No longer steps; kept so earlier links and past detections still open.
      { path: "p/:projectId/query", element: only(DETECT, <QueryScreen />) },
      { path: "p/:projectId/maps", element: only(DETECT, <MapsScreen />) },
      // The survey timeline moved into Analytics.
      { path: "p/:projectId/surveys", element: <SurveysRedirect /> },
    ],
  },
]);
