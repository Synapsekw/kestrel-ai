import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useApi } from "@/api/client";
import { listDrawings, type Drawing } from "@/api/drawings";
import { messageOf } from "@/api/errors";
import { ADD_DATA_LOADING, openAddData, useAddDataReady } from "@/data/addDataTiles";
import { DELETE_CONFIRM, removeDrawing } from "@/mapws/drawings/drawingActions";
import { ConfirmDeleteDialog } from "@/mapws/layers/ConfirmDeleteDialog";
import { useChangesStore } from "@/store/changes";
import { Alert, Button, DataTable, EmptyState, type Column } from "@/ui";

function detail(d: Drawing): string {
  const kind = d.format.toUpperCase();
  const page = d.page != null ? ` · page ${d.page}` : "";
  const place =
    d.status === "importing"
      ? "Importing"
      : d.status === "failed"
        ? "Failed"
        : d.georef
          ? "Placed"
          : "Not placed";
  return `${kind}${page} · ${place}`;
}

function useProjectDrawings(projectId: string): {
  status: "loading" | "ready" | "error";
  items: Drawing[];
  error: string | null;
  reload: () => void;
} {
  const api = useApi();
  const revision = useChangesStore((s) => `${s.mapWorkspaceRevision}|${s.dataRevision}`);
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error";
    items: Drawing[];
    error: string | null;
  }>({ status: "loading", items: [], error: null });

  useEffect(() => {
    let cancelled = false;
    listDrawings(api, projectId)
      .then((items) => {
        if (!cancelled) setState({ status: "ready", items, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setState((s) => ({
            status: "error",
            items: s.items,
            error: messageOf(e, "Could not list drawings."),
          }));
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, revision, tick]);

  return { ...state, reload: () => setTick((n) => n + 1) };
}

/** The project's Drawings tab: the imported plans, with import and delete. */
export function DrawingsScreen() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const api = useApi();
  const ready = useAddDataReady(projectId);
  const list = useProjectDrawings(projectId);
  const [pending, setPending] = useState<Drawing | null>(null);

  const columns: Column<Drawing>[] = [
    {
      key: "name",
      header: "Name",
      width: "minmax(0,2fr)",
      render: (d) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm text-ink">{d.name}</span>
          <span className="truncate text-xs text-muted">{detail(d)}</span>
        </span>
      ),
    },
    {
      key: "delete",
      header: "",
      width: "44px",
      align: "end",
      render: (d) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm"
            variant="ghost"
            icon="trash"
            aria-label={`Delete ${d.name}`}
            onClick={() => setPending(d)}
          />
        </span>
      ),
    },
  ];

  const empty = list.status === "ready" && list.items.length === 0;
  const failed = list.status === "error" && list.items.length === 0;
  const importDrawing = (
    <Button
      icon="plus"
      disabled={!ready}
      title={ready ? undefined : ADD_DATA_LOADING}
      onClick={() => openAddData("drawing")}
    >
      Import drawing
    </Button>
  );

  return (
    <section className="flex h-full min-h-0 flex-col gap-4" aria-label="Drawings">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Drawings</h1>
          <p className="text-sm text-muted">
            PDF plans, images, DXF and LandXML imported into this project. Open one to see it on the map.
          </p>
        </div>
        {importDrawing}
      </header>
      {list.status === "error" && (
        <Alert
          tone="danger"
          actions={
            <Button size="sm" onClick={list.reload}>
              Retry
            </Button>
          }
        >
          {list.error}
        </Alert>
      )}
      {failed ? null : empty ? (
        <EmptyState icon="drawing" title="No drawings yet" action={importDrawing}>
          Import a PDF, a plan image, a DXF or a LandXML file. Each page of a PDF becomes its own drawing.
        </EmptyState>
      ) : (
        <DataTable
          label="Drawings"
          className="min-h-0 flex-1"
          columns={columns}
          rows={list.items}
          rowKey={(d) => d.id}
          loading={list.status === "loading"}
          onOpen={(d) => void navigate(`/p/${projectId}/maps?sel=drawing:${d.id}`)}
        />
      )}
      {pending && (
        <ConfirmDeleteDialog
          title="Are you sure?"
          body={DELETE_CONFIRM}
          onConfirm={() => removeDrawing(api, projectId, pending.id)}
          onClose={() => setPending(null)}
        />
      )}
    </section>
  );
}
