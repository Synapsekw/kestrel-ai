import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { getCatalogue, type CatalogueEntry } from "@/api/plantItems";

/** The builder catalogue, read once per screen; [] until it arrives or when it fails (the editor then offers the item's own type only). */
export function useCatalogue(): readonly CatalogueEntry[] {
  const api = useApi();
  const [entries, setEntries] = useState<readonly CatalogueEntry[]>([]);
  useEffect(() => {
    let alive = true;
    getCatalogue(api).then(
      (e) => alive && setEntries(e ?? []),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [api]);
  return entries;
}
