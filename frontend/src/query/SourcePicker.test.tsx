import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { exampleModel, exampleProviders, exampleTrainedModel } from "@/test/fixtures";
import { DEFAULT_QUERY_FORM } from "./queryModel";
import { SourcePicker } from "./SourcePicker";

describe("SourcePicker", () => {
  it("links a provider without a key to the App settings, where keys live", () => {
    const noKey = exampleProviders.map((p) => ({ ...p, has_key: false }));
    render(
      <MemoryRouter>
        <SourcePicker
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

  it("lists library models under one group and disables a model whose file is missing", () => {
    const { container } = render(
      <MemoryRouter>
        <SourcePicker
          form={DEFAULT_QUERY_FORM}
          onChange={() => {}}
          models={[exampleTrainedModel, { ...exampleModel, state: "unavailable" }]}
          modelsUnavailable={false}
          modelsLoading={false}
          modelsError={null}
          providers={exampleProviders}
          providersUnavailable={false}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("radio", { name: "Library model" })).toBeChecked();
    expect(container.querySelector("optgroup")).toHaveAttribute("label", "Models in your library");
    expect(screen.getByRole("option", { name: "ahmadia-v1-n (Trained)" })).toBeEnabled();
    expect(screen.getByRole("option", { name: "yolo11m-coco (Starter) (file missing)" })).toBeDisabled();
  });
});
