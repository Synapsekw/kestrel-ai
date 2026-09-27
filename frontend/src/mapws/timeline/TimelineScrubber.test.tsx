import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PROJECT_ID, fakeClient } from "@/test/fixtures";
import { useChangesStore } from "@/store/changes";
import { makeStores, renderInWorkspace } from "../test/harness";
import { UTM33, survey } from "../test/fixtures";
import { AUG, JUL, OCT, SEP, surveyMap } from "../test/rasterFixtures";
import { TimelineScrubber } from "./TimelineScrubber";

const THREE = [survey(JUL), survey(AUG), survey(SEP), survey(OCT, { planned: true })];

function setup(surveys = THREE) {
  const { api, requests } = fakeClient([{ method: "PATCH", path: /\/maps\/m-imp$/, body: {} }]);
  const stores = makeStores({ surveys });
  renderInWorkspace(<TimelineScrubber projectId={PROJECT_ID} frame={UTM33} />, {
    stores,
    api,
  });
  return { ws: stores.workspace, requests };
}

describe("TimelineScrubber (M §5 Timeline, §14 dates)", () => {
  it("shows the summary, the range and one tick per flown date; planned ticks are not buttons", () => {
    setup();
    expect(screen.getByText("Survey timeline · 3 flights, 1 planned")).toBeInTheDocument();
    expect(screen.getByText("14 Sep 2026")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Survey / })).toHaveLength(3);
    expect(screen.getByTestId("timeline-track").querySelectorAll("[data-planned]")).toHaveLength(1);
  });

  it("a tick click sets R in Single", async () => {
    const { ws } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Survey 14 Aug 2026" }));
    expect(ws.getState().r).toBe(AUG);
  });

  it("in a compare mode shows the range and markers; a click moves the nearer marker (W2-3)", async () => {
    const { ws } = setup();
    act(() => ws.getState().setMode("swipe")); // l AUG, r SEP
    expect(screen.getByText("14 Aug → 14 Sep · 31 days")).toBeInTheDocument();
    expect(within(screen.getByTestId("timeline-track")).getByText("L")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Survey 15 Jul 2026" }));
    expect(ws.getState()).toMatchObject({ l: JUL, r: SEP });
  });

  it("the play button toggles W1's play state", async () => {
    const { ws } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Play the timeline" }));
    expect(ws.getState().playing).toBe(true);
    expect(screen.getByRole("button", { name: "Pause the timeline" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("Play is disabled with one survey", () => {
    setup([survey(AUG)]);
    expect(screen.getByRole("button", { name: "Play the timeline" })).toBeDisabled();
  });

  it("an import-date survey offers the inline date edit and saves it", async () => {
    const { requests } = setup([
      survey(AUG),
      survey(SEP, { date_is_import_date: true, maps: [surveyMap("m-imp")] }),
    ]);
    const rev = useChangesStore.getState().mapWorkspaceRevision;
    await userEvent.click(screen.getByRole("button", { name: /Set the survey date of/ }));
    await userEvent.type(screen.getByLabelText(/Survey date of/), "2026-09-12");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(useChangesStore.getState().mapWorkspaceRevision).toBe(rev + 1));
    expect(requests[0].body).toEqual({ captured_on: "2026-09-12" });
  });

  it("says so when there are no surveys", () => {
    setup([]);
    expect(screen.getByText("No surveys yet")).toBeInTheDocument();
  });
});
