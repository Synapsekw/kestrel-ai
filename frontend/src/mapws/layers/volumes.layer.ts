import { VolumeMount } from "../volume/VolumeMount";
import type { LayerKind } from "../w4host";

/** The one undated Volumes row (both swipe sides); its Mount draws every measurement in the site frame. */
const volumesLayer: LayerKind = {
  id: "volumes",
  group: "annotations",
  icon: "volume",
  rows: () => [
    {
      key: "volumes:volumes",
      kind: "volumes",
      group: "annotations",
      id: "volumes",
      name: "Volumes",
      meta: "Stockpile volumes",
      date: null,
    },
  ],
  Mount: VolumeMount,
};

export default volumesLayer;
