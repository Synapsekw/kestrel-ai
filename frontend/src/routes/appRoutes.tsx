import type { RouteObject } from "react-router-dom";
import { SectionPlaceholder } from "@/app/InterimScreens";
import { AboutScreen, CatalogueScreen, JobsScreen, Later } from "@/app/lazyScreens";
import { LibraryScreen } from "@/library/LibraryScreen";
import { ModelsLayout } from "@/models/ModelsLayout";
import { AppSettingsScreen } from "@/screens/AppSettingsScreen";
import { Redirect } from "./Redirect";

const datasets = (
  <SectionPlaceholder title="Datasets" icon="datasets">
    Datasets built from the reviewed images of any project are listed here.
  </SectionPlaceholder>
);
const training = (
  <SectionPlaceholder title="Training" icon="train">
    Training runs on those datasets, and their results, are listed here.
  </SectionPlaceholder>
);

/** The app-level routes (spec 2026-09-26-foundation section 5.3). S2 adds or swaps entries here only. */
export const appRoutes: RouteObject[] = [
  {
    path: "models",
    element: <ModelsLayout />,
    children: [
      { index: true, element: <Redirect to={() => "/models/library"} /> },
      { path: "library", element: <LibraryScreen /> },
      { path: "datasets", element: datasets },
      { path: "datasets/:datasetId", element: datasets },
      { path: "training", element: training },
      { path: "training/:runId", element: training },
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
