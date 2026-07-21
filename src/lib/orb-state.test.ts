import { describe, expect, it } from "vitest";

import { orbForActivity, orbForDashboard, orbForNotch } from "@/lib/orb-state";
import { emptySnapshot } from "@/types/gbox";

describe("gBox orb presentation", () => {
  it("uses shaping for capture and searching for evidence checks", () => {
    expect(orbForNotch("captured")).toEqual({ state: "shaping", paused: false });
    expect(orbForNotch("checking")).toEqual({ state: "searching", paused: false });
    expect(orbForNotch("watching")).toEqual({ state: "listening", paused: true });
  });

  it("maps visible work to the closest activity animation", () => {
    expect(orbForActivity({
      visible: true,
      phase: "working",
      headline: "Checking public sources",
      detail: "Reviewing available evidence",
      items: [],
    })).toEqual({ state: "searching", paused: false });
    expect(orbForActivity({
      visible: true,
      phase: "working",
      headline: "Preparing the response",
      detail: "The final response is arriving",
      items: [],
    })).toEqual({ state: "composing", paused: false });
  });

  it("animates the dashboard only while checks are waiting", () => {
    expect(orbForDashboard({ ...emptySnapshot, observationQueueDepth: 2 }))
      .toEqual({ state: "searching", paused: false });
    expect(orbForDashboard(emptySnapshot))
      .toEqual({ state: "listening", paused: true });
  });
});
