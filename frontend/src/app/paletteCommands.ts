import type { ApiClient, ClassDef, components } from "@contract/client";
import { unwrap } from "@/api/errors";
import { findingPath } from "@/findings/links";
import type { Command, CommandSource, IconName } from "@/ui";
import type { AddDataTile } from "./addDataStore";
import type { RouteAction } from "./routeActions";
import {
  PROJECT_TABS,
  RAIL_ENTRIES,
  RAIL_SETTINGS,
  SECONDARY_PAGES,
  railHref,
  type RouteInfo,
} from "./routeModel";

/** The Go to group (spec 2026-09-26-foundation section 5.4). */
export function goToCommands(
  info: RouteInfo,
  recent: readonly { id: string; name: string }[],
  go: (to: string) => void,
): Command[] {
  const out: Command[] = [...RAIL_ENTRIES, RAIL_SETTINGS].map((e) => ({
    id: `go:${e.id}`,
    title: e.label,
    icon: e.icon,
    hint: "Section",
    run: () => go(railHref(e, info.projectId)),
  }));
  if (info.projectId) {
    const base = `/p/${info.projectId}`;
    for (const t of PROJECT_TABS)
      out.push({
        id: `go:tab:${t.id}`,
        title: t.label,
        icon: t.icon,
        hint: "Tab",
        run: () => go(`${base}/${t.id}`),
      });
    for (const p of SECONDARY_PAGES)
      out.push({
        id: `go:page:${p.id}`,
        title: p.label,
        icon: p.icon,
        hint: "Page",
        run: () => go(`${base}/${p.id}`),
      });
  }
  for (const r of recent) {
    if (r.id === info.projectId) continue;
    out.push({
      id: `go:project:${r.id}`,
      title: r.name,
      icon: "folder",
      hint: "Project",
      run: () => go(`/p/${r.id}/overview`),
    });
  }
  return out;
}

const IMPORTERS: { tile: AddDataTile; title: string }[] = [
  { tile: "photos", title: "Add photos" },
  { tile: "orthomosaic", title: "Add an orthomosaic" },
  { tile: "elevation", title: "Add an elevation model" },
  { tile: "point_cloud", title: "Add a point cloud" },
];

/** The Actions group: the route's enabled actions, each importer, New project, reduced effects. */
export function actionCommands(o: {
  info: RouteInfo;
  actions: readonly RouteAction[];
  go: (to: string) => void;
  addData: (tile: AddDataTile | null) => void;
  toggleEffects: () => void;
}): Command[] {
  const out: Command[] = o.actions
    .filter((a) => !a.disabled)
    .map((a) => ({
      id: `action:${a.id}`,
      title: a.label,
      icon: a.icon,
      run: () => (a.to ? o.go(a.to) : a.run?.()),
    }));
  // The importers need the loaded project, exactly when the route's Add data is enabled.
  if (o.info.projectId && o.actions.some((a) => a.id === "add-data" && !a.disabled)) {
    for (const i of IMPORTERS)
      out.push({
        id: `action:add:${i.tile}`,
        title: i.title,
        icon: "plus",
        hint: "Add data",
        run: () => o.addData(i.tile),
      });
  }
  out.push({
    id: "action:new-project",
    title: "New project",
    icon: "plus",
    run: () => o.go("/projects?new=1"),
  });
  out.push({
    id: "action:toggle-effects",
    title: "Toggle reduced effects",
    icon: "layers",
    run: o.toggleEffects,
  });
  return out;
}

/** The human finding number (spec section 8.1): F- and at least four digits. */
export const formatFindingNumber = (n: number): string => `F-${String(n).padStart(4, "0")}`;

const DATA_LABEL: Record<string, string> = {
  image_set: "Photos",
  map: "Orthomosaic",
  elevation: "Elevation",
  point_cloud: "Point cloud",
  drawing: "Drawing",
};

const DATA_ICON: Record<string, IconName> = {
  image_set: "images",
  map: "map",
  elevation: "elevation",
  point_cloud: "cloud",
  drawing: "drawing",
};

export function dataHref(projectId: string, item: { id: string; type: string }): string {
  const base = `/p/${projectId}`;
  if (item.type === "map") return `${base}/maps/${item.id}`;
  if (item.type === "point_cloud") return `${base}/clouds/${item.id}`;
  if (item.type === "elevation") return `${base}/measurements`;
  if (item.type === "drawing") return `${base}/maps`;
  return `${base}/images`;
}

const excerpt = (note: string): string | undefined =>
  note ? (note.length > 60 ? `${note.slice(0, 57)}…` : note) : undefined;

type SearchResult = components["schemas"]["ProjectSearchResult"];

/**
 * One in-flight or last-settled `GET /search` request per distinct query text, shared by every
 * caller that asks for the same query while it is still current (findings.search and data.search
 * each ask once per keystroke, so this turns two source calls into one request).
 *
 * A cached entry is reused only while its own signal is still live: once the caller that started
 * it aborts (its debounce cycle was superseded by a newer keystroke), a later call for the same
 * query text starts a fresh request rather than replaying the abandoned one. A rejection — abort
 * or real failure — is never kept cached, so retyping the same query after either always tries
 * again instead of leaving the palette on a stuck "Couldn't search" (preflight F8).
 */
function searchCache(api: ApiClient, projectId: string) {
  let last: { q: string; signal: AbortSignal; result: Promise<SearchResult> } | null = null;
  return (q: string, signal: AbortSignal): Promise<SearchResult> => {
    if (!last || last.q !== q || last.signal.aborted) {
      const entry: { q: string; signal: AbortSignal; result: Promise<SearchResult> } = {
        q,
        signal,
        result: unwrap(
          api.GET("/api/v1/projects/{projectId}/search", {
            params: { path: { projectId }, query: { q, limit: 8 } },
            signal,
          }),
        ),
      };
      entry.result.catch(() => {
        // Never cache a failure (abort or real error): let the next call for this query retry.
        if (last === entry) last = null;
      });
      last = entry;
    }
    return last.result;
  };
}

/**
 * The Search groups (spec section 10.3): findings and data of the open project, 8 of each at most.
 * DS's `CommandSource` answers one group, so there are two sources; they share one
 * `GET /search` per query (the last query's promise is reused), so a keystroke costs one request.
 */
export function projectSearchSources(
  api: ApiClient,
  projectId: string,
  classes: readonly ClassDef[],
  go: (to: string) => void,
): CommandSource[] {
  const typeName = (id: string) => classes.find((c) => c.id === id)?.name ?? "Unknown type";
  const fetchOnce = searchCache(api, projectId);
  return [
    {
      id: "search:findings",
      label: "Findings",
      minQuery: 2,
      search: async (q, signal) =>
        (await fetchOnce(q, signal)).findings.map((f) => ({
          id: `finding:${f.id}`,
          title: `${formatFindingNumber(f.number)} · ${typeName(f.type_id)}`,
          hint: excerpt(f.note),
          icon: "findings" as IconName,
          run: () => go(findingPath(projectId, f.id)),
        })),
    },
    {
      id: "search:data",
      label: "Data",
      minQuery: 2,
      search: async (q, signal) =>
        (await fetchOnce(q, signal)).data.map((d) => ({
          id: `data:${d.id}`,
          title: d.label,
          hint: DATA_LABEL[d.type] ?? d.type,
          icon: DATA_ICON[d.type] ?? ("images" as IconName),
          run: () => go(dataHref(projectId, d)),
        })),
    },
  ];
}
