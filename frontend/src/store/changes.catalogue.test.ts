import { describe, expect, it } from "vitest";
import type { AppEvent } from "@contract/client";
import { useChangesStore } from "./changes";

describe("catalogue.changed", () => {
  it("bumps catalogueRevision and leaves the image revision alone", () => {
    const before = useChangesStore.getState();
    useChangesStore.getState().applyEvent({ type: "catalogue.changed", payload: {} } as unknown as AppEvent);
    const after = useChangesStore.getState();
    expect(after.catalogueRevision).toBe(before.catalogueRevision + 1);
    expect(after.imagesRevision).toBe(before.imagesRevision);
  });
});
