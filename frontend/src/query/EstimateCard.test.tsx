import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { exampleEstimate } from "@/test/fixtures";
import { EstimateCard } from "./EstimateCard";

describe("EstimateCard", () => {
  it("prices a cloud run", () => {
    render(<EstimateCard estimate={exampleEstimate} local={false} />);
    expect(screen.getByTestId("estimate")).toHaveTextContent(
      /requests, estimated \$\d+\.\d\d \(at \$\d+\.\d\d per request\)/,
    );
  });

  it("does not talk about money for a model that runs on this computer", () => {
    render(
      <EstimateCard
        estimate={{
          ...exampleEstimate,
          images: 40,
          tiles: 480,
          requests: 480,
          estimated_cost: 0,
          cost_per_request: 0,
        }}
        local
      />,
    );
    const text = screen.getByTestId("estimate").textContent ?? "";
    expect(text).toBe(
      "40 images, 480 tiles. Runs on this computer's GPU: no cost, nothing leaves the machine.",
    );
    expect(text).not.toContain("$");
  });
});
