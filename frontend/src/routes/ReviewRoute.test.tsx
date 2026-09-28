import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { exampleSource, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { LocationProbe, TestApiProvider } from "@/test/render";
import { ReviewRoute } from "./ReviewRoute";

function mount(url: string) {
  const { api } = fakeClient([
    { method: "GET", path: /\/sources$/, body: { items: [exampleSource], next_cursor: null } },
  ]);
  render(
    <TestApiProvider api={api}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/p/:projectId/review" element={<ReviewRoute />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </TestApiProvider>,
  );
}

describe("ReviewRoute", () => {
  it.each([
    [`/p/${PROJECT_ID}/review`, `/p/${PROJECT_ID}/images?filter=suggestions`],
    [`/p/${PROJECT_ID}/review?ids=a,b`, `/p/${PROJECT_ID}/images?ids=a%2Cb&filter=suggestions`],
    [`/p/${PROJECT_ID}/review?view=suggestions`, `/p/${PROJECT_ID}/images?filter=suggestions`],
  ])("%s lands on %s", async (from, to) => {
    mount(from);
    expect((await screen.findByTestId("location")).textContent).toBe(to);
  });

  it("keeps the runs picker at ?view=runs", async () => {
    mount(`/p/${PROJECT_ID}/review?view=runs`);
    expect(await screen.findByRole("heading", { name: "Review" })).toBeInTheDocument();
    expect(screen.queryByTestId("location")).toBeNull();
  });
});
