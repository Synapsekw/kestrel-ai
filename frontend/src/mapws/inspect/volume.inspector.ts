import { deleteVolumeSelection } from "../volume/volumeActions";
import { VolumeInspector } from "../volume/VolumeInspector";
import type { InspectorKind } from "../w4host";

/** Spec §5.3 Volume: its own pane (R-W1-11); Del deletes after W1's confirm. */
const volumeInspector: InspectorKind = {
  id: "volume",
  label: "Volume measurement",
  framed: false,
  Body: VolumeInspector,
  remove: {
    // W1's dialog title already asks "Delete this volume measurement?" (ruling T9-1).
    confirm: () => "Its results and exports go with it. This cannot be undone.",
    run: (sel, { api, projectId }) => deleteVolumeSelection(api, projectId, sel.id),
  },
};

export default volumeInspector;
