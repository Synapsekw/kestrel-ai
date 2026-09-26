import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "@/index.css";
import { Gallery } from "./Gallery";

// Dev-only page (not in the production build): http://127.0.0.1:1420/gallery.html
// ?effects=reduced and ?motion=reduced preview the two modes without touching saved settings.
const params = new URLSearchParams(window.location.search);
document.documentElement.dataset.effects = params.get("effects") === "reduced" ? "reduced" : "full";
if (params.get("motion") === "reduced") document.documentElement.dataset.motion = "reduced";

const root = document.getElementById("gallery");
if (!root) throw new Error("#gallery is missing from gallery.html");

createRoot(root).render(
  <StrictMode>
    <MemoryRouter>
      <Gallery />
    </MemoryRouter>
  </StrictMode>,
);
