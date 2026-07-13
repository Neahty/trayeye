import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

if (typeof globalThis.URL.createObjectURL !== "function") {
  globalThis.URL.createObjectURL = () => "blob:mock";
}
if (typeof globalThis.URL.revokeObjectURL !== "function") {
  globalThis.URL.revokeObjectURL = () => {};
}

afterEach(() => {
  cleanup();
});
