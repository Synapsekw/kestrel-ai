import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { Box, LibraryModel } from "@contract/client";
import { useApi } from "@/api/client";
import { codeOf, messageOf } from "@/api/errors";
import { fetchProject } from "@/api/project";
import { useProjectTypes } from "@/findings/useProjectTypes";
import { toast } from "@/ui";
import { useAiStore } from "./aiStore";
import { detectImage, type DetectResult } from "./api";
import { wsGet } from "./bridge";
import { writeConf, writeLastModel } from "./models";

export function detectToastText(
  name: string,
  r: Pick<DetectResult, "new" | "already_covered" | "device">,
): string {
  return `${name}: ${r.new} new, ${r.already_covered} already covered${r.device === "cpu" ? " · ran on CPU" : ""}`;
}

/** The server replaced this model's earlier unreviewed suggestions (§11.2 step 5); mirror that. */
function applyResult(imageId: string, r: DetectResult): void {
  const s = wsGet();
  if (s.imageId !== imageId) return; // Review Focus 3
  const keep: Box[] = s.order
    .map((id) => s.boxes[id])
    .filter((b) => b && !(b.review_state === "unreviewed" && b.provenance.model_id === r.model_id));
  s.setBoxes([...keep, ...r.suggestions]);
}

export function useDetect(projectId: string) {
  const api = useApi();
  const navigate = useNavigate();
  const { types } = useProjectTypes(projectId);
  return useCallback(
    async (imageId: string, model: LibraryModel, conf: number) => {
      const ai = useAiStore.getState();
      // One detection at a time (M6): a second run would supersede the first and drop its result.
      if (ai.detect) return;
      writeLastModel(projectId, model.id);
      writeConf(model.id, conf);
      ai.closeMenu();
      const token = ai.startDetect(imageId, model.name);
      try {
        const r = await detectImage(api, projectId, imageId, { model_id: model.id, conf });
        if (!useAiStore.getState().endDetect(token)) return; // R-FA5
        applyResult(imageId, r);
        // I-BP R-BP1: a detect may add resolved catalogue types to the project; re-read it and push
        // the classes straight into FC's store, which is what the chip and the inspector read
        // (drift.md Task 8: a bare `useProject(...).reload()` re-fetches an object nothing reads).
        if (r.suggestions.some((b) => !types.has(b.class_id))) {
          fetchProject(api, projectId)
            .then((p) => wsGet().setTypes(p.classes))
            .catch(() => {
              /* the chip/inspector simply keep the id unresolved */
            });
        }
        toast("ok", detectToastText(model.name, r));
      } catch (e) {
        if (!useAiStore.getState().endDetect(token)) return;
        switch (codeOf(e)) {
          case "unmapped_classes":
            toast("danger", "None of this model's classes map to this project's types.", {
              label: "Open class map",
              onClick: () => void navigate(`/models/library?model=${model.id}`),
            });
            break;
          case "model_unavailable":
            toast("danger", "This model's weights are missing from the library. Re-import it in Models.");
            break;
          default:
            toast("danger", `Detection failed: ${messageOf(e, "unknown error")}`);
        }
      }
    },
    [api, projectId, navigate, types],
  );
}
