import { nextStep, type NextStep, type ProjectProgress } from "./nextStep";
import type { ProjectKind } from "./useProjectKind";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A detection project: sources first, then a library model, a run, the review and the export. */
function detectNextStep(projectId: string, p: ProjectProgress): NextStep {
  const at = (screen: string) => `/p/${projectId}/${screen}`;
  if (p.pendingReview > 0)
    return {
      text: `Review ${plural(p.pendingReview, "suggestion", "suggestions")}`,
      detail: "Suggested boxes from detection runs wait until you accept or reject them.",
      to: at("review"),
    };
  if (p.images === 0 && p.maps === 0)
    return {
      text: "Add images or a map",
      detail:
        "Import a folder of drone images, or a GeoTIFF map of the site. The originals are never modified.",
      to: at("data"),
    };
  if (p.models === 0)
    return {
      text: "Add a model to the library",
      detail: "A detection runs a model from your library. Import a model file or add a starter model.",
      to: "/library",
    };
  if (p.queryRuns === 0 && p.images > 0)
    return {
      text: "Run a detection",
      detail: "Pick a model from your library and run it over the images; it suggests boxes to review.",
      to: at("query"),
    };
  if (p.queryRuns === 0 && p.maps > 0 && p.images === 0)
    return {
      text: "Run a detection on your map",
      detail: "Open the map and start a run with a model from your library.",
      to: at("maps"),
    };
  return {
    text: "Export the results",
    detail: "Take the counts and the reviewed boxes out of the app as tables or a report.",
    to: at("export"),
  };
}

/**
 * The one thing worth doing next in a project of `kind`. A training project follows `nextStep`,
 * except that it no longer runs detections: once a model is trained, more labels come next.
 */
export function projectNextStep(projectId: string, kind: ProjectKind, p: ProjectProgress): NextStep | null {
  if (kind === "detect") return detectNextStep(projectId, p);
  const step = nextStep(projectId, p);
  if (step && step.to === `/p/${projectId}/query`) {
    const unlabeled = p.images - p.labeled;
    return {
      text: `Label ${plural(unlabeled, "more image", "more images")}`,
      detail:
        "More labeled images make the next training better. Pick your model for pre-annotation in Project settings to get suggestions while you label.",
      to: `/p/${projectId}/label`,
    };
  }
  return step;
}
