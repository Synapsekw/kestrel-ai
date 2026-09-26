import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fakeClient } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { AboutScreen, CloudsScreen, Later } from "./lazyScreens";

describe("lazy screens (foundation F0)", () => {
  it.each([
    [
      "Point clouds",
      <TestApiProvider
        key="c"
        api={fakeClient([{ method: "GET", path: /\/pointclouds$/, body: { items: [] } }]).api}
      >
        <MemoryRouter initialEntries={["/p/p1/clouds"]}>
          <Routes>
            <Route path="/p/:projectId/clouds" element={<CloudsScreen />} />
          </Routes>
        </MemoryRouter>
      </TestApiProvider>,
    ],
    ["About Kestrel AI", <AboutScreen key="a" />],
  ])("loads %s behind a placeholder", async (heading, element) => {
    render(<Later>{element}</Later>);
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading" })).toBeNull();
  });
});
