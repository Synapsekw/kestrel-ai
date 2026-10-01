import { useId, useState, type ReactNode } from "react";
import { useApi, useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import { importReportAsset, type ReportAsset, type ReportConfig } from "@/api/reports";
import { pushLog } from "@/app/diagnostics";
import { Button, Field, Icon, Input, Segmented } from "@/ui";
import { ReportFilters } from "./ReportFilters";

type Cover = ReportConfig["cover"];
type PaperSize = ReportConfig["paper"]["size"];

export interface ReportSettingsProps {
  projectId: string;
  config: ReportConfig;
  onEdit: (change: (c: ReportConfig) => ReportConfig) => void;
  matchCount: number | null;
}

function Region({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-sm font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string | null | undefined;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Input id={id} dense value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/** The builder's right pane (spec §12): the cover fields with the logo picker, the paper, and the filters. */
export function ReportSettings({ projectId, config, onEdit, matchCount }: ReportSettingsProps) {
  const cover = config.cover;
  const setCover = (patch: Partial<Cover>) => onEdit((c) => ({ ...c, cover: { ...c.cover, ...patch } }));
  const optional = (v: string): string | null => (v.trim() ? v : null);

  return (
    <div className="flex flex-col gap-6">
      <Region title="Cover">
        <TextField
          id="report-cover-title"
          label="Title"
          value={cover.title}
          onChange={(v) => setCover({ title: v })}
        />
        <TextField
          id="report-cover-subtitle"
          label="Subtitle"
          value={cover.subtitle}
          onChange={(v) => setCover({ subtitle: optional(v) })}
        />
        <div className="grid grid-cols-2 gap-2">
          <TextField
            id="report-cover-site"
            label="Site"
            value={cover.site}
            onChange={(v) => setCover({ site: optional(v) })}
          />
          <TextField
            id="report-cover-client"
            label="Client"
            value={cover.client}
            onChange={(v) => setCover({ client: optional(v) })}
          />
        </div>
        <TextField
          id="report-cover-author"
          label="Author"
          value={cover.author}
          onChange={(v) => setCover({ author: v })}
        />
        <Field label="Report date" htmlFor="report-cover-date" hint="Empty: the day the report is rendered.">
          <Input
            id="report-cover-date"
            type="date"
            dense
            value={cover.report_date ?? ""}
            onChange={(e) => setCover({ report_date: e.target.value || null })}
          />
        </Field>
        <LogoPicker
          projectId={projectId}
          assetId={cover.logo_asset_id ?? null}
          onChange={(id) => setCover({ logo_asset_id: id })}
        />
      </Region>

      <Region title="Paper">
        <Segmented<PaperSize>
          label="Paper size"
          size="sm"
          options={[
            { value: "A4", label: "A4" },
            { value: "Letter", label: "Letter" },
          ]}
          value={config.paper.size}
          onChange={(size) => onEdit((c) => ({ ...c, paper: { ...c.paper, size } }))}
          className="self-start"
        />
        <p className="text-2xs text-muted">Portrait; landscape pages come later.</p>
      </Region>

      <Region title="Filters">
        <ReportFilters
          projectId={projectId}
          filters={config.filters}
          matchCount={matchCount}
          onChange={(filters) => onEdit((c) => ({ ...c, filters }))}
        />
      </Region>
    </div>
  );
}

/** Spec §12: the dialog plugin's `open`, then `POST report-assets`. Outside the shell: a path field (Ruling 16). */
function LogoPicker({
  projectId,
  assetId,
  onChange,
}: {
  projectId: string;
  assetId: string | null;
  onChange: (id: string | null) => void;
}) {
  const api = useApi();
  const { mode } = useBackend();
  const [asset, setAsset] = useState<ReportAsset | null>(null);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(file: string) {
    setBusy(true);
    setError(null);
    try {
      const a = await importReportAsset(api, projectId, file);
      setAsset(a);
      setPath("");
      onChange(a.id);
    } catch (e) {
      pushLog(`logo import failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not add the logo; pick a PNG or JPEG under 20 MB"));
    } finally {
      setBusy(false);
    }
  }

  async function pick() {
    setError(null);
    let picked: unknown;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      picked = await open({
        multiple: false,
        filters: [{ name: "Logo", extensions: ["png", "jpg", "jpeg", "webp"] }],
      });
    } catch (e) {
      pushLog(`logo file dialog failed: ${messageOf(e, String(e))}`);
      setError(`The file dialog did not open. Try ${assetId ? "Replace logo" : "Choose logo"} again.`);
      return;
    }
    if (typeof picked === "string") await add(picked);
  }

  const shown = asset && asset.id === assetId ? asset : null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">Logo</span>
      {assetId && (
        <div className="flex items-center gap-2 text-sm text-ink">
          <Icon name="images" size={14} className="text-muted" />
          <span className="min-w-0 flex-1 truncate">
            {shown ? `Logo added · ${shown.width} × ${shown.height} px` : "Logo added"}
          </span>
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            Remove logo
          </Button>
        </div>
      )}
      {mode === "tauri" ? (
        <Button size="sm" icon="import" loading={busy} onClick={() => void pick()} className="self-start">
          {assetId ? "Replace logo" : "Choose logo"}
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            aria-label="Logo file path"
            dense
            value={path}
            placeholder={"C:\\logos\\client.png"}
            onChange={(e) => setPath(e.target.value)}
          />
          <Button size="sm" loading={busy} disabled={!path.trim()} onClick={() => void add(path.trim())}>
            Add logo
          </Button>
        </div>
      )}
      <p className="text-2xs text-muted">PNG, JPEG or WebP up to 20 MB; a copy is kept in the project.</p>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
