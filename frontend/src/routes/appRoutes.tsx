import type { RouteObject } from "react-router-dom";
import { InterimJobs } from "@/app/InterimJobs";
import { SectionPlaceholder } from "@/app/InterimScreens";
import { AboutScreen, Later } from "@/app/lazyScreens";
import { LibraryScreen } from "@/library/LibraryScreen";
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
const catalogue = (
  <SectionPlaceholder title="Catalogue" icon="catalogue">
    The defect and object types your projects use, and the severity scale, are managed here.
  </SectionPlaceholder>
);

/** The app-level routes (spec 2026-09-26-foundation section 5.3). S2 adds or swaps entries here only. */
export const appRoutes: RouteObject[] = [
  { path: "models", element: <Redirect to={() => "/models/library"} /> },
  { path: "models/library", element: <LibraryScreen /> },
  { path: "models/datasets", element: datasets },
  { path: "models/datasets/:datasetId", element: datasets },
  { path: "models/training", element: training },
  { path: "models/training/:runId", element: training },
  { path: "catalogue", element: catalogue },
  { path: "catalogue/severity", element: catalogue },
  { path: "jobs", element: <InterimJobs /> },
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
