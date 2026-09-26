import { useRef, useState } from "react";
import { Button } from "@/ui/Button";
import { Combobox, ComboboxList, type ComboItem } from "@/ui/Combobox";
import { Popover } from "@/ui/Popover";

export const title = "Combobox";
export const order = 110;

const TYPES: ComboItem[] = [
  { id: "crack", label: "Crack", hint: "Concrete defects", hotkey: "1", colour: "#ff5a4f" },
  { id: "spall", label: "Spalling", hint: "Concrete defects", hotkey: "2", colour: "#ff9c3a" },
  { id: "rust", label: "Corrosion", hint: "Steel", hotkey: "3", colour: "#e2bf2e" },
  { id: "excavator", label: "Excavator", hint: "Machinery", hotkey: "e", colour: "#8aa4ff" },
  { id: "dump", label: "Dump truck", hint: "Machinery", colour: "#5fe3c0" },
];

export default function ComboboxSection() {
  const [type, setType] = useState<string | null>("crack");
  const [picking, setPicking] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="w-60">
        <Combobox label="Type" items={TYPES} value={type} onChange={setType} />
      </div>
      <Button ref={anchor} onClick={() => setPicking(true)}>
        Type picker (T)
      </Button>
      <Popover open={picking} onClose={() => setPicking(false)} anchorRef={anchor} label="Pick the type">
        <ComboboxList
          label="Pick the type"
          items={TYPES}
          value={type}
          onSelect={(id) => {
            setType(id);
            setPicking(false);
          }}
        />
      </Popover>
    </div>
  );
}
