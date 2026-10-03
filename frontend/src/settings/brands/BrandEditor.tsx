import { useId, useState, type ReactNode } from "react";
import { useApi } from "@/api/client";
import {
  BRAND_FONTS,
  deleteBrand,
  isBrandNameTaken,
  patchBrand,
  type Brand,
  type BrandLogoSlot,
} from "@/api/brands";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { ColourSwatch } from "@/catalogue/ColourSwatch";
import { Alert, Button, Dialog, Field, GlassPanel, Input, Pill, Select, Textarea } from "@/ui";
import { BrandCoverPreview } from "./BrandCoverPreview";
import { BrandLogoField } from "./BrandLogoField";
import {
  COLOUR_KEYS,
  COLOUR_LABELS,
  draftErrors,
  draftOf,
  hasErrors,
  patchOf,
  previewOf,
  type BrandDraft,
} from "./brandDraft";

const LOGOS: { slot: BrandLogoSlot; label: string; hint: string }[] = [
  { slot: "on_light", label: "Logo on light", hint: "For white bars and the report header." },
  { slot: "on_dark", label: "Logo on dark", hint: "A white version for the cover band." },
  { slot: "flat", label: "Flat logo", hint: "No transparency; used in the PDF running header." },
];

function Region({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="text-sm font-semibold text-ink">
        {title}
      </h3>
      {children}
    </section>
  );
}

function FontSelect({
  id,
  label,
  value,
  onChange,
  hint,
  disabled,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Select
        id={id}
        dense
        disabled={disabled}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Report default</option>
        {BRAND_FONTS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export interface BrandEditorProps {
  brand: Brand;
  onChange: (brand: Brand) => void;
  onDeleted: (brandId: string) => void;
}

/** Spec 2026-10-02-asset-findings §9 brand editor. Keyed by brand id in BrandsSection, so switching
 * brands starts a fresh draft; logo changes (saved at once) do not reset the draft. */
export function BrandEditor({ brand, onChange, onDeleted }: BrandEditorProps) {
  const api = useApi();
  const [draft, setDraft] = useState<BrandDraft>(() => draftOf(brand));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const errors = draftErrors(draft);
  const patch = patchOf(brand, draft);
  const dirty = Object.keys(patch).length > 0;
  const edit = (change: Partial<BrandDraft>) => {
    setDraft((d) => ({ ...d, ...change }));
    setSaved(false);
    if ("name" in change) setNameError(null);
  };

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const next = await patchBrand(api, brand.id, patch);
      onChange(next);
      setDraft(draftOf(next));
      setSaved(true);
    } catch (e) {
      pushLog(`brand save failed: ${messageOf(e, String(e))}`);
      if (isBrandNameTaken(e)) setNameError(messageOf(e, "That name is taken."));
      else setError(messageOf(e, "The brand could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await deleteBrand(api, brand.id);
      setConfirming(false);
      onDeleted(brand.id);
    } catch (e) {
      pushLog(`brand delete failed: ${messageOf(e, String(e))}`);
      setConfirming(false);
      setError(messageOf(e, "The brand could not be deleted."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5">
      <GlassPanel variant="pane" className="flex min-w-0 flex-col gap-5 p-4">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-base font-semibold">{brand.name}</h3>
          {brand.builtin && <Pill tone="accent">Built in</Pill>}
        </div>
        {brand.builtin && (
          <p className="text-xs text-muted">Built-in brands can be edited but not deleted.</p>
        )}
        {error && <Alert tone="danger">{error}</Alert>}

        {/* No Region wrapper: a section labelled "Name" would also match getByLabelText("Name"). */}
        <Field label="Name" htmlFor="brand-name" error={nameError ?? errors.name}>
          <Input
            id="brand-name"
            dense
            disabled={saving}
            value={draft.name}
            invalid={Boolean(nameError ?? errors.name)}
            onChange={(e) => edit({ name: e.target.value })}
          />
        </Field>

        <Region title="Colours">
          <div className="grid grid-cols-2 gap-3">
            {COLOUR_KEYS.map((key) => (
              <Field
                key={key}
                label={COLOUR_LABELS[key]}
                htmlFor={`brand-colour-${key}`}
                error={errors.colors[key]}
              >
                <div className="flex items-center gap-2">
                  <ColourSwatch
                    label={`${COLOUR_LABELS[key]} colour`}
                    value={/^#[0-9a-f]{6}$/i.test(draft.colors[key]) ? draft.colors[key] : brand.colors[key]}
                    disabled={saving}
                    onChange={(c) => edit({ colors: { ...draft.colors, [key]: c.toUpperCase() } })}
                  />
                  <Input
                    id={`brand-colour-${key}`}
                    aria-label={`${COLOUR_LABELS[key]} hex`}
                    dense
                    disabled={saving}
                    value={draft.colors[key]}
                    invalid={Boolean(errors.colors[key])}
                    onChange={(e) => edit({ colors: { ...draft.colors, [key]: e.target.value.trim() } })}
                    className="font-mono"
                  />
                </div>
              </Field>
            ))}
          </div>
        </Region>

        <Region title="Fonts">
          <div className="grid grid-cols-2 gap-3">
            <FontSelect
              id="brand-font-text"
              label="Text font"
              value={draft.font_text}
              disabled={saving}
              onChange={(v) => edit({ font_text: v })}
              hint={
                draft.font_text === "Poppins"
                  ? "Poppins is bundled in SemiBold and Bold only, so body text prints in SemiBold."
                  : undefined
              }
            />
            <FontSelect
              id="brand-font-numerals"
              label="Numerals font"
              value={draft.font_numerals}
              disabled={saving}
              onChange={(v) => edit({ font_numerals: v })}
            />
          </div>
        </Region>

        <Region title="Logos">
          {LOGOS.map((l) => (
            <BrandLogoField
              key={l.slot}
              brand={brand}
              slot={l.slot}
              label={l.label}
              hint={l.hint}
              onChange={onChange}
            />
          ))}
        </Region>

        <Region title="Footer and document">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Website" htmlFor="brand-website">
              <Input
                id="brand-website"
                dense
                disabled={saving}
                value={draft.website}
                onChange={(e) => edit({ website: e.target.value })}
              />
            </Field>
            <Field label="Owner" htmlFor="brand-owner">
              <Input
                id="brand-owner"
                dense
                disabled={saving}
                value={draft.owner}
                onChange={(e) => edit({ owner: e.target.value })}
              />
            </Field>
          </div>
          <Field label="PDF author" htmlFor="brand-pdf-author">
            <Input
              id="brand-pdf-author"
              dense
              disabled={saving}
              value={draft.pdf_author}
              onChange={(e) => edit({ pdf_author: e.target.value })}
            />
          </Field>
          <Field
            label="Confidentiality line"
            htmlFor="brand-confidentiality"
            hint="Use {year} and {customer}; they are filled in when the report renders."
          >
            <Textarea
              id="brand-confidentiality"
              rows={3}
              disabled={saving}
              value={draft.confidentiality}
              onChange={(e) => edit({ confidentiality: e.target.value })}
            />
          </Field>
        </Region>

        <div className="flex items-center gap-2 border-t border-line pt-4">
          <Button
            variant="primary"
            loading={saving}
            disabled={!dirty || hasErrors(errors)}
            onClick={() => void save()}
          >
            Save brand
          </Button>
          <span role="status" className="text-xs text-muted">
            {saved && !dirty ? "Saved" : null}
          </span>
          <span className="flex-1" />
          {!brand.builtin && (
            <Button variant="danger" icon="trash" onClick={() => setConfirming(true)}>
              Delete brand
            </Button>
          )}
        </div>
      </GlassPanel>

      <BrandCoverPreview brand={previewOf(brand, draft)} />

      <Dialog
        open={confirming}
        title={`Delete ${brand.name}?`}
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="secondary" disabled={deleting} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={() => void remove()}>
              Delete brand
            </Button>
          </>
        }
      >
        <p className="text-sm">Reports that use it will print with the Kestrel theme.</p>
      </Dialog>
    </div>
  );
}
