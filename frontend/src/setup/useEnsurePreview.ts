import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { normaliseName } from "@/catalogue/normaliseName";
import { ensureTypes, type EnsuredType } from "./api";
import { ENSURE_DEBOUNCE_MS, specOf, type DraftType } from "./model";

const NONE: ReadonlyMap<string, EnsuredType> = new Map();

/**
 * S1-3 before Create: a dry-run `ensure` once the list has settled for 300 ms, keyed by normalised
 * name. Nothing is written. The last answer stays in view while the next one is pending.
 */
export function useEnsurePreview(
  types: readonly DraftType[],
  enabled: boolean,
): ReadonlyMap<string, EnsuredType> {
  const api = useApi();
  const [found, setFound] = useState<ReadonlyMap<string, EnsuredType>>(NONE);
  const specs = useMemo(() => types.map(specOf), [types]);

  useEffect(() => {
    if (!enabled || specs.length === 0) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      ensureTypes(api, { types: specs, dry_run: true })
        .then((r) => {
          if (!cancelled) setFound(new Map(r.items.map((i) => [normaliseName(i.name), i])));
        })
        .catch((e: unknown) => pushLog(`ensure preview failed: ${messageOf(e, String(e))}`));
    }, ENSURE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api, specs, enabled]);

  return enabled ? found : NONE;
}
