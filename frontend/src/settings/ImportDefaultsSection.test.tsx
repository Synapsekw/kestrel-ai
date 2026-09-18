import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { exampleProject, fakeClient } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ImportDefaultsSection } from "./ImportDefaultsSection";

describe("ImportDefaultsSection", () => {
  it("patches import_defaults with every field", async () => {
    const { api, requests } = fakeClient([
      { method: "PATCH", path: /\/projects\/[^/]+$/, body: exampleProject },
    ]);
    const onSaved = vi.fn();
    renderWithProviders(<ImportDefaultsSection project={exampleProject} onSaved={onSaved} />, { api });
    expect(screen.getByLabelText("Max side")).toHaveValue(4000);
    fireEvent.change(screen.getByLabelText("Max side"), { target: { value: "3000" } });
    fireEvent.change(screen.getByLabelText("Duplicate threshold"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Save import defaults" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(exampleProject));
    expect(requests[0].body).toEqual({
      import_defaults: {
        max_side: 3000,
        quality: 95,
        dedupe_threshold: 6,
        group_regex: exampleProject.import_defaults.group_regex,
      },
    });
  });

  it("refuses to save an emptied number field", async () => {
    const { api, requests } = fakeClient([]);
    renderWithProviders(<ImportDefaultsSection project={exampleProject} onSaved={() => {}} />, { api });
    fireEvent.change(screen.getByLabelText("JPEG quality"), { target: { value: "" } });
    fireEvent.submit(screen.getByRole("button", { name: "Save import defaults" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Every import default needs a value."),
    );
    expect(requests).toHaveLength(0);
  });
});
