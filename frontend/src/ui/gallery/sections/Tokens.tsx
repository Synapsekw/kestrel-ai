export const title = "Tokens";
export const order = 0;

const OPAQUE = ["bg", "ink", "muted", "dim", "accent", "accent-ink", "ok", "danger", "warn", "info", "tip"];
const TRANSLUCENT = ["surface", "surface-2", "field", "hover", "rail", "glass", "line", "line-strong"];
const TINTS = ["card-line", "accent-soft", "ok-soft", "danger-soft", "warn-soft", "control-line"];
const GRADIENTS = ["grad-primary", "grad-brand", "grad-ink", "grad-ai"];
const RADII: Array<[string, string]> = [
  ["panel 16", "rounded-panel"],
  ["control 10", "rounded-control"],
  ["chip", "rounded-chip"],
  ["sm 6", "rounded-sm"],
];

function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-10 w-16 shrink-0 rounded-sm border border-line" style={{ background: value }} />
      <code className="text-2xs text-muted">--{name}</code>
    </div>
  );
}

/** `--control-line` is a triplet; every other name in TRANSLUCENT and TINTS is a complete rgba(). */
const swatchValue = (n: string) => (n === "control-line" ? `rgb(var(--${n}))` : `var(--${n})`);

export default function TokensSection() {
  return (
    <div className="grid gap-8">
      <div className="grid grid-cols-4 gap-3">
        {OPAQUE.map((n) => (
          <Swatch key={n} name={n} value={`rgb(var(--${n}))`} />
        ))}
        {[...TRANSLUCENT, ...TINTS].map((n) => (
          <Swatch key={n} name={n} value={swatchValue(n)} />
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {GRADIENTS.map((n) => (
          <Swatch key={n} name={n} value={`var(--${n})`} />
        ))}
      </div>
      <div className="grid gap-2">
        <p className="text-kpi tabular-nums">1,284</p>
        <p className="text-xl">Page title · text-xl</p>
        <p className="text-lg">Card title · text-lg</p>
        <p className="text-base">Form text · text-base</p>
        <p className="text-sm">Body and table rows · text-sm</p>
        <p className="text-xs text-muted">Label · text-xs</p>
        <p className="text-2xs text-muted">Meta · text-2xs</p>
        <p className="font-mono text-sm tabular-nums">F-0217 · 51.49780, -0.13570 · DJI_0412.JPG</p>
      </div>
      <div className="flex flex-wrap gap-4">
        {RADII.map(([name, cls]) => (
          <div
            key={name}
            className={`grid h-16 w-28 place-items-center border border-card-line bg-surface text-2xs text-muted ${cls}`}
          >
            {name}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-6">
        <div className="grid h-20 w-44 place-items-center rounded-panel bg-surface text-2xs shadow-elev-1">
          elev-1
        </div>
        <div className="grid h-20 w-44 place-items-center rounded-panel bg-surface text-2xs shadow-elev-2">
          elev-2
        </div>
        <div className="grid h-10 w-44 place-items-center rounded-control bg-grad-primary text-sm font-semibold shadow-glow">
          glow-primary
        </div>
      </div>
    </div>
  );
}
