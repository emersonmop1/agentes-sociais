import { exec, many, one, oneOrThrow, type Queryable } from "../client.js";

export type MemoryType = "correction" | "knowledge" | "pattern" | "preference";
export type MemorySource =
  | "user_correction"
  | "user_explicit"
  | "agent_extracted"
  | "manual"
  | "user_feedback";

export interface MemoryRow {
  id: string;
  company_id: string;
  agent_slug: string;
  content: string;
  context: string | null;
  category: string | null;
  memory_type: MemoryType;
  source: MemorySource;
  priority: number;
  search_text: string;
  times_used: number;
  last_used_at: string | null;
  is_active: boolean;
  session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecallParams {
  companyId: string;
  agentSlug: string;
  keywords: string[];
  limit?: number;
}

/**
 * RECALL: keyword-based ILIKE on search_text (gin_trgm_ops indexed).
 * Returns memories ordered by (priority DESC, times_used DESC) up to limit.
 *
 * Behavior matches clubhub §7.2:
 *   • If no keywords: fallback to top-N high-priority (>=8) memories.
 *   • Otherwise: any keyword match (OR) → priority/times_used sort.
 *   • Always ensure at least 3 corrections of high priority appear, padded
 *     in by a separate query if needed.
 */
export async function recall(
  q: Queryable | undefined,
  params: RecallParams,
): Promise<MemoryRow[]> {
  const limit = params.limit ?? 10;

  if (params.keywords.length === 0) {
    return many<MemoryRow>(
      q,
      `SELECT * FROM public.agent_memories
        WHERE company_id = $1 AND agent_slug = $2 AND is_active = true
          AND priority >= 8
        ORDER BY priority DESC, times_used DESC
        LIMIT $3`,
      [params.companyId, params.agentSlug, limit],
    );
  }

  // OR-match across keywords. ILIKE pattern with % around each keyword.
  const conditions = params.keywords
    .map((_, i) => `search_text ILIKE $${i + 4}`)
    .join(" OR ");
  const values = [
    params.companyId,
    params.agentSlug,
    limit,
    ...params.keywords.map((k) => `%${k}%`),
  ];
  const matches = await many<MemoryRow>(
    q,
    `SELECT * FROM public.agent_memories
      WHERE company_id = $1 AND agent_slug = $2 AND is_active = true
        AND (${conditions})
      ORDER BY priority DESC, times_used DESC
      LIMIT $3`,
    values,
  );

  // Top-up: ensure we have at least 3 high-priority corrections in the result
  const correctionsInMatches = matches.filter(
    (m) => m.memory_type === "correction" && m.priority >= 8,
  ).length;
  if (correctionsInMatches < 3) {
    const need = 3 - correctionsInMatches;
    const haveIds = matches.map((m) => m.id);
    const padQuery = haveIds.length === 0
      ? `SELECT * FROM public.agent_memories
          WHERE company_id = $1 AND agent_slug = $2 AND is_active = true
            AND memory_type = 'correction' AND priority >= 8
          ORDER BY priority DESC, times_used DESC
          LIMIT $3`
      : `SELECT * FROM public.agent_memories
          WHERE company_id = $1 AND agent_slug = $2 AND is_active = true
            AND memory_type = 'correction' AND priority >= 8
            AND id <> ALL($4::uuid[])
          ORDER BY priority DESC, times_used DESC
          LIMIT $3`;
    const padValues = haveIds.length === 0
      ? [params.companyId, params.agentSlug, need]
      : [params.companyId, params.agentSlug, need, haveIds];
    const pad = await many<MemoryRow>(q, padQuery, padValues);
    return [...matches, ...pad].slice(0, limit);
  }

  return matches;
}

/** Find an existing memory whose search_text contains all of the first 5 keywords. */
export async function findSimilar(
  q: Queryable | undefined,
  params: { companyId: string; agentSlug: string; keywords: string[] },
): Promise<MemoryRow | null> {
  const head = params.keywords.slice(0, 5);
  if (head.length === 0) return null;
  const conditions = head.map((_, i) => `search_text ILIKE $${i + 3}`).join(" AND ");
  const values = [params.companyId, params.agentSlug, ...head.map((k) => `%${k}%`)];
  return one<MemoryRow>(
    q,
    `SELECT * FROM public.agent_memories
      WHERE company_id = $1 AND agent_slug = $2 AND is_active = true
        AND (${conditions})
      ORDER BY priority DESC
      LIMIT 1`,
    values,
  );
}

export interface UpsertMemoryArgs {
  companyId: string;
  agentSlug: string;
  content: string;
  context?: string | null;
  category?: string | null;
  memoryType?: MemoryType;
  source?: MemorySource;
  priority?: number;
  searchText: string;
  sessionId?: string | null;
}

/** Insert a fresh memory. */
export async function insertMemory(
  q: Queryable | undefined,
  args: UpsertMemoryArgs,
): Promise<MemoryRow> {
  return oneOrThrow<MemoryRow>(
    q,
    `INSERT INTO public.agent_memories
       (company_id, agent_slug, content, context, category,
        memory_type, source, priority, search_text, session_id)
     VALUES ($1, $2, $3, $4, $5, $6::public.memory_type, $7::public.memory_source, $8, $9, $10)
     RETURNING *`,
    [
      args.companyId,
      args.agentSlug,
      args.content,
      args.context ?? null,
      args.category ?? null,
      args.memoryType ?? "knowledge",
      args.source ?? "user_correction",
      Math.max(1, Math.min(10, args.priority ?? 5)),
      args.searchText,
      args.sessionId ?? null,
    ],
  );
}

/** Update an existing memory (used by store() when a similar one is found). */
export async function updateMemory(
  q: Queryable | undefined,
  args: {
    id: string;
    content?: string;
    priority?: number;
    searchText?: string;
  },
): Promise<MemoryRow> {
  return oneOrThrow<MemoryRow>(
    q,
    `UPDATE public.agent_memories
        SET content = COALESCE($2, content),
            priority = COALESCE($3, priority),
            search_text = COALESCE($4, search_text),
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [args.id, args.content ?? null, args.priority ?? null, args.searchText ?? null],
  );
}

/** Increment times_used + last_used_at; auto-boost priority every 5 uses. */
export async function markUsed(
  q: Queryable | undefined,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  await exec(
    q,
    `UPDATE public.agent_memories
        SET times_used = times_used + 1,
            last_used_at = now(),
            priority = CASE
              WHEN ((times_used + 1) % 5 = 0) AND priority < 10 THEN priority + 1
              ELSE priority
            END,
            updated_at = now()
      WHERE id = ANY($1::uuid[])`,
    [ids],
  );
}

export interface ListMemoriesParams {
  companyId: string;
  agentSlug: string;
  type?: MemoryType;
  category?: string;
  active?: boolean;
  limit?: number;
}

export async function listMemories(
  q: Queryable | undefined,
  params: ListMemoriesParams,
): Promise<MemoryRow[]> {
  const conditions: string[] = [`company_id = $1`, `agent_slug = $2`];
  const values: unknown[] = [params.companyId, params.agentSlug];

  if (params.active !== undefined) {
    conditions.push(`is_active = $${values.length + 1}`);
    values.push(params.active);
  }
  if (params.type) {
    conditions.push(`memory_type = $${values.length + 1}::public.memory_type`);
    values.push(params.type);
  }
  if (params.category) {
    conditions.push(`category = $${values.length + 1}`);
    values.push(params.category);
  }

  const limit = params.limit ?? 200;
  values.push(limit);

  return many<MemoryRow>(
    q,
    `SELECT * FROM public.agent_memories
      WHERE ${conditions.join(" AND ")}
      ORDER BY priority DESC, updated_at DESC
      LIMIT $${values.length}`,
    values as never,
  );
}

export async function toggleActive(
  q: Queryable | undefined,
  id: string,
): Promise<MemoryRow> {
  return oneOrThrow<MemoryRow>(
    q,
    `UPDATE public.agent_memories
        SET is_active = NOT is_active, updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [id],
  );
}

export async function deleteMemory(
  q: Queryable | undefined,
  id: string,
): Promise<void> {
  await exec(q, `DELETE FROM public.agent_memories WHERE id = $1`, [id]);
}
