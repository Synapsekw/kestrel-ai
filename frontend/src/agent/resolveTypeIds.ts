import type { ApiClient, CatalogueType } from "@contract/client";
import { codeOf, unwrap } from "@/api/errors";

/** Thrown by {@link resolveTypeIds} when the catalogue cannot be reached (503 `catalogue_unavailable`). */
export class CatalogueUnavailableError extends Error {
  constructor(message = "The catalogue is unavailable.") {
    super(message);
    this.name = "CatalogueUnavailableError";
  }
}

/** One name's worth of results: the catalogue's `q` is a substring match, never a full-catalogue walk. */
const LIST_LIMIT = 20;

/** Casefold, trim, `_`/`-` as spaces, runs of spaces collapsed — mirrors the backend's `normalise_name`
 * (`backend/app/catalogue/names.py`) so the exact type behind a name is picked out of `q`'s substring
 * results (a substring hit that is not an exact match is never reused). `toLowerCase`, not the
 * locale-sensitive variant, so the key never depends on the machine's locale. */
function normaliseName(name: string): string {
  return name.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Re-throws a 503 `catalogue_unavailable` as the typed error callers switch on; anything else as-is. */
async function guarded<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (codeOf(e) === "catalogue_unavailable") throw new CatalogueUnavailableError();
    throw e;
  }
}

async function findExact(api: ApiClient, name: string, key: string): Promise<CatalogueType | null> {
  const page = await guarded(() =>
    unwrap(
      api.GET("/api/v1/catalogue/types", {
        params: { query: { q: name.trim(), limit: LIST_LIMIT } },
      }),
    ),
  );
  return page.items.find((t) => normaliseName(t.name) === key) ?? null;
}

/**
 * Resolve each of the Setup agent's planned class names (`plan.classes`, `agent/useSetupAgent.ts`) to a
 * catalogue type id: reuse a live type whose normalised name matches, else create it as an `object`
 * type. Names that normalise alike are resolved once (first-seen order), so each type id appears once;
 * at most one list request and one create per distinct name (≤ 32 names). A 409 `type_exists` race (another create won first) re-lists and takes the match. A 503
 * `catalogue_unavailable` throws {@link CatalogueUnavailableError} for the caller to fall back on.
 */
export async function resolveTypeIds(api: ApiClient, names: readonly string[]): Promise<string[]> {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const key = normaliseName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    let match = await findExact(api, name, key);
    if (!match) {
      try {
        match = await guarded(() =>
          unwrap(api.POST("/api/v1/catalogue/types", { body: { name: name.trim(), kind: "object" } })),
        );
      } catch (e) {
        if (codeOf(e) !== "type_exists") throw e;
        match = await findExact(api, name, key);
      }
    }
    if (!match) throw new Error(`Could not resolve or create the catalogue type "${name}".`);
    ids.push(match.id);
  }
  return ids;
}
