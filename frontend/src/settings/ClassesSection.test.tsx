import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { exampleProject, fakeClient, PROJECT_ID, CLASS_ID, errorBody } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ClassesSection } from "./ClassesSection";

describe("ClassesSection", () => {
  it("renames, adds and saves with PUT keeping ids", async () => {
    const { api, requests } = fakeClient([{ method: "PUT", path: /\/classes$/, body: exampleProject }]);
    const onSaved = vi.fn();
    renderWithProviders(<ClassesSection project={exampleProject} onSaved={onSaved} />, { api });
    fireEvent.change(screen.getByLabelText("Name of class 1"), { target: { value: "digger" } });
    fireEvent.change(screen.getByLabelText("Hotkey of class 1"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Add class" }));
    fireEvent.change(screen.getByLabelText("Name of class 9"), { target: { value: "grader" } });
    fireEvent.click(screen.getByRole("button", { name: "Save classes" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(exampleProject));
    const body = requests[0].body as Array<Record<string, unknown>>;
    expect(requests[0]).toMatchObject({ method: "PUT", url: `/api/v1/projects/${PROJECT_ID}/classes` });
    expect(body[0]).toEqual({ id: CLASS_ID(1), name: "digger", colour: "#f97316", hotkey: "9" });
    expect(body[8]).toEqual({ name: "grader", colour: expect.stringMatching(/^#/), hotkey: null });
    expect(screen.getByRole("status")).toHaveTextContent("Classes saved");
  });

  it("explains a 409 class_in_use when removing a class that still has boxes", async () => {
    const { api } = fakeClient([
      {
        method: "PUT",
        path: /\/classes$/,
        status: 409,
        body: errorBody("class_in_use", "class still has boxes", { class_id: CLASS_ID(4), box_count: 40 }),
      },
    ]);
    renderWithProviders(<ClassesSection project={exampleProject} onSaved={() => {}} />, { api });
    fireEvent.click(screen.getByRole("button", { name: "Remove class 4" }));
    expect(screen.queryByLabelText("Name of class 8")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save classes" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        'Class "dump_truck" still has 40 boxes. Reassign or delete those boxes in the editor before removing it.',
      ),
    );
    expect(screen.getByLabelText("Name of class 4")).toHaveValue("dump_truck");
  });

  it("blocks duplicate hotkeys before calling the API", () => {
    const { api, requests } = fakeClient([]);
    renderWithProviders(<ClassesSection project={exampleProject} onSaved={() => {}} />, { api });
    fireEvent.change(screen.getByLabelText("Hotkey of class 2"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save classes" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Hotkey 1 is used twice.");
    expect(requests).toHaveLength(0);
  });
});
