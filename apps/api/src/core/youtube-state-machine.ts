/**
 * YouTube project state machine.
 *
 * Forward path:
 *   draft → transcribing → transcribed → ideation → ideation_review →
 *           generating_thumbs → thumbs_review → final_review → ready →
 *           scheduled → publishing → published
 *
 * Branches:
 *   any review        → previous editable state (rejection)
 *   transcribing      → failed (transcription error)
 *   generating_thumbs → failed (image gen error)
 *   publishing        → publish_failed
 *   any state         → rejected (kill switch)
 */

import type { Queryable } from "../db/client.js";
import type {
  YouTubeProjectRow,
  YouTubeProjectStatus,
} from "../db/repositories/youtube-projects.js";
import { updateStatus } from "../db/repositories/youtube-projects.js";

export type YouTubeEvent =
  | "start_transcribing"   // draft → transcribing
  | "transcribed"          // transcribing → transcribed
  | "transcribe_failed"    // transcribing → failed
  | "start_ideation"       // transcribed → ideation
  | "submit_ideation"      // ideation → ideation_review
  | "approve_ideation"     // ideation_review → generating_thumbs
  | "thumbs_done"          // generating_thumbs → thumbs_review
  | "thumbs_failed"        // generating_thumbs → failed
  | "approve_thumbs"       // thumbs_review → final_review
  | "approve_final"        // final_review → ready
  | "schedule"             // ready → scheduled
  | "publish_now"          // ready / scheduled / publish_failed → publishing
  | "publish_success"      // publishing → published
  | "publish_fail"         // publishing → publish_failed
  | "reject"               // any review → previous editable
  | "kill";                // any → rejected

export function nextStatus(
  current: YouTubeProjectStatus,
  event: YouTubeEvent,
): YouTubeProjectStatus {
  if (event === "kill") return "rejected";

  switch (event) {
    case "start_transcribing":
      assert(current === "draft", current, event);
      return "transcribing";
    case "transcribed":
      assert(current === "transcribing", current, event);
      return "transcribed";
    case "transcribe_failed":
      assert(current === "transcribing", current, event);
      return "failed";
    case "start_ideation":
      assert(current === "transcribed", current, event);
      return "ideation";
    case "submit_ideation":
      assert(current === "ideation", current, event);
      return "ideation_review";
    case "approve_ideation":
      assert(current === "ideation_review", current, event);
      return "generating_thumbs";
    case "thumbs_done":
      assert(current === "generating_thumbs", current, event);
      return "thumbs_review";
    case "thumbs_failed":
      assert(current === "generating_thumbs", current, event);
      return "failed";
    case "approve_thumbs":
      assert(current === "thumbs_review", current, event);
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
    case "publish_success":
      assert(current === "publishing", current, event);
      return "published";
    case "publish_fail":
      assert(current === "publishing", current, event);
      return "publish_failed";
    case "reject":
      // Each review goes back to its editable state
      switch (current) {
        case "ideation_review": return "transcribed";
        case "thumbs_review":   return "ideation_review";
        case "final_review":    return "thumbs_review";
        default: throw invalid(current, event);
      }
    default: {
      const _exhaustive: never = event;
      void _exhaustive;
      throw new Error(`Unknown event: ${String(event)}`);
    }
  }
}

function assert(ok: boolean, current: YouTubeProjectStatus, event: YouTubeEvent) {
  if (!ok) throw invalid(current, event);
}

function invalid(current: YouTubeProjectStatus, event: YouTubeEvent): Error {
  const err = new Error(`Invalid transition: ${current} -× ${event}`);
  (err as Error & { code?: string }).code = "INVALID_TRANSITION";
  return err;
}

export async function applyTransition(args: {
  projectId: string;
  companyId: string;
  current: YouTubeProjectStatus;
  event: YouTubeEvent;
  rejectionFeedback?: string;
  errorMessage?: string;
  client?: Queryable;
}): Promise<{ row: YouTubeProjectRow; description: string }> {
  const target = nextStatus(args.current, args.event);
  const description = `${args.event}: ${args.current} → ${target}`;
  const row = await updateStatus(args.client, {
    id: args.projectId,
    companyId: args.companyId,
    status: target,
    rejectionFeedback:
      args.event === "reject" ? args.rejectionFeedback ?? null : null,
    incrementRevision: args.event === "reject",
    error: args.errorMessage,
  });
  return { row, description };
}
