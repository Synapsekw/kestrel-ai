import type { RouteObject } from "react-router-dom";
import {
  AboutScreen,
  CatalogueScreen,
  DatasetsScreen,
  JobsScreen,
  Later,
  TrainingScreen,
} from "@/app/lazyScreens";
import { LibraryScreen } from "@/library/LibraryScreen";
import { ModelsLayout } from "@/models/ModelsLayout";
import { AppSettingsScreen } from "@/screens/AppSettingsScreen";
import { Redirect } from "./Redirect";

/** The app-level routes (spec 2026-09-26-foundation section 5.3). S2 adds or swaps entries here only. */
export const appRoutes: RouteObject[] = [
  {
    path: "models",
    element: <ModelsLayout />,
    children: [
      { index: true, element: <Redirect to={() => "/models/library"} /> },
      { path: "library", element: <LibraryScreen /> },
      {
        path: "datasets",
        element: (
          <Later>
            <DatasetsScreen />
          </Later>
        ),
      },
      {
        path: "datasets/:datasetId",
        element: (
          <Later>
            <DatasetsScreen />
          </Later>
        ),
      },
      {
        path: "training",
        element: (
          <Later>
            <TrainingScreen />
          </Later>
        ),
      },
      {
        path: "training/:runId",
        element: (
          <Later>
            <TrainingScreen />
          </Later>
        ),
      },
    ],
  },
  {
    path: "catalogue",
    element: (
      <Later>
        <CatalogueScreen tab="types" />
      </Later>
    ),
  },
  {
    path: "catalogue/severity",
    element: (
      <Later>
        <CatalogueScreen tab="severity" />
      </Later>
    ),
  },
  {
    path: "jobs",
    element: (
      <Later>
        <JobsScreen />
      </Later>
    ),
  },
  { path: "settings", element: <AppSettingsScreen /> },
  {
    path: "about",
    element: (
      <Later>
        <AboutScreen />
      </Later>
    ),
  },
];
