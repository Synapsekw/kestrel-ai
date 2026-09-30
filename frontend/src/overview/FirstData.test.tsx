import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { FirstData } from "./FirstData";

describe("FirstData", () => {
  it("asks for the first survey and says what each kind of data unlocks", () => {
    renderWithProviders(<FirstData projectId={PROJECT_ID} />, { api: fakeClient([]).api });
    expect(screen.getByRole("heading", { name: "Add the first survey" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add data/i })).toBeInTheDocument();
    for (const line of [/Photos/, /Orthomosaic/, /Point cloud/, /Findings/])
      expect(screen.getByText(line)).toBeInTheDocument();
  });
});
