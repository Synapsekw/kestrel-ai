import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { errorBody, fakeClient, MAP_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { reportConfig } from "@/test/reportBuilderFixtures";
import { useToastStore } from "@/ui";
import { SaveTemplateDialog } from "./SaveTemplateDialog";

function setup(status = 201) {
  const onClose = vi.fn();
  const base = reportConfig();
  const config = {
    ...base,
    cover: { ...base.cover, logo_asset_id: "a1" },
    filters: { ...base.filters, data_item_ids: [MAP_ID] },
  };
  const { api, requests } = fakeClient([
    {
      method: "POST",
      path: /\/report-templates$/,
      status,
      body:
        status === 201
          ? { id: "t1" }
          : errorBody("catalogue_unavailable", "The catalogue could not be opened"),
    },
  ]);
  renderWithProviders(
    <SaveTemplateDialog open onClose={onClose} config={config} defaultName="Site inspection" />,
    { api },
  );
  return { onClose, requests };
}

const dialog = () => screen.getByRole("dialog", { name: "Save as template" });

describe("SaveTemplateDialog", () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }));

  it("says what a template does not keep", () => {
    setup();
    expect(dialog()).toHaveTextContent(/Data-item filters, the logo and the report date are not kept/);
  });

  it("saves the layout without the project-only fields", async () => {
    const { requests, onClose } = setup();
    fireEvent.change(within(dialog()).getByLabelText("Name"), { target: { value: "North yard layout" } });
    fireEvent.change(within(dialog()).getByLabelText("Description"), { target: { value: "Monthly" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Save template" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const body = requests[0].body as {
      name: string;
      description: string;
      config: ReturnType<typeof reportConfig>;
    };
    expect(body.name).toBe("North yard layout");
    expect(body.description).toBe("Monthly");
    expect(body.config.filters.data_item_ids).toBeNull();
    expect(body.config.cover.logo_asset_id).toBeNull();
    expect(useToastStore.getState().toasts.at(-1)?.text).toBe('Template "North yard layout" saved');
  });

  it("explains when the catalogue is unavailable", async () => {
    const { onClose } = setup(503);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Save template" }));
    expect(await within(dialog()).findByText(/templates cannot be saved right now/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
