import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useProvideRouteActions, type RouteAction } from "@/app/routeActions";
import { siteHref, type SiteAt } from "./links";

/**
 * The Map and Cloud workspaces' "Open site in 3D" (Ruling 14): a top-bar action that opens the site
 * view at the workspace's current spot. `where` is read at click time, so panning never re-registers.
 */
export function useOpenSiteAction(projectId: string, where: () => SiteAt | null): void {
  const navigate = useNavigate();
  const whereRef = useRef(where);
  useEffect(() => {
    whereRef.current = where;
  });
  const actions = useMemo<RouteAction[]>(
    () => [
      {
        id: "open-site-3d",
        label: "Open site in 3D",
        icon: "cube",
        variant: "secondary",
        tooltip: "The plant model with the ortho, the point cloud and the drawings",
        run: () => navigate(siteHref(projectId, null, whereRef.current())),
      },
    ],
    [navigate, projectId],
  );
  useProvideRouteActions(actions);
}
