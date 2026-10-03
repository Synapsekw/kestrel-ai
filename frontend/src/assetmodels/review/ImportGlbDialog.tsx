// src/assetmodels/review/ImportGlbDialog.tsx
// Spec §2 and §6.1: an existing GLB becomes a new version of this asset model, converted once into
// the asset frame (metres, Y up, X plant north, Z plant east). The import is a background job.
import { useState, type FormEvent } from "react";
import type { components } from "@contract/client";
import { importGlb } from "@/api/assetReview";
import { useApi, useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, Dialog, Field, Input, Select } from "@/ui";

type AssetFrameConversion = components["schemas"]["AssetFrameConversion"];

export const FRAME_CONVERSIONS: readonly { value: AssetFrameConversion; label: string }[] = [
  { value: "none", label: "Already in the asset frame: Y up, X north" },
  { value: "x_east_minus_z_north", label: "Y up, X east, minus Z north (most glTF exports)" },
  { value: "enu_z_up", label: "Z up, east and north (ENU)" },
];

const num = (s: string) => (s.trim() === "" ? null : Number(s));

export function ImportGlbDialog({
  projectId,
  modelId,
  onClose,
  onStarted,
}: {
  projectId: string;
  modelId: string;
  onClose(): void;
  onStarted(version: number, jobId: string): void;
}) {
  const api = useApi();
  const { mode } = useBackend();
  const [path, setPath] = useState("");
  const [conversion, setConversion] = useState<AssetFrameConversion>("none");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const origin = [num(lat), num(lon), num(alt)];
  const some = origin.some((v) => v !== null);
  const all = origin.every((v) => v !== null && Number.isFinite(v));
  const originError =
    some && !all ? "Enter latitude, longitude and ground altitude together, or none of them." : null;
  const ready = path.trim().length > 0 && !originError;

  async function browse() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: false, filters: [{ name: "glTF binary", extensions: ["glb"] }] });
    if (typeof picked === "string") setPath(picked);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const r = await importGlb(api, projectId, modelId, {
        path: path.trim(),
        frame_conversion: conversion,
        origin: all ? { lat: origin[0]!, lon: origin[1]!, ground_alt_m: origin[2]! } : null,
      });
      useJobsStore.getState().upsert(r.job);
      onStarted(r.version.version, r.job.id);
    } catch (err) {
      setError(messageOf(err, "The import could not start."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title="Import a GLB"
      description="The file is copied into the project and never changed. It becomes a new version of this asset model."
      onClose={() => !busy && onClose()}
      onSubmit={(e) => void submit(e)}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="import" loading={busy} disabled={!ready}>
            Import
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="GLB file" htmlFor="glb-path" error={error}>
          <div className="flex gap-2">
            <Input
              id="glb-path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="D:\models\asset.glb"
              className="min-w-0 flex-1 font-mono"
            />
            {mode === "tauri" && <Button onClick={() => void browse()}>Browse</Button>}
          </div>
        </Field>
        <Field label="Axes in the file" htmlFor="glb-frame">
          <Select
            id="glb-frame"
            value={conversion}
            onChange={(e) => setConversion(e.target.value as AssetFrameConversion)}
          >
            {FRAME_CONVERSIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <fieldset className="grid grid-cols-3 gap-2">
          <legend className="mb-1 text-xs text-muted">
            Where the asset stands (optional; puts it on the street map)
          </legend>
          <Field label="Latitude" htmlFor="glb-lat">
            <Input id="glb-lat" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
          </Field>
          <Field label="Longitude" htmlFor="glb-lon">
            <Input id="glb-lon" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} />
          </Field>
          <Field label="Ground altitude (m)" htmlFor="glb-alt">
            <Input id="glb-alt" inputMode="decimal" value={alt} onChange={(e) => setAlt(e.target.value)} />
          </Field>
        </fieldset>
        {originError && <Alert tone="warn">{originError}</Alert>}
      </div>
    </Dialog>
  );
}
