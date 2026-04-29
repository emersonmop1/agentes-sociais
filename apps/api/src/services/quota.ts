/**
 * Quota service.
 *
 * Wraps `fn_decrement_quota(company_id, kind)` and turns the SQL contract into
 * something route handlers can consume directly:
 *
 *   const r = await consumeQuota(undefined, companyId, "posts");
 *   if (!r.ok) return c.json(r.json, 429);
 *
 * The DB function is atomic — it only decrements when remaining > 0 and uses a
 * single UPDATE … WHERE … RETURNING, so concurrent callers can't race past 0.
 *
 * "kind" mapping:
 *   posts   → posts_quota_remaining     (insta carousels)
 *   reels   → reels_quota_remaining     (reels scripts)
 *   youtube → youtube_projects_quota_remaining
 *   chat    → chat_messages_quota_remaining
 */

import { one, type Queryable } from "../db/client.js";

export type QuotaKind = "posts" | "reels" | "youtube" | "chat";

export interface QuotaExceeded {
  ok: false;
  json: {
    error: "quota_exceeded";
    kind: QuotaKind;
    message: string;
  };
}

export interface QuotaConsumed {
  ok: true;
  remaining: number;
}

const KIND_LABEL: Record<QuotaKind, string> = {
  posts: "carrosséis Instagram",
  reels: "Reels",
  youtube: "vídeos YouTube",
  chat: "mensagens de chat",
};

export async function consumeQuota(
  q: Queryable | undefined,
  companyId: string,
  kind: QuotaKind,
): Promise<QuotaConsumed | QuotaExceeded> {
  const row = await one<{ remaining: number | null }>(
    q,
    `SELECT public.fn_decrement_quota($1::uuid, $2::text) AS remaining`,
    [companyId, kind],
  );
  if (!row || row.remaining === null) {
    return {
      ok: false,
      json: {
        error: "quota_exceeded",
        kind,
        message: `Quota mensal de ${KIND_LABEL[kind]} esgotada. Renova automaticamente no próximo ciclo.`,
      },
    };
  }
  return { ok: true, remaining: row.remaining };
}

/**
 * Refund a previously consumed quota point. Used when a creation path
 * decrements eagerly but then fails downstream — we don't want that wasted
 * count to count against the user.
 *
 * Increments without checking — if the refund pushes past the original cap
 * that's fine (next reset will normalize it back to plan default).
 */
export async function refundQuota(
  q: Queryable | undefined,
  companyId: string,
  kind: QuotaKind,
): Promise<void> {
  const column =
    kind === "posts"
      ? "posts_quota_remaining"
      : kind === "reels"
        ? "reels_quota_remaining"
        : kind === "youtube"
          ? "youtube_projects_quota_remaining"
          : "chat_messages_quota_remaining";
  await one(
    q,
    `UPDATE public.companies
        SET ${column} = ${column} + 1, updated_at = now()
      WHERE id = $1
      RETURNING id`,
    [companyId],
  );
}

export interface QuotaSnapshot {
  posts_quota_remaining: number;
  reels_quota_remaining: number;
  youtube_projects_quota_remaining: number;
  chat_messages_quota_remaining: number;
  quota_resets_at: string;
  plan: "free" | "pro";
}

export async function getQuotaSnapshot(
  q: Queryable | undefined,
  companyId: string,
): Promise<QuotaSnapshot | null> {
  return one<QuotaSnapshot>(
    q,
    `SELECT posts_quota_remaining,
            reels_quota_remaining,
            youtube_projects_quota_remaining,
            chat_messages_quota_remaining,
            quota_resets_at,
            plan
       FROM public.companies
      WHERE id = $1`,
    [companyId],
  );
}
