import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AboutScreen } from "./AboutScreen";
import { CloudsScreen } from "./CloudsScreen";

describe("the empty screens foundation F0 lands", () => {
  it("Point clouds says what it is for and that import is not here yet", () => {
    render(<CloudsScreen />);
    expect(screen.getByRole("heading", { name: "Point clouds" })).toBeInTheDocument();
    expect(screen.getByText("Import a LAS or LAZ point cloud")).toBeInTheDocument();
    expect(screen.getByText(/not available in this build yet/)).toBeInTheDocument();
  });

  it("About names the app", () => {
    render(<AboutScreen />);
    expect(screen.getByRole("heading", { name: "About Kestrel AI" })).toBeInTheDocument();
  });
});
