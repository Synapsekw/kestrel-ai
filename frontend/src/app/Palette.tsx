import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Project } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf, unwrap } from "@/api/errors";
import { setEffectsChoice } from "@/app/effects";
import { pushLog } from "@/app/diagnostics";
import { CommandPalette } from "@/ui";
import { useAddData } from "./addDataStore";
import { collectCommands, useCommandRegistry } from "./commands";
import { actionCommands, goToCommands, projectSearchSources } from "./paletteCommands";
import { useRouteActions } from "./routeActions";
import { routeInfo } from "./routeModel";

/** Recent projects for Go to, read when the palette opens (GET /projects is bounded at 20). */
function useRecentProjects(open: boolean): { id: string; name: string }[] {
  const api = useApi();
  const [recent, setRecent] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    unwrap(api.GET("/api/v1/projects", { params: { query: { limit: 20 } } }))
      .then((page) => {
        if (!cancelled)
          setRecent(
            // Only projects that open: not a missing folder (C0 `availability`) nor an unfinished upgrade.
            page.items
              .filter((p) => p.availability === "ok" && p.migration.state === "ok")
              .map((p) => ({ id: p.id, name: p.name })),
          );
      })
      .catch((e: unknown) => pushLog(`palette projects unavailable: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, open]);
  return recent;
}

/** The Ctrl K command palette (spec 2026-09-26-foundation section 5.4). */
export function Palette({
  open,
  onClose,
  project,
}: {
  open: boolean;
  onClose: () => void;
  project: Project | null;
}) {
  const api = useApi();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const actions = useRouteActions();
  const entries = useCommandRegistry((s) => s.entries);
  const recent = useRecentProjects(open);
  const info = useMemo(() => routeInfo(pathname), [pathname]);
  const go = useMemo(
    () => (to: string) => {
      onClose();
      void navigate(to);
    },
    [navigate, onClose],
  );
  const groups = useMemo(
    () => [
      { label: "Go to", items: [...goToCommands(info, recent, go), ...collectCommands(entries, "Go to")] },
      {
        label: "Actions",
        items: [
          ...actionCommands({
            info,
            actions,
            go,
            addData: (tile) => {
              onClose();
              useAddData.getState().show(tile);
            },
            // The effective mode (Auto may have resolved to either) is on <html data-effects>.
            toggleEffects: () =>
              setEffectsChoice(document.documentElement.dataset.effects === "reduced" ? "full" : "reduced"),
          }),
          ...collectCommands(entries, "Actions"),
        ],
      },
    ],
    [info, recent, go, entries, actions, onClose],
  );
  const sources = useMemo(
    () => (info.projectId ? projectSearchSources(api, info.projectId, project?.classes ?? [], go) : []),
    [api, info.projectId, project, go],
  );
  return <CommandPalette open={open} onClose={onClose} groups={groups} sources={sources} />;
}
