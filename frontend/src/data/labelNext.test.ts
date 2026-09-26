import { beforeEach, describe, expect, it } from "vitest";
import { useNavigationStore } from "@/store/navigation";
import { exampleImagePage, fakeClient, IMAGE_ID, PROJECT_ID } from "@/test/fixtures";
import { labelNext } from "./labelNext";

const empty = { items: [], next_cursor: null, total: 0 };

describe("labelNext", () => {
  beforeEach(() => useNavigationStore.getState().setContext([], null));

  it("opens the first unlabeled image with the unlabeled ones as the editor's walk", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/images$/, body: exampleImagePage }]);
    expect(await labelNext(api, PROJECT_ID)).toEqual({ imageId: IMAGE_ID });
    expect(new URL(`http://x${requests[0].url}`).searchParams.get("labeled")).toBe("false");
    const nav = useNavigationStore.getState();
    expect(nav.ids[0]).toBe(IMAGE_ID);
    expect(nav.returnTo).toBe(`/p/${PROJECT_ID}/images`);
  });

  it("says all-labeled when images exist but none needs labels", async () => {
    let call = 0;
    const { api } = fakeClient([
      { method: "GET", path: /\/images$/, body: () => (call++ === 0 ? empty : exampleImagePage) },
    ]);
    expect(await labelNext(api, PROJECT_ID)).toBe("all-labeled");
  });

  it("says no-images for an empty project and on a failure", async () => {
    expect(
      await labelNext(fakeClient([{ method: "GET", path: /\/images$/, body: empty }]).api, PROJECT_ID),
    ).toBe("no-images");
    expect(await labelNext(fakeClient([]).api, PROJECT_ID)).toBe("no-images");
  });
});
