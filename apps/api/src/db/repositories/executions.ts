import { exec, type Queryable } from "../client.js";

export interface RecordExecutionArgs {
  companyId: string;
  agentSlug: string;
  sessionId?: string | null;
  trigger: "chat" | "chat_stream" | "cron" | "pipeline_step" | "feedback";
  provider?: string;
  model?: string;
  tokensInput?: number;
  tokensOutput?: number;
  latencyMs?: number;
  status?: "ok" | "error";
  errorMessage?: string;
  memoriesRecalled?: number;
  memoriesStored?: number;
  metadata?: Record<string, unknown>;
}

/** Fire-and-forget audit log. Failures here must NOT break the chat. */
export async function recordExecution(
  q: Queryable | undefined,
  args: RecordExecutionArgs,
): Promise<void> {
  try {
    await exec(
      q,
      `INSERT INTO public.agent_executions
         (company_id, agent_slug, session_id, trigger,
          provider, model, tokens_input, tokens_output, latency_ms,
          status, error_message, memories_recalled, memories_stored, metadata)
       VALUES ($1, $2, $3, $4,
               $5, $6, $7, $8, $9,
               $10, $11, $12, $13, $14::jsonb)`,
      [
        args.companyId,
        args.agentSlug,
        args.sessionId ?? null,
        args.trigger,
        args.provider ?? null,
        args.model ?? null,
        args.tokensInput ?? null,
        args.tokensOutput ?? null,
        args.latencyMs ?? null,
        args.status ?? "ok",
        args.errorMessage ?? null,
        args.memoriesRecalled ?? 0,
        args.memoriesStored ?? 0,
        JSON.stringify(args.metadata ?? {}),
      ],
    );
  } catch {
    // intentionally swallow; never break the chat path because of audit
  }
}
