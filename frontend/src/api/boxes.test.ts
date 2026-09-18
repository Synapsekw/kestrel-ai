import { describe, it, expect } from "vitest";
import { fakeClient, PROJECT_ID, IMAGE_ID, personBox, proposalBox, CLASS_ID } from "@/test/fixtures";
import { createBox, deleteBox, fetchBoxes, reviewBoxes, updateBox } from "./boxes";

describe("boxes api", () => {
  it("lists, creates, updates, deletes and reviews through the contract paths", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/boxes$/, body: { items: [personBox, proposalBox] } },
      { method: "POST", path: /\/images\/[^/]+\/boxes$/, status: 201, body: personBox },
      { method: "PATCH", path: /\/boxes\/[^/]+$/, body: { ...proposalBox, review_state: "edited" } },
      { method: "DELETE", path: /\/boxes\/[^/]+$/, status: 204 },
      { method: "POST", path: /\/boxes\/review$/, body: { updated: 2 } },
    ]);
    expect(await fetchBoxes(api, PROJECT_ID, IMAGE_ID)).toHaveLength(2);
    const created = await createBox(api, PROJECT_ID, IMAGE_ID, {
      class_id: CLASS_ID(1),
      x: 1,
      y: 2,
      w: 3,
      h: 4,
    });
    expect(created.id).toBe(personBox.id);
    const updated = await updateBox(api, PROJECT_ID, proposalBox.id, { x: 10, y: 20 });
    expect(updated.review_state).toBe("edited");
    await deleteBox(api, PROJECT_ID, personBox.id);
    expect(await reviewBoxes(api, PROJECT_ID, ["a", "b"], "accept")).toBe(2);

    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `GET /api/v1/projects/${PROJECT_ID}/images/${IMAGE_ID}/boxes`,
      `POST /api/v1/projects/${PROJECT_ID}/images/${IMAGE_ID}/boxes`,
      `PATCH /api/v1/projects/${PROJECT_ID}/boxes/${proposalBox.id}`,
      `DELETE /api/v1/projects/${PROJECT_ID}/boxes/${personBox.id}`,
      `POST /api/v1/projects/${PROJECT_ID}/boxes/review`,
    ]);
    expect(requests[1].body).toEqual({ class_id: CLASS_ID(1), x: 1, y: 2, w: 3, h: 4 });
    expect(requests[2].body).toEqual({ x: 10, y: 20 });
    expect(requests[4].body).toEqual({ box_ids: ["a", "b"], action: "accept" });
  });

  it("sends the unreview action for undo", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/boxes\/review$/, body: { updated: 1 } },
    ]);
    expect(await reviewBoxes(api, PROJECT_ID, [proposalBox.id], "unreview")).toBe(1);
    expect(requests[0].body).toEqual({ box_ids: [proposalBox.id], action: "unreview" });
  });
});
