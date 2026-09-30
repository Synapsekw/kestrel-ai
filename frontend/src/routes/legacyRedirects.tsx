import type { RouteObject } from "react-router-dom";
import { MapRedirect } from "./MapRedirect";
import { Redirect } from "./Redirect";

/** Old project addresses (spec 2026-09-26-foundation section 5.3), relative to `p/:projectId`. */
export const legacyProjectRedirects: RouteObject[] = [
  { path: "data", element: <Redirect to={(p) => `/p/${p.projectId}/images`} /> },
  { path: "edit/:imageId", element: <Redirect to={(p) => `/p/${p.projectId}/images/${p.imageId}`} /> },
  { path: "label", element: <Redirect to={(p) => `/p/${p.projectId}/images?filter=unlabeled`} /> },
  { path: "query", element: <Redirect to={(p) => `/p/${p.projectId}/images?batch=1`} /> },
  { path: "past", element: <Redirect to={(p) => `/p/${p.projectId}/overview`} /> },
  { path: "past/maps/:mapId", element: <MapRedirect /> },
  { path: "maps/:mapId", element: <MapRedirect /> },
  { path: "sources", element: <Redirect to={(p) => `/p/${p.projectId}/maps`} /> },
  { path: "surveys", element: <Redirect to={(p) => `/p/${p.projectId}/analytics`} /> },
  { path: "volumes", element: <Redirect to={(p) => `/p/${p.projectId}/measurements/volumes`} /> },
  {
    path: "volumes/:measurementId",
    element: <Redirect to={(p) => `/p/${p.projectId}/measurements/volumes/${p.measurementId}`} />,
  },
  // F's interim host put a volume at measurements/:id; the tab now owns /measurements (M-W6).
  {
    path: "measurements/:measurementId",
    element: <Redirect to={(p) => `/p/${p.projectId}/measurements/volumes/${p.measurementId}`} />,
  },
  { path: "datasets", element: <Redirect to={(p) => `/models/datasets?project=${p.projectId}`} /> },
  { path: "train", element: <Redirect to={() => "/models/training"} /> },
  // The Export screen is Reports → Data exports (reports spec §13).
  { path: "export", element: <Redirect to={(p) => `/p/${p.projectId}/reports/exports`} /> },
];

/** Old app addresses. */
export const legacyAppRedirects: RouteObject[] = [
  { path: "library", element: <Redirect to={() => "/models/library"} /> },
];
