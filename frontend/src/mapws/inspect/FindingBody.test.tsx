import { act, fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { MAP_ID, exampleGeoMap, fakeClient } from "@/test/fixtures";
import { FINDING_ID_2, exampleFinding2 } from "@/test/findingFixtures";
import { makeStores, renderInWorkspace } from "../test/harness";
import { survey } from "../test/fixtures";
import { FindingBody } from "./FindingBody";
import { otherSurvey } from "./otherSurvey";

vi.mock("@/findings/FindingInspector", () => ({
  FindingInspector: (p: { findingId: string; anchorSlot?: ReactNode }) => (
    <aside aria-label="Finding">
      finding {p.findingId}
      {p.anchorSlot}
    </aside>
  ),
}));

describe("the finding inspector in the map (spec §5.3 Finding)", () => {
  it("picks the other survey: the one before, else the next", () => {
    expect(otherSurvey(["a", "b", "c"], "b")).toBe("a");
    expect(otherSurvey(["a", "b", "c"], "a")).toBe("b");
    expect(otherSurvey(["a"], "a")).toBeNull();
  });

  it("shows the anchor map's date and switches r to the other survey", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/findings\/[^/]+$/,
        body: { ...exampleFinding2, attachment_count: 0, comment_count: 0 },
      },
      {
        method: "GET",
        path: new RegExp(`/maps/${MAP_ID}$`),
        body: exampleGeoMap,
      },
    ]);
    const stores = makeStores({
      surveys: [survey("2026-03-01"), survey("2026-04-15")],
    });
    act(() => stores.workspace.getState().setDates("2026-03-01", "2026-04-15"));
    renderInWorkspace(
      <FindingBody
        selection={{ kind: "finding", id: FINDING_ID_2 }}
        projectId="p1"
        frame={stores.frame}
        onClose={() => {}}
      />,
      { stores, api },
    );
    expect(await screen.findByText("2026-04-15")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show on other survey" }));
    expect(stores.workspace.getState().r).toBe("2026-03-01");
  });
});
