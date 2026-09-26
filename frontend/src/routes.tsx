import { createBrowserRouter } from "react-router-dom";
import { routeTree } from "@/routes/tree";

/** The app's router. Routes live in `routes/`: S1 and S2 add entries to its two table files only. */
export const router = createBrowserRouter(routeTree);
