import { describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import type { Surface } from "@contract/client";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { demSurface } from "@/mapws/drawings/testFixtures";
import { DemImportStep } from "./DemImportStep";

let resolveList: (s: Surface[]) => void = () => {};
let rejectList: (e: unknown) => void = () => {};
vi.mock("@/api/surfaces", () => ({
  listSurfaces: () =>
    new Promise<Surface[]>((res, rej) => {
      resolveList = res;
      rejectList = rej;
    }),
}));

function show() {
  renderWithProviders(
    <DemImportStep projectId={PROJECT_ID} onBack={() => {}} onClose={() => {}} onStarted={() => {}} />,
    { api: fakeClient([]).api },
  );
  return screen.getByRole("button", { name: "Start import" });
}

describe("DemImportStep: Start waits for the align targets", () => {
  it("is disabled until listSurfaces resolves, so the default target is always sent", async () => {
    const start = show();
    expect(start).toBeDisabled();
    await act(async () => resolveList([demSurface as Surface]));
    expect(start).toBeEnabled();
  });

  it("is enabled once listSurfaces fails (the file's own grid)", async () => {
    const start = show();
    expect(start).toBeDisabled();
    await act(async () => rejectList(new Error("offline")));
    expect(start).toBeEnabled();
  });
});
