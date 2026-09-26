import { useState } from "react";
import type { DesignCandidate, DesignInspection } from "@/api/designSurfaces";
import { Checkbox, Field, Pill, Select, cx } from "@/ui";
import { blockedNote } from "./designImport";

const KIND_LABEL: Record<string, string> = {
  "3dface": "3D faces",
  mesh: "meshes",
  polyface: "polyface meshes",
  polymesh: "polygon meshes",
  polyline_3d: "3D polylines",
  polyline_2d: "2D polylines",
  lwpolyline: "polylines",
  line: "lines",
  point: "points",
  unsupported: "other objects",
  invisible_faces: "hidden faces",
};

function Thumb({ src }: { src: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="h-12 w-12 shrink-0 overflow-hidden rounded bg-surface-2">
      {!broken && (
        <img src={src} alt="" className="h-full w-full object-contain" onError={() => setBroken(true)} />
      )}
    </span>
  );
}

function CandidateRow({
  c,
  thumb,
  control,
}: {
  c: DesignCandidate;
  thumb: string;
  control?: React.ReactNode;
}) {
  const counts = Object.entries(c.entity_counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n.toLocaleString()} ${KIND_LABEL[k] ?? k}`);
  const block = blockedNote(c);
  return (
    <div className={cx("flex gap-3 rounded-md p-2", block ? "opacity-60" : "")}>
      <Thumb src={thumb} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {control ?? <span className="text-sm font-medium text-ink">{c.name}</span>}
        <span className="text-xs text-muted tabular-nums">
          {c.point_count.toLocaleString()} points · {c.face_count.toLocaleString()} triangles
          {counts.length ? ` · ${counts.join(", ")}` : ""}
          {c.z_min !== null && c.z_max !== null ? ` · z ${c.z_min.toFixed(1)} … ${c.z_max.toFixed(1)}` : ""}
        </span>
        {c.notes.map((n) => (
          <span key={n.code} className="flex items-center gap-2 text-xs text-muted">
            <Pill size="sm" tone={n.level === "block" ? "danger" : n.level === "warn" ? "warn" : "neutral"}>
              {n.level === "block" ? "Can't use" : n.level === "warn" ? "Check" : "Note"}
            </Pill>
            {n.message}
          </span>
        ))}
      </div>
    </div>
  );
}

export function DesignContents({
  inspection,
  selected,
  onChange,
  thumbUrl,
}: {
  inspection: DesignInspection;
  selected: string[];
  onChange: (ids: string[]) => void;
  thumbUrl: (candidateId: string) => string;
}) {
  const cands = inspection.candidates;
  if (inspection.format === "landxml") {
    const current = cands.find((c) => c.id === selected[0]);
    return (
      <div className="flex flex-col gap-2">
        <Field
          label="Surface"
          htmlFor="design-surface"
          hint="A LandXML file can hold several surfaces; import one at a time."
        >
          <Select id="design-surface" value={selected[0] ?? ""} onChange={(e) => onChange([e.target.value])}>
            {cands.map((c) => {
              const block = blockedNote(c);
              return (
                <option key={c.id} value={c.id} disabled={Boolean(block)}>
                  {c.name}
                  {block ? ` — ${block.message}` : ""}
                </option>
              );
            })}
          </Select>
        </Field>
        {current && <CandidateRow c={current} thumb={thumbUrl(current.id)} />}
      </div>
    );
  }
  if (inspection.format === "geotiff") {
    return <CandidateRow c={cands[0]} thumb={thumbUrl(cands[0].id)} />;
  }
  return (
    <ul className="flex flex-col gap-1" aria-label="Layers">
      {cands.map((c) => {
        const block = blockedNote(c);
        const checked = selected.includes(c.id);
        return (
          <li key={c.id}>
            <CandidateRow
              c={c}
              thumb={thumbUrl(c.id)}
              control={
                <Checkbox
                  label={c.name}
                  checked={checked}
                  disabled={Boolean(block)}
                  onChange={() =>
                    onChange(checked ? selected.filter((id) => id !== c.id) : [...selected, c.id])
                  }
                />
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
