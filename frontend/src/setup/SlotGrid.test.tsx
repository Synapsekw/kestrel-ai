import { beforeEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { fakeClient } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { THERMAL, VERTICAL, VISUAL, draftBucket } from "@/test/setupFixtures";
import { useSetupDraft } from "./draftStore";
import { remap } from "./remap";
import { SlotGrid } from "./SlotGrid";

const WHOLE = "The whole folder 100MEDIA will be imported";

describe("SlotGrid whole-folder note", () => {
  beforeEach(() => useSetupDraft.getState().discard());

  it("says the whole folder is imported for a photo bucket that came from a picked file", () => {
    const { chooseTemplate, setBuckets } = useSetupDraft.getState();
    chooseTemplate(VERTICAL, "replace");
    setBuckets(
      remap([draftBucket(VISUAL, { wholeFolder: true }), draftBucket(THERMAL)], VERTICAL.config.slots),
    );
    renderWithProviders(<SlotGrid />, { api: fakeClient([]).api });
    expect(
      within(screen.getByRole("region", { name: "Visual photos" })).getByText(WHOLE),
    ).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Thermal photos" })).queryByText(WHOLE)).toBeNull();
  });

  it("says nothing for a skipped bucket", () => {
    const { chooseTemplate, setBuckets } = useSetupDraft.getState();
    chooseTemplate(VERTICAL, "replace");
    setBuckets(remap([draftBucket(VISUAL, { wholeFolder: true, skipped: true })], VERTICAL.config.slots));
    renderWithProviders(<SlotGrid />, { api: fakeClient([]).api });
    expect(screen.queryByText(WHOLE)).toBeNull();
  });
});
