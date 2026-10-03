import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import { SurveyDateDialog } from "./SurveyDateDialog";

// A rejection that carries no message of its own shows the dialog's fallback, in sentence case.
const fail = () => Promise.reject(new Error(""));

describe("raster dialog fallbacks", () => {
  it("delete says it could not delete, in sentence case", async () => {
    render(<ConfirmDeleteDialog title="Delete it?" body="Gone." onConfirm={fail} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(await screen.findByText("Could not delete it.")).toBeInTheDocument();
  });

  it("survey date says it could not save, in sentence case", async () => {
    render(<SurveyDateDialog title="Survey date" initial={null} onSave={fail} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Save date" }));
    expect(await screen.findByText("Could not save the date.")).toBeInTheDocument();
  });
});
