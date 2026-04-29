/**
 * Reels script state machine. Simpler than InstaCreator — 4 review stages,
 * 1 terminal "ready", 1 "rejected" (kill switch).
 *
 *   draft → hooks_review → hook_picked → script_review → script_approved →
 *           caption_review → caption_approved → broll_review → ready
 */

import type { Queryable } from "../db/client.js";
import type {
  ReelsScriptRow,
  ReelsStatus,
} from "../db/repositories/reels-scripts.js";
import { updateStatus } from "../db/repositories/reels-scripts.js";

export type ReelsEvent =
  | "submit_hooks"      // draft → hooks_review
  | "pick_hook"         // hooks_review → hook_picked
  | "submit_script"     // hook_picked → script_review
  | "approve_script"    // script_review → script_approved
  | "submit_caption"    // script_approved → caption_review
  | "approve_caption"   // caption_review → caption_approved
  | "submit_broll"      // caption_approved → broll_review
  | "approve_broll"     // broll_review → ready
  | "reject"            // any review → draft (with feedback)
  | "kill";             // any → rejected

export function nextStatus(
  current: ReelsStatus,
  event: ReelsEvent,
): ReelsStatus {
  if (event === "kill") return "rejected";

  switch (event) {
    case "submit_hooks":
      assert(current === "draft", current, event);
      return "hooks_review";
    case "pick_hook":
      assert(current === "hooks_review", current, event);
      return "hook_picked";
    case "submit_script":
      assert(current === "hook_picked", current, event);
      return "script_review";
    case "approve_script":
      assert(current === "script_review", current, event);
      return "script_approved";
    case "submit_caption":
      assert(current === "script_approved", current, event);
      return "caption_review";
    case "approve_caption":
      assert(current === "caption_review", current, event);
      return "caption_approved";
    case "submit_broll":
      assert(current === "caption_approved", current, event);
      return "broll_review";
    case "approve_broll":
      assert(current === "broll_review", current, event);
      return "ready";
    case "reject":
      // Reject from any review goes back to draft + rev count
      assert(
        current === "hooks_review" ||
          current === "script_review" ||
          current === "caption_review" ||
          current === "broll_review",
        current,
        event,
      );
      return "draft";
    default: {
      const _exhaustive: never = event;
      void _exhaustive;
      throw new Error(`Unknown event: ${String(event)}`);
    }
  }
}

function assert(ok: boolean, current: ReelsStatus, event: ReelsEvent) {
  if (!ok) {
    const err = new Error(`Invalid transition: ${current} -× ${event}`);
    (err as Error & { code?: string }).code = "INVALID_TRANSITION";
    throw err;
  }
}

export async function applyTransition(args: {
  reelId: string;
  companyId: string;
  current: ReelsStatus;
  event: ReelsEvent;
  rejectionFeedback?: string;
  client?: Queryable;
}): Promise<{ row: ReelsScriptRow; description: string }> {
  const target = nextStatus(args.current, args.event);
  const description = `${args.event}: ${args.current} → ${target}`;
  const row = await updateStatus(args.client, {
    id: args.reelId,
    companyId: args.companyId,
    status: target,
    rejectionFeedback: args.event === "reject" ? args.rejectionFeedback ?? null : null,
    incrementRevision: args.event === "reject",
  });
  return { row, description };
}
