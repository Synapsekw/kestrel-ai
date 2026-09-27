import { useEffect } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { fakeClient } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useSeverityScale } from "@/ui";
import { CatalogueSeverityProvider } from "./CatalogueSeverityProvider";
import { useCatalogueSeverity } from "./severityStore";

function Probe() {
  return (
    <span data-testid="scale">
      {useSeverityScale()
        .map((l) => l.name)
        .join(",")}
    </span>
  );
}

describe("CatalogueSeverityProvider", () => {
  beforeEach(() => useCatalogueSeverity.setState({ levels: null }));

  it("shows DS's default scale until the catalogue answers", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <CatalogueSeverityProvider>
        <Probe />
      </CatalogueSeverityProvider>,
      { api },
    );
    expect(screen.getByTestId("scale")).toHaveTextContent("Minor,Moderate,Major,Critical");
  });

  it("feeds the app-wide scale from the catalogue", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/catalogue\/severity$/,
        body: {
          levels: [
            { level: 1, name: "Low", colour: "#3fb68e" },
            { level: 2, name: "High", colour: "#ff5a4f" },
          ],
        },
      },
    ]);
    renderWithProviders(
      <CatalogueSeverityProvider>
        <Probe />
      </CatalogueSeverityProvider>,
      { api },
    );
    expect(await screen.findByText("Low,High")).toBeInTheDocument();
  });

  it("keeps the app mounted when the scale arrives, so nothing the operator opened is lost", async () => {
    let mounts = 0;
    function Counter() {
      useEffect(() => {
        mounts += 1;
      }, []);
      return <Probe />;
    }
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/catalogue\/severity$/,
        body: { levels: [{ level: 1, name: "Low", colour: "#3fb68e" }] },
      },
    ]);
    renderWithProviders(
      <CatalogueSeverityProvider>
        <Counter />
      </CatalogueSeverityProvider>,
      { api },
    );
    expect(await screen.findByText("Low")).toBeInTheDocument();
    expect(mounts).toBe(1);
  });
});
