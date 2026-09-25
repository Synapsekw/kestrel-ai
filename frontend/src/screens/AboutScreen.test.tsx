import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeClient } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { AboutScreen } from "./AboutScreen";

describe("About screen", () => {
  it("shows every component and opens a licence text", async () => {
    renderWithProviders(<AboutScreen />, { api: fakeClient([]).api });
    const table = screen.getByRole("table", { name: "Open-source components" });
    expect(within(table).getAllByRole("row")).toHaveLength(1 + 9);
    expect(screen.getByRole("heading", { name: "About Kestrel AI" })).toBeInTheDocument();
    expect(screen.getByText(/^Version /)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Licence text: laspy" }));
    expect(screen.getByText(/Redistribution and use in source and binary forms/)).toBeInTheDocument();
  });
});
