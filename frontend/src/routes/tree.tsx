import type { RouteObject } from "react-router-dom";
import { NotFound } from "@/app/NotFound";
import { Shell } from "@/app/Shell";
import { ProjectsScreen } from "@/screens/ProjectsScreen";
import { appRoutes } from "./appRoutes";
import { legacyAppRedirects, legacyProjectRedirects } from "./legacyRedirects";
import { projectRoutes } from "./projectRoutes";
import { Redirect } from "./Redirect";

/** The whole route tree; `routes.tsx` makes the browser router from it, tests match against it. */
export const routeTree: RouteObject[] = [
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <Redirect to={() => "/projects"} /> },
      { path: "projects", element: <ProjectsScreen /> },
      ...appRoutes,
      ...legacyAppRedirects,
      {
        path: "p/:projectId",
        children: [
          { index: true, element: <Redirect to={(p) => `/p/${p.projectId}/overview`} /> },
          ...projectRoutes,
          ...legacyProjectRedirects,
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
];
