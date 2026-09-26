import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import type { CatalogueType } from "@/api/catalogue";
import {
  Checkbox,
  DataTable,
  EmptyState,
  GlassPanel,
  Input,
  Kbd,
  Pill,
  Segmented,
  SeverityPill,
  TypeChip,
  type Column,
} from "@/ui";
import { BackfillOffer } from "./BackfillOffer";
import {
  DEFAULT_FILTERS,
  filterTypes,
  migratedCount,
  type KindFilter,
  type TypeFilters,
} from "./catalogueModel";
import { ClassificationBanner } from "./ClassificationBanner";
import { TypeEditor } from "./TypeEditor";
import type { Catalogue } from "./useCatalogue";

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "defect", label: "Defects" },
  { value: "object", label: "Objects" },
];

const COLUMNS: Column<CatalogueType>[] = [
  {
    key: "name",
    header: "Type",
    width: "minmax(12rem,2fr)",
    render: (t) => <TypeChip name={t.name} colour={t.colour} kind={t.kind} />,
  },
  {
    key: "group",
    header: "Group",
    width: "minmax(8rem,1fr)",
    render: (t) => <span className="truncate text-muted">{t.group ?? "–"}</span>,
  },
  {
    key: "severity",
    header: "Default severity",
    width: "9rem",
    render: (t) =>
      t.kind === "defect" && t.default_severity != null ? (
        <SeverityPill level={t.default_severity} />
      ) : (
        <span className="text-dim">–</span>
      ),
  },
  {
    key: "hotkey",
    header: "Hotkey",
    width: "5rem",
    render: (t) => (t.hotkey ? <Kbd>{t.hotkey.toUpperCase()}</Kbd> : <span className="text-dim">–</span>),
  },
  {
    key: "state",
    header: "State",
    width: "9rem",
    render: (t) =>
      t.archived ? (
        <Pill size="sm">Archived</Pill>
      ) : t.origin === "migrated" ? (
        <Pill size="sm" tone="accent">
          From projects
        </Pill>
      ) : null,
  },
];

/** The Types sub-tab: filters, the types table and, from `?type=`, the editor (F §7.5). */
export function TypesPane({ catalogue }: { catalogue: Catalogue }) {
  const [params, setParams] = useSearchParams();
  const openId = params.get("type");
  const [filters, setFilters] = useState<TypeFilters>(DEFAULT_FILTERS);
  // BC's Overview banner links to /catalogue?origin=migrated; the flag may also come from the list.
  const fromBanner = params.get("origin") === "migrated";
  const showBanner = catalogue.needsClassification || fromBanner;
  // null follows the banner: filtered to migrated types while classification is pending (§7.5).
  const [migratedChoice, setMigratedChoice] = useState<boolean | null>(null);
  const migratedOnly = migratedChoice ?? showBanner;
  const [backfill, setBackfill] = useState<CatalogueType | null>(null);
  const rows = useMemo(
    () => filterTypes(catalogue.types, { ...filters, migratedOnly }),
    [catalogue.types, filters, migratedOnly],
  );

  const open = useCallback(
    (id: string | null) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          if (id) next.set("type", id);
          else next.delete("type");
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const editing: CatalogueType | null | undefined =
    openId === "new" ? null : catalogue.types.find((t) => t.id === openId);

  return (
    <div className="flex flex-col gap-4">
      {showBanner && (
        <ClassificationBanner
          count={migratedCount(catalogue.types)}
          filtered={migratedOnly}
          onShowAll={() => setMigratedChoice(false)}
          onShowMigrated={() => setMigratedChoice(true)}
          onDone={() => {
            setMigratedChoice(false);
            setParams(
              (p) => {
                const next = new URLSearchParams(p);
                next.delete("origin");
                return next;
              },
              { replace: true },
            );
            catalogue.reload();
          }}
        />
      )}
      {backfill && <BackfillOffer key={backfill.id} type={backfill} onDismiss={() => setBackfill(null)} />}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label="Search types"
          placeholder="Search types"
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          className="w-64"
        />
        <Segmented
          label="Kind"
          size="sm"
          options={KIND_FILTERS}
          value={filters.kind}
          onChange={(kind) => setFilters((f) => ({ ...f, kind }))}
        />
        <Checkbox
          label="Show archived"
          checked={filters.showArchived}
          onChange={(e) => setFilters((f) => ({ ...f, showArchived: e.target.checked }))}
        />
      </div>
      <div className="grid items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
        <GlassPanel variant="pane" className="min-w-0 overflow-hidden">
          <DataTable
            label="Catalogue types"
            columns={COLUMNS}
            rows={rows}
            rowKey={(t) => t.id}
            activeKey={openId}
            onOpen={(t) => open(t.id)}
            loading={catalogue.loading}
            empty={
              <EmptyState icon="catalogue" title="No types match">
                Change the filters, or add a type with New type.
              </EmptyState>
            }
          />
        </GlassPanel>
        {openId &&
          !catalogue.loading &&
          (editing === undefined ? (
            <GlassPanel variant="pane" className="p-4">
              <EmptyState icon="catalogue" title="That type is not in the catalogue">
                The link may be out of date. Choose a type from the list.
              </EmptyState>
            </GlassPanel>
          ) : (
            <TypeEditor
              key={openId}
              type={editing}
              types={catalogue.types}
              onSaved={(t, backfillCandidates) => {
                catalogue.put(t);
                if (backfillCandidates) setBackfill(t);
                open(t.id);
              }}
              onUseExisting={(id) => open(id)}
              onClose={() => open(null)}
            />
          ))}
      </div>
    </div>
  );
}

/** A small swatch for places that show a type colour without a chip (Task 15). */
export function TypeSwatch({ colour }: { colour: string }) {
  return (
    <span
      aria-hidden
      className="block h-3.5 w-3.5 shrink-0 rounded-sm bg-[var(--c)]"
      style={{ "--c": colour } as CSSProperties}
    />
  );
}
