import { beforeEach, describe, expect, it } from "vitest";
import { errorBody, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { FINDING_ID } from "@/test/findingFixtures";
import { useChangesStore } from "@/store/changes";
import { EMPTY_LEDGER } from "@/store/changesEcho";
import finding from "./finding.inspector";

const sel = { kind: "finding" as const, id: FINDING_ID };

describe("the finding inspector's Del (M-W3 P9/P10)", () => {
  beforeEach(() => useChangesStore.setState({ findingsRevision: 0, findingEchoes: EMPTY_LEDGER }));

  it("confirms without repeating the dialog title", () => {
    expect(finding.remove!.confirm(sel)).toBe("This cannot be undone.");
  });

  it("deletes as an own finding write: one bump, its echo expected", async () => {
    const { api, requests } = fakeClient([
      { method: "DELETE", path: new RegExp(`/findings/${FINDING_ID}$`), status: 204, body: null },
    ]);
    await finding.remove!.run(sel, { api, projectId: PROJECT_ID });
    expect(requests.map((r) => r.method)).toEqual(["DELETE"]);
    const s = useChangesStore.getState();
    expect(s.findingsRevision).toBe(1);
    expect(Object.keys(s.findingEchoes)).toContain(FINDING_ID);
  });

  it("a failed delete neither bumps nor keeps an expected echo", async () => {
    const { api } = fakeClient([
      {
        method: "DELETE",
        path: new RegExp(`/findings/${FINDING_ID}$`),
        status: 404,
        body: errorBody("not_found", "gone"),
      },
    ]);
    await expect(finding.remove!.run(sel, { api, projectId: PROJECT_ID })).rejects.toBeTruthy();
    const s = useChangesStore.getState();
    expect(s.findingsRevision).toBe(0);
    expect(Object.keys(s.findingEchoes)).not.toContain(FINDING_ID);
  });
});
