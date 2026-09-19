import { useCallback, useEffect, useState } from "react";
import type { Model, StarterModel } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { importStarterModel, listStarterModels } from "@/api/starterModels";
import { pushLog } from "@/app/diagnostics";
import { Alert, Button, Pill } from "@/ui";

interface Props {
  projectId: string;
  existingNames: string[];
  onImported: (model: Model) => void;
}

/** The registry name a starter import gets when no override is given (`starter.import_starter`). */
function registryName(key: string): string {
  return `${key}-coco`;
}

/** General-purpose base weights bundled with the app (usability gap G1). */
export function StarterModels({ projectId, existingNames, onImported }: Props) {
  const api = useApi();
  const [starters, setStarters] = useState<StarterModel[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listStarterModels(api)
      .then((items) => {
        if (!cancelled) setStarters(items);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load starter models failed: ${messageOf(e, String(e))}`);
        setError(messageOf(e, "could not load the starter models"));
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const add = useCallback(
    async (key: StarterModel["key"]) => {
      setBusyKey(key);
      setError(null);
      try {
        const model = await importStarterModel(api, projectId, key);
        onImported(model);
      } catch (e) {
        pushLog(`import starter model failed: ${messageOf(e, String(e))}`);
        setError(messageOf(e, "could not add the starter model"));
      } finally {
        setBusyKey(null);
      }
    },
    [api, projectId, onImported],
  );

  if (starters.length === 0 && !error) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Starter models</h2>
        <p className="max-w-prose text-sm leading-relaxed text-muted">
          General-purpose weights that ship with the app. Add one to use it as the base model for training; on
          aerial imagery they find little by themselves.
        </p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {starters.map((s) => {
          const inRegistry = existingNames.includes(registryName(s.key));
          const adding = busyKey === s.key;
          return (
            <div
              key={s.key}
              data-testid={`starter-${s.key}`}
              className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{s.name}</span>
                {inRegistry && (
                  <Pill tone="neutral" size="sm">
                    In the registry
                  </Pill>
                )}
              </div>
              <p className="text-[13px] leading-relaxed text-muted">{s.description}</p>
              <p className="text-xs tabular-nums text-muted">
                {s.available ? `${s.size_mb} MB` : "Not included in this copy of the app."}
              </p>
              <Button
                size="sm"
                icon="plus"
                loading={adding}
                aria-label={adding ? undefined : `Add ${s.name}`}
                onClick={() => void add(s.key)}
                disabled={!s.available || busyKey !== null}
                className="mt-auto self-start"
              >
                {adding ? "Adding…" : "Add to project"}
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
