import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SurveysRedirect } from "./SurveysRedirect";

describe("SurveysRedirect", () => {
  it("sends the old Surveys screen to Analytics, which absorbed it", () => {
    render(
      <MemoryRouter initialEntries={["/p/p1/surveys"]}>
        <Routes>
          <Route path="/p/:projectId/surveys" element={<SurveysRedirect />} />
          <Route path="/p/:projectId/analytics" element={<p>analytics screen</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("analytics screen")).toBeInTheDocument();
  });
});
