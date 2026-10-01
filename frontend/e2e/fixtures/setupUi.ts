import type { Page } from "@playwright/test";

// Every setup-page handle the S1 journeys use (plan 2026-09-30-setup-u6 Task 7); "Folder or file path"
// and "Sort files" are the coordinator's names for U5's browser-mode path entry. The merged U5
// code wins: when a name differs, change it here only, never in a spec's assertions.
// Pinned against the merged page: the folder field is labelled "Folder" (BasicsCard), and each slot is
// a `section` named by its label, so its role is region (SlotGrid), not group.
export const setupUi = {
  newProject: (page: Page) => page.getByRole("button", { name: "New project" }),
  template: (page: Page, name: string) => page.getByRole("radio", { name: new RegExp(`^${name}`) }),
  name: (page: Page) => page.getByLabel("Name", { exact: true }),
  folder: (page: Page) => page.getByLabel("Folder", { exact: true }),
  sortPath: (page: Page) => page.getByLabel("Folder or file path"),
  sortButton: (page: Page) => page.getByRole("button", { name: "Sort files" }),
  slot: (page: Page, label: string) => page.getByRole("region", { name: label, exact: true }),
  sharedFolderNote: (page: Page) =>
    page.getByText("Visual and thermal photos in the same folder are imported together"),
  create: (page: Page) => page.getByRole("button", { name: "Create project" }),
  notice: (page: Page) => page.getByTestId("setup-notice"),
};

/** Types a delivery folder into the Data card and starts the inspect job. */
export async function sortFolder(page: Page, path: string): Promise<void> {
  await setupUi.sortPath(page).fill(path);
  await setupUi.sortButton(page).click();
}

/** The Vertical asset inspection types (spec §5.1): name, kind, default severity, hotkey. */
export const VERTICAL_TYPES = [
  ["Corrosion", "defect", 2, "1"],
  ["Coating damage", "defect", 1, "2"],
  ["Loose / missing bolt", "defect", 3, "3"],
  ["Antenna misalignment", "defect", 3, "4"],
  ["Bird nest", "object", 2, "5"],
  ["Thermal hot spot", "defect", 4, "6"],
  ["Cracked weld", "defect", 4, "7"],
] as const;
