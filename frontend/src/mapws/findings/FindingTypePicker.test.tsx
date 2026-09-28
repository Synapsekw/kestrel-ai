import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { baseRoutes, projectTypes, typedProject, TYPE_CRACK } from "@/test/findingFixtures";
import { renderWithProviders } from "@/test/render";
import { FindingTypePicker } from "./FindingTypePicker";

describe("FindingTypePicker", () => {
  it("offers the project's defect types only", async () => {
    const onPick = vi.fn();
    const { api } = fakeClient(baseRoutes());
    renderWithProviders(<FindingTypePicker projectId={PROJECT_ID} onPick={onPick} />, { api });
    const crack = await screen.findByRole("option", { name: /Crack/ });
    expect(screen.getByRole("option", { name: /Spalling/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /excavator/i })).toBeNull();
    fireEvent.click(crack);
    expect(onPick).toHaveBeenCalledWith(TYPE_CRACK);
  });

  it("type hotkeys are live inside the picker", async () => {
    const onPick = vi.fn();
    const withKey = {
      ...typedProject,
      classes: projectTypes.map((t) => (t.id === TYPE_CRACK ? { ...t, hotkey: "2" } : t)),
    };
    const { api } = fakeClient(baseRoutes([{ method: "GET", path: /\/projects\/[^/]+$/, body: withKey }]));
    renderWithProviders(<FindingTypePicker projectId={PROJECT_ID} onPick={onPick} />, { api });
    fireEvent.keyDown(await screen.findByRole("combobox", { name: "Finding type" }), { key: "2" });
    expect(onPick).toHaveBeenCalledWith(TYPE_CRACK);
  });

  it("explains an empty catalogue", async () => {
    const none = {
      ...typedProject,
      classes: projectTypes.filter((t) => t.kind === "object"),
    };
    const { api } = fakeClient(baseRoutes([{ method: "GET", path: /\/projects\/[^/]+$/, body: none }]));
    renderWithProviders(<FindingTypePicker projectId={PROJECT_ID} onPick={vi.fn()} />, { api });
    expect(await screen.findByText(/no defect types yet/)).toBeInTheDocument();
  });
});
