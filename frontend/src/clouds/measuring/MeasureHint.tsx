import { Segmented, Slider } from "@/ui";
import { THICKNESS_STOPS, isRings, ringCounts, type CloudTool } from "../useCloudTool";
import { RING_STEPS, SECTION_NOTE, headline, paramsOf, type Live } from "./measureView";
import { FULL_TEXT } from "./useCloudMeasurements";

/** A measure tool's part of W1's hint bar (spec §6): options, progress, the live result, refusals.
 * W1's bar adds the tool's name, hint, key and Save / Cancel around it. */
export function MeasureHint({
  tool,
  live,
  full,
  onThickness,
}: {
  tool: CloudTool;
  live: Live;
  full: boolean;
  onThickness: (m: number) => void;
}) {
  const { state: s, dispatch } = tool;
  if (!s.kind) return null;
  const h = live.results ? headline(s.kind, paramsOf(s), live.results, s.picks) : null;
  const [lower, upper] = ringCounts(s.picks);
  const n = s.picks.length;
  const progress =
    s.kind === "area"
      ? `${n} ${n === 1 ? "vertex" : "vertices"}${s.closed ? " · closed" : ""}`
      : isRings(s)
        ? `lower ${lower} · upper ${upper} · ${RING_STEPS[s.ring]}`
        : s.kind === "profile"
          ? SECTION_NOTE
          : null;
  return (
    <span data-testid="measure-hint" className="flex min-w-0 items-center gap-2">
      {s.kind === "area" && (
        <Segmented
          size="sm"
          label="Area"
          value={s.mode}
          onChange={(mode) => dispatch({ type: "mode", mode })}
          options={[
            { value: "surface", label: "Surface" },
            { value: "plan", label: "Plan" },
          ]}
        />
      )}
      {s.kind === "vertical" && (
        <Segmented
          size="sm"
          label="Lean method"
          value={s.method}
          onChange={(method) => dispatch({ type: "method", method })}
          options={[
            { value: "points", label: "Points" },
            { value: "rings", label: "Rings" },
          ]}
        />
      )}
      {s.kind === "profile" && (
        <Slider
          label="Slab thickness"
          min={THICKNESS_STOPS[0]}
          max={THICKNESS_STOPS[THICKNESS_STOPS.length - 1]}
          stops={THICKNESS_STOPS}
          value={s.thicknessM}
          format={(v) => `${v.toFixed(2)} m`}
          onChange={onThickness}
          className="w-40"
        />
      )}
      {progress && <span className="font-mono text-xs tabular-nums text-muted">{progress}</span>}
      {h && (
        <span data-testid="measure-live" className="font-mono text-sm tabular-nums text-ink">
          <b className="font-semibold text-ok">{h.primary}</b>
          {h.secondary ? ` · ${h.secondary}` : ""}
        </span>
      )}
      {live.refusal && <span className="truncate text-warn">{live.refusal}</span>}
      {live.warning && <span className="truncate text-warn">{live.warning}</span>}
      {full && <span className="truncate text-warn">{FULL_TEXT}</span>}
    </span>
  );
}
