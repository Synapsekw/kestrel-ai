import { codeOf, messageOf } from "@/api/errors";
import { TOO_MANY_PAIRS } from "./alignModel";
import { MIN_PAIRS, type FitRefusal, type FitResult, type FitWarning, type GeorefModelName } from "./fit";

export const REFUSAL_TEXT: Record<FitRefusal, string> = {
  too_few_points: "Add more control points.",
  too_many_points: TOO_MANY_PAIRS,
  collinear: "These points lie on one line. Add a point away from that line.",
  reflection:
    "These points are picked in mirrored order: pick each pair on the drawing and on the map in the same order.",
  degenerate: "Two points are on top of each other. Pick points further apart.",
};

export const WARNING_TEXT: Record<FitWarning, string> = {
  rmse_high: "The fit is loose (RMSE over 25 cm). Check the points with the largest residuals.",
  scale_mismatch:
    "The fitted scale is more than 2% off the drawing's units: wrong units, or the wrong point?",
  shear: "This fit skews the drawing. Use Similarity unless the scan itself is skewed.",
};

export function formatMetres(m: number): string {
  return m < 1 ? `${(m * 100).toFixed(1)} cm` : `${m.toFixed(2)} m`;
}

export function fitSummary(
  model: GeorefModelName,
  pairs: number,
  fit: FitResult | null,
): { tone: "info" | "ok" | "warn" | "danger"; text: string } {
  const min = MIN_PAIRS[model];
  if (pairs < min) {
    const more = min - pairs;
    return {
      tone: "info",
      text: `Add ${more} more pair${more === 1 ? "" : "s"} for ${model === "affine" ? "an affine" : "a similarity"} fit.`,
    };
  }
  if (!fit) return { tone: "info", text: "Add a point to check the fit." };
  if (!fit.ok) return { tone: "danger", text: REFUSAL_TEXT[fit.error] };
  if (pairs === min) return { tone: "info", text: "Add a point to check the fit." };
  return {
    tone: fit.warnings.length ? "warn" : "ok",
    text: `RMSE ${formatMetres(fit.rmse_m)}`,
  };
}

/** The fit line of a saved control-point placement (preflight #5): the server's RMSE, no refit. */
export function savedFitSummary(
  model: GeorefModelName,
  pairs: number,
  rmse_m: number,
): { tone: "info" | "ok"; text: string } {
  if (pairs <= MIN_PAIRS[model]) return { tone: "info", text: "Add a point to check the fit." };
  return { tone: "ok", text: `RMSE ${formatMetres(rmse_m)}` };
}

/**
 * A residual cell: none at (or under) the model's minimum pair count, where the fit is exact by
 * construction and a "0.0 cm" would read as a perfect placement.
 */
export function residualText(model: GeorefModelName, pairs: number, residual: number | null): string {
  return residual === null || pairs <= MIN_PAIRS[model] ? "–" : formatMetres(residual);
}

/** The "Save placement" toast; the RMSE only above the minimum pair count (see `residualText`). */
export function placementSavedText(model: GeorefModelName, pairs: number, rmse_m: number | null): string {
  return rmse_m === null || pairs <= MIN_PAIRS[model]
    ? "Placement saved"
    : `Placement saved · RMSE ${formatMetres(rmse_m)}`;
}

/** A failed `PUT …/georef` (B3: 422 `too_few_points` | `too_many_points` | `degenerate` | `collinear` | `reflection`) in words. */
export function georefErrorText(err: unknown): string {
  const code = codeOf(err);
  return code && code in REFUSAL_TEXT
    ? REFUSAL_TEXT[code as FitRefusal]
    : messageOf(err, "could not save the placement");
}
