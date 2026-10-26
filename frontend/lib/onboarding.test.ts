import { describe, expect, it } from "vitest";
import { advanceOnboarding, initialOnboarding } from "./onboarding";

describe("settings walkthrough checkpoints", () => {
  it("continues through undecided sections and records explicit skips", () => {
    let progress = advanceOnboarding(initialOnboarding(), "model");
    expect(progress.current).toBe("channels");
    progress = advanceOnboarding(progress, "channels", true);
    expect(progress.skipped).toEqual(["channels"]);
    expect(progress.current).toBe("services");
    progress = advanceOnboarding(progress, "services");
    progress = advanceOnboarding(progress, "tools");
    expect(progress.finished).toBe(true);
    expect(progress.completed).toEqual(["model", "services", "tools"]);
  });
  it("revisiting a skipped section replaces its decision and clears the pending job", () => {
    const progress = {
      ...initialOnboarding(),
      skipped: ["model" as const],
      pending: { jobId: "job", section: "model" as const },
    };
    const next = advanceOnboarding(progress, "model");
    expect(next.skipped).toEqual([]);
    expect(next.completed).toEqual(["model"]);
    expect(next.pending).toBeNull();
  });
});
