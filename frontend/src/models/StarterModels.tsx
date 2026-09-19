import { useCallback, useEffect, useState } from "react";
import type { Model, StarterModel } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { importStarterModel, listStarterModels } from "@/api/starterModels";
import { pushLog } from "@/app/diagnostics";

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
    <section className="flex flex-col gap-3 rounded border border-slate-700 bg-slate-800/40 p-4">
      <div>
        <h2 className="text-lg font-medium">Starter models</h2>
        <p className="text-sm text-slate-400">
          General-purpose weights that ship with the app. Add one to use it as the base model for training; on
          aerial imagery they find little by themselves.
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {starters.map((s) => {
          const inRegistry = existingNames.includes(registryName(s.key));
          return (
            <div
              key={s.key}
              data-testid={`starter-${s.key}`}
              className="flex flex-col gap-2 rounded border border-slate-700 bg-slate-900/60 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{s.name}</span>
                {inRegistry && (
                  <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                    In the registry
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">{s.description}</p>
              <p className="text-xs text-slate-500">
                {s.available ? `${s.size_mb} MB` : "not part of this build; run fetch_starter_weights.ps1"}
              </p>
              <button
                type="button"
                onClick={() => void add(s.key)}
                disabled={!s.available || busyKey === s.key}
                className="mt-auto rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50"
              >
                Add {s.name}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
