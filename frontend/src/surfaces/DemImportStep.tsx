import { useEffect, useState, type FormEvent } from "react";
import type { Surface } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { importElevation } from "@/api/elevations";
import { messageOf } from "@/api/errors";
import { listSurfaces } from "@/api/surfaces";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, Dialog, Field, Input, Segmented, Select } from "@/ui";
import {
  alignTargets,
  fileStem,
  initialDemForm,
  resolvedAlign,
  ROLE_OPTIONS,
  toElevationRequest,
  type DemField,
  type DemForm,
} from "./demImport";

/**
 * Add elevation → DSM / DTM GeoTIFF (M §7, R-W5-7): a measured surface imported as `kind = "dem"`.
 * No preview gate; `POST /elevations` refuses synchronously (422) what it cannot use — the dialog
 * shows why inline and stays open (PF12b); nothing is deferred to Jobs.
 */
export function DemImportStep({
  projectId,
  onBack,
  onClose,
  onStarted,
}: {
  projectId: string;
  onBack: () => void;
  onClose: () => void;
  onStarted: (surface: Surface) => void;
}) {
  const api = useApi();
  const { mode } = useBackend();
  const [targets, setTargets] = useState<Surface[]>([]);
  const [form, setForm] = useState<DemForm>(initialDemForm);
  const [fieldError, setFieldError] = useState<{ field: DemField; error: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listSurfaces(api, projectId)
      .then((all) => !cancelled && setTargets(alignTargets(all)))
      .catch(() => !cancelled && setTargets([]));
    return () => {
      cancelled = true;
    };
  }, [api, projectId]);

  const set = (patch: Partial<DemForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setFieldError(null);
  };
  const errorOf = (field: DemField) => (fieldError?.field === field ? fieldError.error : null);
  const align = resolvedAlign(form, targets);

  async function browse() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: false,
      filters: [{ name: "GeoTIFF", extensions: ["tif", "tiff"] }],
    });
    if (typeof picked === "string") set({ path: picked });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = toElevationRequest(form, targets);
    if (!r.ok) return setFieldError({ field: r.field, error: r.error });
    setBusy(true);
    setError(null);
    try {
      const res = await importElevation(api, projectId, r.body);
      useJobsStore.getState().upsert(res.job);
      onStarted(res.surface);
    } catch (err) {
      setError(messageOf(err, "could not start the import"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title="Add elevation"
      description="A DSM or DTM GeoTIFF with coordinates, imported as a surface for its survey date. It imports in the background."
      onClose={() => !busy && onClose()}
      onSubmit={(e) => void submit(e)}
      footer={
        <>
          <Button onClick={onBack} disabled={busy} icon="chevron-left">
            Back
          </Button>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="import" loading={busy}>
            Start import
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="GeoTIFF file" htmlFor="dem-path" error={errorOf("path")}>
          <div className="flex gap-2">
            <Input
              id="dem-path"
              value={form.path}
              onChange={(e) => set({ path: e.target.value })}
              placeholder="D:\surveys\2026-09-14-dsm.tif"
              className="min-w-0 flex-1 font-mono"
            />
            {mode === "tauri" && <Button onClick={() => void browse()}>Browse</Button>}
          </div>
        </Field>
        <Field label="Name" htmlFor="dem-name" hint="Defaults to the file name." error={errorOf("name")}>
          <Input
            id="dem-name"
            value={form.name ?? fileStem(form.path)}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
        <Segmented label="Role" options={ROLE_OPTIONS} value={form.role} onChange={(role) => set({ role })} />
        <Field
          label="Survey date"
          htmlFor="dem-date"
          hint="Leave empty to read it from the file."
          error={errorOf("capturedOn")}
        >
          <Input
            id="dem-date"
            type="date"
            value={form.capturedOn}
            onChange={(e) => set({ capturedOn: e.target.value })}
          />
        </Field>
        <Field
          label="Align to"
          htmlFor="dem-align"
          hint="The new surface takes that surface's grid, so volumes and profiles compare cell for cell."
        >
          <Select id="dem-align" value={align} onChange={(e) => set({ alignTo: e.target.value })}>
            {targets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.captured_on ?? "date not set"}
              </option>
            ))}
            <option value="">Keep the file's own grid</option>
          </Select>
        </Field>
        {align === "" && (
          <Field
            label="Cell size (m)"
            htmlFor="dem-cell"
            hint="Leave empty to use the file's cell, snapped to the standard sizes."
            error={errorOf("cellSize")}
          >
            <Input
              id="dem-cell"
              inputMode="decimal"
              value={form.cellSize}
              onChange={(e) => set({ cellSize: e.target.value })}
              className="font-mono"
            />
          </Field>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Dialog>
  );
}
