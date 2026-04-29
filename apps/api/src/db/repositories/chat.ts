import { exec, many, oneOrThrow, type Queryable } from "../client.js";

export interface ChatSessionRow {
  id: string;
  company_id: string;
  user_id: string;
  agent_slug: string;
  session_type: "onboarding" | "chat" | "insta_creator" | "youtube_creator" | "reels" | "copy" | "ad";
  title: string | null;
  metadata: Record<string, unknown>;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRow {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  tokens_used: { input?: number; output?: number };
  provider_model: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** Onboarding session is unique per (company, brand-bot) and lazy-created via SQL helper. */
export async function getOrCreateOnboardingSession(
  q: Queryable | undefined,
  companyId: string,
  userId: string,
): Promise<string> {
  const row = await oneOrThrow<{ id: string }>(
    q,
    `SELECT public.fn_get_or_create_onboarding_session($1::uuid, $2::uuid) AS id`,
    [companyId, userId],
  );
  return row.id;
}

export async function listMessages(
  q: Queryable | undefined,
  sessionId: string,
  limit = 100,
): Promise<ChatMessageRow[]> {
  return many<ChatMessageRow>(
    q,
    `SELECT * FROM public.chat_messages
       WHERE session_id = $1
       ORDER BY created_at ASC
       LIMIT $2`,
    [sessionId, limit],
  );
}

export async function appendMessage(
  q: Queryable | undefined,
  args: {
    sessionId: string;
    role: ChatMessageRow["role"];
    content: string;
    tokensUsed?: ChatMessageRow["tokens_used"];
    providerModel?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  const row = await oneOrThrow<{ id: string }>(
    q,
    `INSERT INTO public.chat_messages
       (session_id, role, content, tokens_used, provider_model, metadata)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb)
     RETURNING id`,
    [
      args.sessionId,
      args.role,
      args.content,
      JSON.stringify(args.tokensUsed ?? {}),
      args.providerModel ?? null,
      JSON.stringify(args.metadata ?? {}),
    ],
  );
  return row.id;
}

export async function touchSession(
  q: Queryable | undefined,
  sessionId: string,
): Promise<void> {
  await exec(
    q,
    `UPDATE public.chat_sessions SET updated_at = now() WHERE id = $1`,
    [sessionId],
  );
}
