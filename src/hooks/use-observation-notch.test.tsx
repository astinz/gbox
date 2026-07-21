import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  setNotchPresentation: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    mocks.handlers.set(name, handler);
    return () => mocks.handlers.delete(name);
  }),
}));

vi.mock("@/lib/gbox-api", () => ({
  gboxApi: {
    snapshot: mocks.snapshot,
    setNotchPresentation: mocks.setNotchPresentation,
    openMainWindow: vi.fn(),
  },
}));

import { useObservationNotch } from "@/hooks/use-observation-notch";
import { emptySnapshot } from "@/types/gbox";

describe("useObservationNotch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.handlers.clear();
    mocks.setNotchPresentation.mockReset().mockResolvedValue(undefined);
    mocks.snapshot.mockReset().mockResolvedValue(emptySnapshot);
  });

  afterEach(() => vi.useRealTimers());

  it("expands after native hover intent and collapses after exit grace", async () => {
    const { result, unmount } = renderHook(() => useObservationNotch());
    await act(async () => Promise.resolve());
    const hover = mocks.handlers.get("gbox://notch-hover-changed");
    expect(hover).toBeDefined();

    act(() => hover?.({ payload: true }));
    act(() => vi.advanceTimersByTime(119));
    expect(result.current.expanded).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.expanded).toBe(true);

    act(() => hover?.({ payload: false }));
    act(() => vi.advanceTimersByTime(259));
    expect(result.current.expanded).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.expanded).toBe(false);
    unmount();
  });
});
