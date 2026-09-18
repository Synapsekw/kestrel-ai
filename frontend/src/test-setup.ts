import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Testing Library only auto-cleans when `afterEach` is a global; Vitest runs without globals here.
afterEach(cleanup);
