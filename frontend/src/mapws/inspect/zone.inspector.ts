import { toast } from "@/ui";
import type { InspectorKind } from "@/mapws/annotations/bindings";
import { removeZone, zoneDeleted } from "@/mapws/zones/actions";
import { useZonesStore } from "@/mapws/zones/store";
import { ZoneInspector } from "@/mapws/zones/ZoneInspector";

/**
 * Spec §5.3 "Zone", in W1's framed glass (W3-14 for `Del`). W1's dialog title already asks "Delete
 * this zone?", so the confirm line only adds the recount (A17).
 */
const zone: InspectorKind = {
  id: "zone",
  label: "Zone",
  framed: true,
  Body: ZoneInspector,
  remove: {
    confirm: () => "Object counts update in the background.",
    run: async (sel, { api, projectId }) => {
      const name = useZonesStore.getState().items.find((a) => a.id === sel.id)?.name ?? "Zone";
      await removeZone(api, projectId, sel.id);
      toast("ok", zoneDeleted(name));
    },
  },
};

export default zone;
