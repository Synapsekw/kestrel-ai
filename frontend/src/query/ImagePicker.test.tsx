import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DEFAULT_QUERY_FORM } from "./queryModel";
import { ImagePicker } from "./ImagePicker";

const groups = [
  { group_key: "0031", image_count: 697 },
  { group_key: "0033", image_count: 12 },
];

describe("ImagePicker", () => {
  it("offers the project's flights as a list instead of asking for a key to be typed", () => {
    const onChange = vi.fn();
    render(
      <ImagePicker
        form={{ ...DEFAULT_QUERY_FORM, mode: "group", groupKey: "" }}
        onChange={onChange}
        preloadedCount={0}
        count={0}
        loading={false}
        groups={groups}
      />,
    );
    const select = screen.getByLabelText("Flight or tile");
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "0031 (697 images)" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "0033" } });
    expect(onChange).toHaveBeenCalledWith({ groupKey: "0033" });
  });

  it("falls back to a text field when the groups are not known", () => {
    render(
      <ImagePicker
        form={{ ...DEFAULT_QUERY_FORM, mode: "group", groupKey: "" }}
        onChange={() => {}}
        preloadedCount={0}
        count={0}
        loading={false}
        groups={[]}
      />,
    );
    expect(screen.getByLabelText("Flight or tile").tagName).toBe("INPUT");
  });

  it("explains that the first N images are taken in file order and may include labeled ones", () => {
    render(
      <ImagePicker
        form={{ ...DEFAULT_QUERY_FORM, mode: "first_n", firstN: "50" }}
        onChange={() => {}}
        preloadedCount={0}
        count={40}
        loading={false}
        groups={groups}
      />,
    );
    expect(screen.getByText("In file-name order, labeled images included.")).toBeInTheDocument();
  });
});
