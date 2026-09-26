import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Gallery } from "./Gallery";

const sectionFiles = Object.keys(import.meta.glob("./sections/*.tsx"));

describe("primitive gallery", () => {
  it("renders every section file under its own heading", () => {
    render(
      <MemoryRouter>
        <Gallery />
      </MemoryRouter>,
    );
    expect(sectionFiles.length).toBeGreaterThan(0);
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(sectionFiles.length);
  });
});
