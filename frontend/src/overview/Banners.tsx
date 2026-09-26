import { Link } from "react-router-dom";
import type { ProjectOverview } from "@/api/overview";
import { Alert, buttonClass } from "@/ui";
import { AdoptionBanner } from "./AdoptionBanner";

type Banner = ProjectOverview["banners"][number];

const ACTION_LABEL: Record<string, string> = {
  types_to_classify: "Open Catalogue",
  model_adoption: "Open library",
};

/**
 * The payload's banners (migration warnings, "types to classify", …) rendered generically: `action`
 * is an in-app path the button opens. Model adoption is left to `AdoptionBanner`, which carries the
 * progress and Retry the payload lacks, so it never shows twice (F §9.1).
 */
export function Banners({ projectId, banners }: { projectId: string; banners: Banner[] }) {
  return (
    <div className="col-span-12 flex flex-col gap-2 empty:hidden">
      {banners
        .filter((b) => b.kind !== "model_adoption")
        .map((b, i) => (
          <Alert
            key={`${b.kind}-${i}`}
            tone={b.tone}
            actions={
              b.action ? (
                <Link to={b.action} className={buttonClass("secondary", "sm")}>
                  {ACTION_LABEL[b.kind] ?? "Open"}
                </Link>
              ) : undefined
            }
          >
            {b.message}
          </Alert>
        ))}
      <AdoptionBanner projectId={projectId} />
    </div>
  );
}
