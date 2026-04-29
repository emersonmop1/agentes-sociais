import { describe, expect, it } from "vitest";
import { nextStatus } from "../src/core/creator-state-machine";

/**
 * Pure-function tests — no DB, no auth. These guard against regressions in
 * the FSM as we add agents/states later. Mirror the actual flow a post
 * walks: draft → review → approved → next review → ... → ready → published.
 */
describe("creator state machine — happy path", () => {
  it("submit_copy: draft → copy_review", () => {
    expect(nextStatus("draft", "submit_copy")).toBe("copy_review");
  });

  it("approve: copy_review → copy_approved", () => {
    expect(nextStatus("copy_review", "approve")).toBe("copy_approved");
  });

  it("submit_design: copy_approved → design_review", () => {
    expect(nextStatus("copy_approved", "submit_design")).toBe("design_review");
  });

  it("approve: design_review → design_approved", () => {
    expect(nextStatus("design_review", "approve")).toBe("design_approved");
  });

  it("submit_caption: design_approved → caption_review", () => {
    expect(nextStatus("design_approved", "submit_caption")).toBe("caption_review");
  });

  it("approve_final: caption_approved → ready", () => {
    expect(nextStatus("caption_approved", "submit_final")).toBe("final_review");
    expect(nextStatus("final_review", "approve_final")).toBe("ready");
  });

  it("publish_now: ready → publishing", () => {
    expect(nextStatus("ready", "publish_now")).toBe("publishing");
  });

  it("publish_success: publishing → published", () => {
    expect(nextStatus("publishing", "publish_success")).toBe("published");
  });
});

describe("creator state machine — rejection paths", () => {
  // Implementation choice: reject from ANY review state lands back in draft.
  // The user can rewrite from scratch with the rejection_feedback recorded.
  it("reject from copy_review → draft", () => {
    expect(nextStatus("copy_review", "reject")).toBe("draft");
  });

  it("reject from design_review → draft", () => {
    expect(nextStatus("design_review", "reject")).toBe("draft");
  });

  it("reject from caption_review → draft", () => {
    expect(nextStatus("caption_review", "reject")).toBe("draft");
  });

  it("reject from final_review → draft", () => {
    expect(nextStatus("final_review", "reject")).toBe("draft");
  });

  it("kill always lands on rejected, regardless of state", () => {
    expect(nextStatus("draft", "kill")).toBe("rejected");
    expect(nextStatus("ready", "kill")).toBe("rejected");
    expect(nextStatus("publishing", "kill")).toBe("rejected");
  });
});

describe("creator state machine — invalid transitions throw", () => {
  it("can't approve from draft", () => {
    expect(() => nextStatus("draft", "approve")).toThrow();
  });

  it("can't publish_now from draft", () => {
    expect(() => nextStatus("draft", "publish_now")).toThrow();
  });

  it("can't submit_copy from copy_review (already submitted)", () => {
    expect(() => nextStatus("copy_review", "submit_copy")).toThrow();
  });

  it("can't approve from rejected", () => {
    expect(() => nextStatus("rejected", "approve")).toThrow();
  });
});
