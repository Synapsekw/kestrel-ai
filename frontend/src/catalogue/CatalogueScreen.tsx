import { useMemo, useState } from "react";
import { useProvideRouteActions, type RouteAction } from "@/app/routeActions";
import { Alert, Button, Tabs } from "@/ui";
import { TypesPane } from "./TypesPane";
import { useCatalogue } from "./useCatalogue";

export type CatalogueTab = "types";

const TABS = [{ id: "types", to: "/catalogue", label: "Types", end: true }];

/** The 503 block (F §15). "Copy folder path" stands in for "Reveal folder" (plan decision 6). */
function CatalogueUnavailable({ folder }: { folder: string | null }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!folder) return;
    try {
      await navigator.clipboard.writeText(folder);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Alert
      tone="danger"
      title="The catalogue could not be opened"
      actions={
        folder ? (
          <Button size="sm" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy folder path"}
          </Button>
        ) : undefined
      }
    >
      <p>
        Projects still open and show their types from their own copy. Creating types, the severity scale and
        the findings backfill need the catalogue. Check the folder, then restart the app.
      </p>
      {folder && <p className="mt-1 break-all font-mono text-xs">{folder}</p>}
    </Alert>
  );
}

/** App-level Catalogue (F §7.5): defect and object types, and (Task 5) the severity scale. */
export function CatalogueScreen({ tab }: { tab: CatalogueTab }) {
  const catalogue = useCatalogue();
  const actions = useMemo<RouteAction[]>(
    () =>
      tab === "types" && !catalogue.unavailable
        ? [{ id: "new-type", label: "New type", icon: "plus", variant: "primary", to: "/catalogue?type=new" }]
        : [],
    [tab, catalogue.unavailable],
  );
  useProvideRouteActions(actions);

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Catalogue</h1>
        <p className="text-sm text-muted">
          The defect and object types every project picks from, and the severity scale findings are graded on.
        </p>
      </header>
      <Tabs asLinks label="Catalogue sections" items={TABS} />
      {catalogue.unavailable ? (
        <CatalogueUnavailable folder={catalogue.folder} />
      ) : catalogue.error ? (
        <Alert
          tone="danger"
          actions={
            <Button size="sm" onClick={catalogue.reload}>
              Retry
            </Button>
          }
        >
          {catalogue.error}
        </Alert>
      ) : (
        <TypesPane catalogue={catalogue} />
      )}
    </section>
  );
}
