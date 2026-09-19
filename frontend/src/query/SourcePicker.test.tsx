import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { exampleProviders, PROJECT_ID } from "@/test/fixtures";
import { DEFAULT_QUERY_FORM } from "./queryModel";
import { SourcePicker } from "./SourcePicker";

describe("SourcePicker", () => {
  it("links a provider without a key to the App settings, where keys live", () => {
    const noKey = exampleProviders.map((p) => ({ ...p, has_key: false }));
    render(
      <MemoryRouter>
        <SourcePicker
          projectId={PROJECT_ID}
          form={{ ...DEFAULT_QUERY_FORM, kind: "cloud_provider", provider: "anthropic" }}
          onChange={() => {}}
          models={[]}
          modelsUnavailable={false}
          modelsLoading={false}
          modelsError={null}
          providers={noKey}
          providersUnavailable={false}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("note")).toHaveTextContent("No API key stored for Anthropic.");
    expect(screen.getByRole("link", { name: "Add the key in App settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });
});
