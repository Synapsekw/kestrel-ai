import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import { applyEffects } from "@/app/effects";
import { applyMotion } from "@/ui/motion";
import "@/index.css";

// Appearance is set before the first paint, and it must never stop the app from opening.
try {
  applyMotion();
  applyEffects();
} catch (error) {
  console.error("appearance setup failed", error);
}

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
