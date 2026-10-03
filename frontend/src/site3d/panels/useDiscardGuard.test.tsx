import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithDataRouter } from "@/test/dataRouter";
import { useDiscardGuard } from "./useDiscardGuard";

function Harness({ dirty }: { dirty: boolean }) {
  const { guard, dialog } = useDiscardGuard(dirty, "LNG tank 1");
  const navigate = useNavigate();
  const [picked, setPicked] = useState("none");
  return (
    <>
      <button onClick={() => guard(() => setPicked("pump"))}>Pick another</button>
      <button onClick={() => navigate("/elsewhere")}>Leave</button>
      <output>{picked}</output>
      {dialog}
    </>
  );
}
const mount = (dirty: boolean) => renderWithDataRouter(<Harness dirty={dirty} />);

describe("useDiscardGuard", () => {
  it("asks before dropping edits, and keeps them on Keep editing", () => {
    mount(true);
    fireEvent.click(screen.getByRole("button", { name: "Pick another" }));
    expect(screen.getByRole("dialog", { name: "Discard your changes to LNG tank 1?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByText("none")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pick another" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByText("pump")).toBeInTheDocument();
  });

  it("asks before leaving the screen with unsaved edits", async () => {
    mount(true);
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(
      await screen.findByRole("dialog", { name: "Discard your changes to LNG tank 1?" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(await screen.findByText("Elsewhere")).toBeInTheDocument();
  });

  it("Keep editing stays on the screen", async () => {
    mount(true);
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Elsewhere")).toBeNull();
    expect(screen.getByRole("button", { name: "Pick another" })).toBeInTheDocument();
  });

  it("without edits nothing asks", async () => {
    mount(false);
    fireEvent.click(screen.getByRole("button", { name: "Pick another" }));
    expect(screen.getByText("pump")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(await screen.findByText("Elsewhere")).toBeInTheDocument();
  });
});
