import { useApi } from "@/api/client";
import { patchDrawing, type Drawing } from "@/api/drawings";
import { messageOf } from "@/api/errors";
import { Checkbox, toast } from "@/ui";
import { LayerSwatch } from "./DrawingLayerPicker";
import { useDrawingsStore } from "./drawingsStore";

/** Per-layer visibility (spec §5.2 "DXF layer list"): stored in layer_state, a restyle on the map. */
export function DrawingLayerToggles({ projectId, drawing }: { projectId: string; drawing: Drawing }) {
  const api = useApi();
  const hidden = new Set(drawing.layer_state.hidden_layers);
  async function toggle(name: string, visible: boolean) {
    const next = visible ? [...hidden].filter((n) => n !== name) : [...hidden, name];
    try {
      useDrawingsStore.getState().upsert(
        await patchDrawing(api, projectId, drawing.id, {
          layer_state: { ...drawing.layer_state, hidden_layers: next },
        }),
      );
    } catch (e) {
      toast("danger", messageOf(e, "could not change the layer"));
    }
  }
  return (
    <ul className="flex flex-col gap-1">
      {drawing.layers.map((l) => (
        <li key={l.name}>
          <Checkbox
            label={
              <span className="flex items-center gap-2">
                <LayerSwatch colour={l.colour} />
                <span className="font-mono text-xs">{l.name}</span>
              </span>
            }
            checked={!hidden.has(l.name)}
            onChange={(e) => void toggle(l.name, e.target.checked)}
          />
        </li>
      ))}
    </ul>
  );
}
