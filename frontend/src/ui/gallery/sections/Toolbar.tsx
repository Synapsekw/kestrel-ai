import { useState } from "react";
import { FloatingToolbar, ToolSeparator, type ToolDef } from "@/ui/FloatingToolbar";

export const title = "Toolbar";
export const order = 50;

const TOOLS: Array<Omit<ToolDef, "onClick" | "active">> = [
  { id: "select", icon: "fit", label: "Select", shortcut: "V", action: "tool-select" },
  { id: "pan", icon: "map", label: "Pan", shortcut: "H", action: "tool-pan" },
  { id: "box", icon: "label", label: "Box", shortcut: "B" },
  { id: "rbox", icon: "refresh", label: "Rotated box", shortcut: "R" },
  { id: "polygon", icon: "drawing", label: "Polygon", shortcut: "P" },
  { id: "smart", icon: "sparkle", label: "Smart polygon", shortcut: "S" },
  { id: "marker", icon: "pin", label: "Point marker", shortcut: "M" },
  { id: "length", icon: "measure", label: "Measure length", shortcut: "L" },
  { id: "detect", icon: "detect", label: "AI detect", shortcut: "D" },
];

export default function ToolbarSection() {
  const [tool, setTool] = useState("box");
  const [zoom, setZoom] = useState(100);
  return (
    <div
      className="relative h-[420px] overflow-hidden rounded-panel"
      style={{
        background:
          "radial-gradient(600px 400px at 50% 40%, rgba(143,123,255,.07), transparent 70%), #0a0a16",
      }}
    >
      <FloatingToolbar
        label="Image tools"
        className="absolute left-3 top-3"
        tools={TOOLS.map((t) => ({ ...t, active: t.id === tool, onClick: () => setTool(t.id) }))}
      />
      <FloatingToolbar
        label="Zoom"
        orientation="horizontal"
        className="absolute right-3 top-3"
        tools={[
          {
            id: "out",
            icon: "minus",
            label: "Zoom out",
            shortcut: "-",
            action: "zoom-out",
            onClick: () => setZoom((z) => Math.max(10, z - 10)),
          },
          {
            id: "in",
            icon: "plus",
            label: "Zoom in",
            shortcut: "+",
            action: "zoom-in",
            onClick: () => setZoom((z) => z + 10),
          },
        ]}
      >
        <ToolSeparator orientation="horizontal" />
        <span className="w-11 text-center font-mono text-2xs">{zoom}%</span>
      </FloatingToolbar>
    </div>
  );
}
