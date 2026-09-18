import { describe, it, expect } from "vitest";
import { exampleProviders, exampleQueryRun } from "@/test/fixtures";
import {
  DEFAULT_QUERY_FORM,
  formKey,
  imageQuery,
  REVIEW_LINK_MAX_IDS,
  reviewLink,
  runTitle,
  toQueryRunCreate,
  validateQueryForm,
} from "./queryModel";

const local = { ...DEFAULT_QUERY_FORM, modelId: "m1" };
const cloud = {
  ...DEFAULT_QUERY_FORM,
  kind: "cloud_provider" as const,
  provider: "anthropic" as const,
  query: "dump trucks",
};

describe("query form model", () => {
  it("builds the contract request for both kinds", () => {
    expect(toQueryRunCreate(local, ["a", "b"])).toEqual({
      kind: "local_model",
      model_id: "m1",
      image_ids: ["a", "b"],
      tiling: { enabled: true, tile_size: 1280, overlap: 0.2, nms_iou: 0.5 },
      conf: 0.25,
    });
    expect(toQueryRunCreate({ ...cloud, tilingEnabled: false, tileSize: "640", conf: "0.4" }, ["a"])).toEqual(
      {
        kind: "cloud_provider",
        provider: "anthropic",
        query: "dump trucks",
        image_ids: ["a"],
        tiling: { enabled: false, tile_size: 640, overlap: 0.2, nms_iou: 0.5 },
        conf: 0.4,
      },
    );
    expect(formKey(local, ["a"])).toBe(JSON.stringify(toQueryRunCreate(local, ["a"])));
  });

  it("validates source, provider key, query text, images and tiling", () => {
    expect(validateQueryForm(local, 2, exampleProviders)).toBeNull();
    expect(validateQueryForm({ ...local, modelId: "" }, 2, exampleProviders)).toBe("Choose a model.");
    expect(validateQueryForm(cloud, 2, exampleProviders)).toBeNull();
    expect(validateQueryForm({ ...cloud, provider: "openai" }, 2, exampleProviders)).toBe(
      "No API key stored for OpenAI. Add one in Settings.",
    );
    expect(validateQueryForm({ ...cloud, query: " " }, 2, exampleProviders)).toBe(
      "Describe what to find, for example: dump trucks.",
    );
    expect(validateQueryForm({ ...local, mode: "group" }, 2, exampleProviders)).toBe("Enter a group key.");
    expect(validateQueryForm({ ...local, mode: "first_n", firstN: "0" }, 2, exampleProviders)).toBe(
      "Number of images must be a whole number of at least 1.",
    );
    expect(validateQueryForm(local, 0, exampleProviders)).toBe("No images selected.");
    expect(validateQueryForm({ ...local, tileSize: "100" }, 2, exampleProviders)).toBe(
      "Tile size must be a whole number from 256 to 4096.",
    );
    expect(validateQueryForm({ ...local, overlap: "0.9" }, 2, exampleProviders)).toBe(
      "Overlap must be between 0 and 0.5.",
    );
    expect(validateQueryForm({ ...local, nmsIou: "2" }, 2, exampleProviders)).toBe(
      "NMS IoU must be between 0 and 1.",
    );
    expect(validateQueryForm({ ...local, conf: "" }, 2, exampleProviders)).toBe(
      "Confidence must be between 0 and 1.",
    );
    // Disabled tiling fields are not sent to the user as blockers.
    expect(
      validateQueryForm(
        { ...local, tilingEnabled: false, tileSize: "100", overlap: "9" },
        2,
        exampleProviders,
      ),
    ).toBeNull();
  });

  it("maps image modes to list queries", () => {
    expect(imageQuery({ ...local, mode: "selection" })).toBeNull();
    expect(imageQuery({ ...local, mode: "unlabeled" })).toEqual({
      query: { labeled: false, sort: "path", order: "asc", limit: 1000 },
      maxPages: 20,
    });
    expect(imageQuery({ ...local, mode: "group", groupKey: " 0031 " })).toEqual({
      query: { group_key: "0031", sort: "path", order: "asc", limit: 1000 },
      maxPages: 20,
    });
    expect(imageQuery({ ...local, mode: "first_n", firstN: "25" })).toEqual({
      query: { sort: "path", order: "asc", limit: 25 },
      maxPages: 1,
    });
    expect(imageQuery({ ...local, mode: "first_n", firstN: "5000" })).toEqual({
      query: { sort: "path", order: "asc", limit: 1000 },
      maxPages: 5,
    });
  });

  it("links the review queue to the run's images, capped", () => {
    expect(reviewLink("p", exampleQueryRun)).toEqual({
      to: `/p/p/review?ids=${exampleQueryRun.image_ids.join(",")}`,
      capped: false,
    });
    const big = { ...exampleQueryRun, image_ids: Array.from({ length: 250 }, (_, i) => `i${i}`) };
    const link = reviewLink("p", big);
    expect(link.capped).toBe(true);
    expect(link.to.split(",")).toHaveLength(REVIEW_LINK_MAX_IDS);
    expect(runTitle(exampleQueryRun)).toBe('Anthropic: "dump trucks"');
    expect(
      runTitle({
        ...exampleQueryRun,
        kind: "local_model",
        provider: null,
        model_name: "yolo11m-coco",
        query: "",
      }),
    ).toBe("Local model yolo11m-coco");
  });
});
