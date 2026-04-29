import type { SessionType } from "@agentes/shared";
import { exec, many, one, oneOrThrow, type Queryable } from "../client.js";
import type { ChatSessionRow } from "./chat.js";

export async function createSession(
  q: Queryable | undefined,
  args: {
    companyId: string;
    userId: string;
    agentSlug: string;
    sessionType: SessionType;
    title?: string;
  },
): Promise<ChatSessionRow> {
  return oneOrThrow<ChatSessionRow>(
    q,
    `INSERT INTO public.chat_sessions
       (company_id, user_id, agent_slug, session_type, title)
     VALUES ($1, $2, $3, $4::public.session_type, $5)
     RETURNING *`,
    [
      args.companyId,
      args.userId,
      args.agentSlug,
      args.sessionType,
      args.title ?? null,
    ],
  );
}

export async function getSession(
  q: Queryable | undefined,
  id: string,
  companyId: string,
): Promise<ChatSessionRow | null> {
  return one<ChatSessionRow>(
    q,
    `SELECT * FROM public.chat_sessions WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
}

export async function listSessions(
  q: Queryable | undefined,
  args: {
    companyId: string;
    agentSlug?: string;
    limit?: number;
    includeArchived?: boolean;
  },
): Promise<ChatSessionRow[]> {
  const conds: string[] = [`company_id = $1`];
  const vals: unknown[] = [args.companyId];
  if (args.agentSlug) {
    conds.push(`agent_slug = $${vals.length + 1}`);
    vals.push(args.agentSlug);
  }
  if (!args.includeArchived) {
    conds.push(`archived_at IS NULL`);
  }
  // BrandBot onboarding sessions are filtered out from regular listing —
  // they're internal to the onboarding flow.
  conds.push(`session_type <> 'onboarding'`);

  vals.push(args.limit ?? 50);
  return many<ChatSessionRow>(
    q,
    `SELECT * FROM public.chat_sessions
      WHERE ${conds.join(" AND ")}
      ORDER BY updated_at DESC
      LIMIT $${vals.length}`,
    vals as never,
  );
}

export async function updateSessionTitle(
  q: Queryable | undefined,
  id: string,
  title: string,
): Promise<void> {
  await exec(
    q,
    `UPDATE public.chat_sessions SET title = $2, updated_at = now() WHERE id = $1`,
    [id, title],
  );
}

export async function archiveSession(
  q: Queryable | undefined,
  id: string,
  companyId: string,
): Promise<void> {
  await exec(
    q,
    `UPDATE public.chat_sessions SET archived_at = now() WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
}

export async function deleteSession(
  q: Queryable | undefined,
  id: string,
  companyId: string,
): Promise<void> {
  await exec(
    q,
    `DELETE FROM public.chat_sessions WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
}
