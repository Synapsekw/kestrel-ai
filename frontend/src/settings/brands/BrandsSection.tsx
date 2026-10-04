import { useState } from "react";
import { useApi } from "@/api/client";
import { createBrand, useBrands } from "@/api/brands";
import { messageOf } from "@/api/errors";
import { Alert, Button, GlassPanel, Pill, Skeleton, cx, focusRing } from "@/ui";
import { BrandEditor } from "./BrandEditor";
import { nextBrandName } from "./brandDraft";

/** App settings → Report brands (spec 2026-10-02-asset-findings §9): the list, then the editor. */
export function BrandsSection() {
  const api = useApi();
  const list = useBrands();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = list.brands.find((b) => b.id === selectedId) ?? list.brands[0] ?? null;

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const b = await createBrand(api, { name: nextBrandName(list.brands.map((x) => x.name)) });
      list.add(b);
      setSelectedId(b.id);
    } catch (e) {
      setError(messageOf(e, "The brand could not be created."));
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="flex flex-col gap-5 py-6" aria-labelledby="brands-title">
      <div className="flex flex-col gap-1">
        <h2 id="brands-title" className="text-lg font-semibold">
          Report brands
        </h2>
        <p className="text-sm text-muted">
          Colours, fonts, logos and footer text a report can print with. Pick one in a report&apos;s settings.
        </p>
      </div>
      {list.unavailable && <Alert tone="info">Brands are not available yet.</Alert>}
      {list.error && <Alert tone="danger">{list.error}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      {list.loading ? (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading brands">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : list.unavailable || list.error ? null : (
        <div className="grid grid-cols-[12rem_minmax(0,1fr)] items-start gap-4">
          <GlassPanel variant="pane" className="flex flex-col gap-2 p-2">
            <ul aria-label="Brands" className="flex flex-col gap-0.5">
              {list.brands.map((b) => {
                const active = selected?.id === b.id;
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      aria-current={active || undefined}
                      onClick={() => setSelectedId(b.id)}
                      className={cx(
                        "flex w-full items-center justify-between gap-2 rounded-control px-2.5 py-1.5 text-left text-sm",
                        focusRing,
                        active ? "bg-accent-soft text-accent-ink" : "text-ink hover:bg-surface-2",
                      )}
                    >
                      <span className="min-w-0 truncate">{b.name}</span>
                      {b.builtin && (
                        <Pill size="sm" tone="neutral">
                          Built in
                        </Pill>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            <Button size="sm" icon="plus" loading={creating} onClick={() => void create()}>
              New brand
            </Button>
          </GlassPanel>
          {selected && (
            <BrandEditor
              key={selected.id}
              brand={selected}
              onChange={list.replace}
              onDeleted={(id) => {
                list.remove(id);
                setSelectedId(null);
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}
