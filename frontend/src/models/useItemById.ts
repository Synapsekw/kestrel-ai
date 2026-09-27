import { useEffect, useRef, useState } from "react";
import { ApiFailure, codeOf, messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";

export interface ItemById<T> {
  item: T | null;
  /** The server answered 404: the link names something that no longer exists. */
  missing: boolean;
  error: string | null;
}

/**
 * The item a route names: from the loaded pages when it is there, else fetched by id (a deep link
 * past page one, or one copied before a restart). A 404 is `missing`, never an endless skeleton.
 */
export function useItemById<T extends { id: string }>(
  id: string | null,
  known: T[],
  listLoading: boolean,
  fetchById: (id: string) => Promise<T>,
  what: string,
): ItemById<T> {
  const fromList = id ? (known.find((x) => x.id === id) ?? null) : null;
  const need = Boolean(id) && !fromList && !listLoading;
  const fetchRef = useRef(fetchById);
  useEffect(() => {
    fetchRef.current = fetchById;
  }, [fetchById]);
  const [fetched, setFetched] = useState<({ id: string } & ItemById<T>) | null>(null);

  useEffect(() => {
    if (!need || !id) return;
    let cancelled = false;
    fetchRef
      .current(id)
      .then((item) => {
        if (!cancelled) setFetched({ id, item, missing: false, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load ${what} ${id} failed: ${messageOf(e, String(e))}`);
        const missing = codeOf(e) === "not_found" || (e instanceof ApiFailure && e.status === 404);
        setFetched({
          id,
          item: null,
          missing,
          error: missing ? null : messageOf(e, `could not load the ${what}`),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [id, need, what]);

  if (fromList) return { item: fromList, missing: false, error: null };
  if (fetched && fetched.id === id)
    return { item: fetched.item, missing: fetched.missing, error: fetched.error };
  return { item: null, missing: false, error: null };
}
