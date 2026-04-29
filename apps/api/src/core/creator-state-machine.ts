/**
 * Creator post state machine.
 *
 * Forward path:
 *   draft → copy_review → copy_approved → design_review → design_approved →
 *           caption_review → caption_approved → final_review → ready →
 *           scheduled → publishing → published
 *
 * Branches:
 *   any review state → previous editable state (rejection with feedback)
 *   ready/scheduled  → publishing (manual or DateTrigger)
 *   publishing       → publish_failed
 *   any state        → rejected (kill switch)
 *
 * Why a state machine instead of free updates?
 *   • The agent runs different prompts depending on stage
 *   • The kanban UI groups by stage
 *   • Reject-and-iterate workflows need to know "what's the editable state for review X?"
 *   • Audit trails get cleaner: we know what transition fired
 */
import type { Queryable } from "../db/client.js";
import type { CreatorPostStatus, CreatorPostRow } from "../db/repositories/creator-posts.js";
import { updatePostStatus } from "../db/repositories/creator-posts.js";

export type TransitionEvent =
  /** Etapa 1 just produced copy → DRAFT to COPY_REVIEW */
  | "submit_copy"
  /** Human approved current review */
  | "approve"
  /** Human rejected — pass feedback */
  | "reject"
  /** Etapa 2 produced rendered slides → COPY_APPROVED to DESIGN_REVIEW */
  | "submit_design"
  /** Etapa 3 produced caption → DESIGN_APPROVED to CAPTION_REVIEW */
  | "submit_caption"
  /** Final approval after all reviews → CAPTION_APPROVED to FINAL_REVIEW (immediately reviewable) */
  | "submit_final"
  /** Approved final → READY */
  | "approve_final"
  /** Schedule a publish */
  | "schedule"
  /** Publish now (READY → PUBLISHING) */
  | "publish_now"
  /** Worker started publishing */
  | "start_publishing"
  /** Publishing succeeded */
  | "publish_success"
  /** Publishing failed (will retry up to N) */
  | "publish_fail"
  /** Kill switch from anywhere */
  | "kill";

export interface TransitionResult {
  /** Resulting status. */
  to: CreatorPostStatus;
  /** Human-readable summary, useful for logs and the change log. */
  description: string;
}

/**
 * Pure function. Given current status + event, return the target status.
 * Throws on invalid transitions so the API can return 409.
 */
export function nextStatus(
  current: CreatorPostStatus,
  event: TransitionEvent,
): CreatorPostStatus {
  // Kill switch always wins
  if (event === "kill") return "rejected";

  switch (event) {
    case "submit_copy":
      assert(current === "draft", current, event);
      return "copy_review";

    case "approve":
      switch (current) {
        case "copy_review":
          return "copy_approved";
        case "design_review":
          return "design_approved";
        case "caption_review":
          return "caption_approved";
        default:
          throw invalid(current, event);
      }

    case "reject":
      // Reject sends back to the editable state ONE step before the review.
      switch (current) {
        case "copy_review":
        case "design_review":
        case "caption_review":
        case "final_review":
          return "draft";
        default:
          throw invalid(current, event);
      }

    case "submit_design":
      assert(current === "copy_approved", current, event);
      return "design_review";

    case "submit_caption":
      assert(current === "design_approved", current, event);
      return "caption_review";

    case "submit_final":
      assert(current === "caption_approved", current, event);
      return "final_review";

    case "approve_final":
      assert(current === "final_review", current, event);
      return "ready";

    case "schedule":
      assert(current === "ready", current, event);
      return "scheduled";

    case "publish_now":
      assert(
        current === "ready" || current === "scheduled" || current === "publish_failed",
        current,
        event,
      );
      return "publishing";

    case "start_publishing":
      assert(current === "scheduled" || current === "ready", current, event);
      return "publishing";

    case "publish_success":
      assert(current === "publishing", current, event);
      return "published";

    case "publish_fail":
      assert(current === "publishing", current, event);
      return "publish_failed";

    default: {
      const _exhaustive: never = event;
      void _exhaustive;
      throw new Error(`Unknown event: ${String(event)}`);
    }
  }
}

function assert(ok: boolean, current: CreatorPostStatus, event: TransitionEvent) {
  if (!ok) throw invalid(current, event);
}

function invalid(current: CreatorPostStatus, event: TransitionEvent): Error {
  const err = new Error(`Invalid transition: ${current} -× ${event}`);
  (err as Error & { code?: string }).code = "INVALID_TRANSITION";
  return err;
}

// ─── Apply a transition (DB write) ─────────────────────────────────────────

export interface ApplyTransitionArgs {
  postId: string;
  companyId: string;
  current: CreatorPostStatus;
  event: TransitionEvent;
  rejectionFeedback?: string;
  /**
   * Pass the in-flight transaction client when applying as part of a larger
   * write — otherwise the UPDATE won't see uncommitted INSERTs.
   */
  client?: Queryable;
}

/**
 * Compute the next status, write it to DB, return updated row.
 * Wrapped here so callers don't have to coordinate the pure function with the repo.
 */
export async function applyTransition(
  args: ApplyTransitionArgs,
): Promise<{ post: CreatorPostRow; description: string }> {
  const target = nextStatus(args.current, args.event);
  const description = describe(args.current, target, args.event);

  const post = await updatePostStatus(args.client, {
    id: args.postId,
    companyId: args.companyId,
    status: target,
    rejectionFeedback:
      args.event === "reject" ? args.rejectionFeedback ?? null : null,
    incrementRevision: args.event === "reject",
  });

  return { post, description };
}

function describe(
  from: CreatorPostStatus,
  to: CreatorPostStatus,
  event: TransitionEvent,
): string {
  return `${event}: ${from} → ${to}`;
}
