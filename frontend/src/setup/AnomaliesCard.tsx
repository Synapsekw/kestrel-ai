import { useEffect, useMemo, useState } from "react";
import type { CatalogueType } from "@/api/catalogue";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { normaliseName } from "@/catalogue/normaliseName";
import { fetchPickableTypes } from "@/screens/projects/catalogueTypes";
import { Button } from "@/ui";
import { CataloguePicker } from "./CataloguePicker";
import { useSetupDraft } from "./draftStore";
import { hotkeyClashes, specFromCatalogue } from "./model";
import { NewTypeForm } from "./NewTypeForm";
import { SetupCard } from "./SetupCard";
import { TypeRow } from "./TypeRow";
import { useEnsurePreview } from "./useEnsurePreview";

/** Card 4 (spec §8 Anomalies): the list, Add from Catalogue, New type; conflicts and clashes before Create. */
export function AnomaliesCard() {
  const api = useApi();
  const types = useSetupDraft((s) => s.types);
  const setType = useSetupDraft((s) => s.setType);
  const addType = useSetupDraft((s) => s.addType);
  const removeType = useSetupDraft((s) => s.removeType);
  const [catalogue, setCatalogue] = useState<{ items: CatalogueType[]; error: string | null } | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPickableTypes(api)
      .then((items) => {
        if (!cancelled) setCatalogue({ items, error: null });
      })
      .catch((e: unknown) => {
        pushLog(`catalogue unavailable: ${messageOf(e, String(e))}`);
        if (!cancelled) setCatalogue({ items: [], error: messageOf(e, "the catalogue is unavailable") });
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const catalogueUp = catalogue !== null && catalogue.error === null;
  const preview = useEnsurePreview(types, catalogueUp);
  const clashes = useMemo(() => hotkeyClashes(types), [types]);
  const listed = useMemo(() => new Set(types.map((t) => normaliseName(t.name))), [types]);
  const pickable = (catalogue?.items ?? []).filter((t) => !listed.has(normaliseName(t.name)));

  return (
    <SetupCard
      n={4}
      title="Anomalies to look for"
      aside={`${types.length} ${types.length === 1 ? "type" : "types"}. Every type also lands in the app-wide Catalogue.`}
    >
      {types.length > 0 ? (
        <ul aria-label="Anomaly types" className="flex flex-col gap-1.5">
          {types.map((t) => (
            <TypeRow
              key={t.key}
              type={t}
              conflict={preview.get(normaliseName(t.name))?.conflict ?? null}
              clashWith={clashes.get(t.key) ?? null}
              onChange={(patch) => setType(t.key, patch)}
              onRemove={() => removeType(t.key)}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">
          No anomaly types yet. Add them from the Catalogue or make a new one. You can also add them later in
          Project settings.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <CataloguePicker
          items={pickable}
          unavailable={catalogue?.error ?? null}
          loading={catalogue === null}
          onPick={(t) => addType(specFromCatalogue(t))}
        />
        <Button variant="ghost" icon="plus" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
          New type
        </Button>
      </div>
      {catalogue?.error && (
        <p className="text-xs text-muted">
          {`The catalogue is unavailable, so types can be added later in Project settings. (${catalogue.error})`}
        </p>
      )}
      {adding && <NewTypeForm types={types} onAdd={addType} onDone={() => setAdding(false)} />}
    </SetupCard>
  );
}
