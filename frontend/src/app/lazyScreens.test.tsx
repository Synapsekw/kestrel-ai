import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fakeClient } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { EMPTY_SCENE } from "@/test/siteSceneFixtures";
import { AboutScreen, CloudsScreen, Later, SiteScreen } from "./lazyScreens";

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
    [
      "Site 3D",
      <TestApiProvider
        key="s"
        api={fakeClient([{ method: "GET", path: /\/site-scene/, body: EMPTY_SCENE }]).api}
      >
        <MemoryRouter initialEntries={["/p/p1/site"]}>
          <Routes>
            <Route path="/p/:projectId/site" element={<SiteScreen />} />
          </Routes>
        </MemoryRouter>
      </TestApiProvider>,
    ],
    ["About Kestrel AI", <AboutScreen key="a" />],
  ])(
    "loads %s behind a placeholder",
    async (heading, element) => {
      render(<Later>{element}</Later>);
      // The first import of a lazy chunk (Clouds pulls in the viewer) can be slow under a loaded runner.
      expect(await screen.findByRole("heading", { name: heading }, { timeout: 5000 })).toBeInTheDocument();
      expect(screen.queryByRole("status", { name: "Loading" })).toBeNull();
    },
    10_000,
  );
});
