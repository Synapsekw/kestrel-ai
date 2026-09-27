import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import { CanvasLab } from "./CanvasLab";

// Dev-only page (not in the production build): http://127.0.0.1:1420/canvas-lab.html
// ?shapes=500 loads the §17 flow-6 set; ?effects=reduced and ?motion=reduced as in the gallery.
const params = new URLSearchParams(window.location.search);
document.documentElement.dataset.effects = params.get("effects") === "reduced" ? "reduced" : "full";
if (params.get("motion") === "reduced") document.documentElement.dataset.motion = "reduced";

const root = document.getElementById("canvas-lab");
if (!root) throw new Error("#canvas-lab is missing from canvas-lab.html");

createRoot(root).render(
  <StrictMode>
    <CanvasLab />
  </StrictMode>,
);
