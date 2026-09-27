import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Outlet, RouterProvider, createMemoryRouter } from "react-router-dom";
import { exampleLibraryStatus, exampleModel, fakeClient } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { appRoutes } from "@/routes/appRoutes";

// Same test-environment-only fix as routes/routes.test.tsx: React Router's data router builds a
// `Request` for every navigation (the `/models` index redirect included), and Node's `Request`
// rejects the `AbortSignal` jsdom's `AbortController` produces. No route here has a loader, so
// nothing ever reads the signal back off the request.
const NativeRequest = globalThis.Request;
class NavigationSafeRequest extends NativeRequest {
  constructor(input: RequestInfo | URL, init: RequestInit = {}) {
    const { signal, ...rest } = init;
    super(input, rest);
    if (signal) Object.defineProperty(this, "signal", { value: signal, configurable: true });
  }
}
globalThis.Request = NavigationSafeRequest as unknown as typeof Request;

function renderModels(path: string) {
  const { api } = fakeClient([
    { method: "GET", path: /\/library\/status$/, body: exampleLibraryStatus },
    { method: "GET", path: /\/library\/models$/, body: { items: [exampleModel], next_cursor: null } },
    { method: "GET", path: /\/library\/jobs$/, body: { items: [], next_cursor: null } },
  ]);
  const router = createMemoryRouter([{ path: "/", element: <Outlet />, children: appRoutes }], {
    initialEntries: [path],
  });
  render(
    <TestApiProvider api={api}>
      <RouterProvider router={router} />
    </TestApiProvider>,
  );
  return router;
}

describe("Models section (F §5.3, §12)", () => {
  it("/models lands on the Library and shows the three sub-tabs", async () => {
    const router = renderModels("/models");
    await waitFor(() => expect(router.state.location.pathname).toBe("/models/library"));
    expect(await screen.findByRole("heading", { name: "Models", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Library", { selector: "a, a *" }).closest("a")).toHaveAttribute(
      "href",
      "/models/library",
    );
    expect(screen.getByText("Datasets", { selector: "a, a *" }).closest("a")).toHaveAttribute(
      "href",
      "/models/datasets",
    );
    expect(screen.getByText("Training", { selector: "a, a *" }).closest("a")).toHaveAttribute(
      "href",
      "/models/training",
    );
  });

  it("hosts the Library at /models/library", async () => {
    renderModels("/models/library");
    expect(await screen.findByRole("heading", { name: "Library", level: 2 })).toBeInTheDocument();
    expect(await screen.findByText("yolo11m-coco")).toBeInTheDocument();
  });
});
