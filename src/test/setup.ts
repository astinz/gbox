import "@testing-library/jest-dom/vitest";

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
