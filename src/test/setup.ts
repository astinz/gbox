import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, vi } from "vitest";

vi.mock("thinking-orbs", () => ({
  ThinkingOrb: ({ state, size, paused }: { state: string; size: number; paused: boolean }) =>
    createElement("span", {
      "data-testid": "thinking-orb",
      "data-state": state,
      "data-size": size,
      "data-paused": paused,
    }),
}));

afterEach(cleanup);

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  value: ResizeObserverStub,
  writable: true,
});

if (typeof Element !== "undefined") {
  Object.defineProperty(Element.prototype, "getAnimations", {
    value: () => [],
    writable: true,
  });
}
