import { useEffect, useId, useState } from "react";
import type { Job, StarterModel } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { acquireStarter } from "@/api/library";
import { listStarterModels } from "@/api/starterModels";
import { Alert, Button, Field, Pill, Select } from "@/ui";

interface Props {
  /** Library model names, to mark a starter that was added before (`<key>-coco`). */
  existingNames: string[];
  /** The download runs as a library job; the caller shows its progress and selects the model. */
  onStarted: (job: Job) => void;
}

/** Choose a starter family and size and add it to the library; only the chosen weights are downloaded. */
export function StarterModels({ existingNames, onStarted }: Props) {
  const api = useApi();
  const id = useId();
  const [starters, setStarters] = useState<StarterModel[]>([]);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listStarterModels(api)
      .then((items) => {
        if (!cancelled) {
          setStarters(items);
          setKey(items[0]?.key ?? "");
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(messageOf(e, "Could not load starter models."));
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const familyOf = (s: StarterModel) => s.family ?? s.name.split(" ")[0];
  const selected = starters.find((s) => s.key === key) ?? starters[0];
  const family = selected ? familyOf(selected) : "";
  const families = [...new Set(starters.map(familyOf))];

  async function add() {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      onStarted(await acquireStarter(api, selected.key));
    } catch (e) {
      setError(messageOf(e, "Could not start the model download."));
    } finally {
      setBusy(false);
    }
  }

  if (starters.length === 0 && !error) return null;

  return (
    <section aria-label="Starter models" className="flex max-w-3xl flex-col gap-3">
      <p className="max-w-prose text-sm leading-relaxed text-muted">
        General-purpose models to start training from. Only the model you add is downloaded. Train it on your
        own labeled images before relying on its counts.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      {selected && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Model family" htmlFor={`${id}-family`}>
              <Select
                id={`${id}-family`}
                value={family}
                disabled={busy}
                onChange={(e) => setKey(starters.find((s) => familyOf(s) === e.target.value)?.key ?? "")}
              >
                {families.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Starter model" htmlFor={`${id}-model`}>
              <Select
                id={`${id}-model`}
                value={selected.key}
                disabled={busy}
                onChange={(e) => setKey(e.target.value)}
              >
                {starters
                  .filter((s) => familyOf(s) === family)
                  .map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
          <p className="text-sm text-muted">{selected.description}</p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs tabular-nums text-muted">
              {selected.available
                ? `${selected.size_mb} MB · Ready on this computer`
                : "Internet required for the first download"}
            </span>
            {existingNames.includes(`${selected.key}-coco`) && (
              <Pill tone="neutral" size="sm">
                In the library
              </Pill>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              icon="plus"
              loading={busy}
              disabled={busy}
              aria-label={`${selected.available ? "Add" : "Download and add"} ${selected.name}`}
              onClick={() => void add()}
            >
              {selected.available ? "Add" : "Download and add"}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
