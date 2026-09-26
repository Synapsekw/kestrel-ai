import { useState } from "react";
import { Slider } from "@/ui/Slider";

export const title = "Slider";
export const order = 100;

const BUDGETS = [500_000, 1_000_000, 2_000_000, 4_000_000];
const millions = (n: number) => `${n / 1_000_000} M`;

export default function SliderSection() {
  const [opacity, setOpacity] = useState(0.8);
  const [blend, setBlend] = useState(0.55);
  const [size, setSize] = useState(2);
  const [budget, setBudget] = useState(2_000_000);
  return (
    <div className="grid max-w-md gap-4">
      <Slider
        label="Opacity"
        min={0}
        max={1}
        step={0.05}
        value={opacity}
        onChange={setOpacity}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <Slider
        label="Blend"
        min={0}
        max={1}
        step={0.01}
        value={blend}
        onChange={setBlend}
        format={(v) => v.toFixed(2)}
      />
      <Slider
        label="Point size"
        min={1}
        max={6}
        step={0.5}
        value={size}
        onChange={setSize}
        format={(v) => `${v} px`}
      />
      <Slider
        label="Point budget"
        min={500_000}
        max={4_000_000}
        stops={BUDGETS}
        value={budget}
        onChange={setBudget}
        format={millions}
      />
      <Slider label="Disabled" min={0} max={1} step={0.1} value={0.3} onChange={() => {}} disabled />
    </div>
  );
}
