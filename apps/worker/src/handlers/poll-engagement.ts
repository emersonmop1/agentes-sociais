/**
 * Engagement poller — refreshes performance_data on published carousels.
 *
 * Scope: posts where status='published', external_post_id IS NOT NULL, and
 * (performance_last_polled_at IS NULL OR last poll > 1 hour ago). Bounded to
 * 14 days post-publish; older posts stop polling automatically (engagement
 * tails off and we're cheap on Graph API quota).
 *
 * Strategy:
 *   • Each tick (called from the worker poll loop), pick up to BATCH posts
 *     ordered by performance_last_polled_at ASC NULLS FIRST.
 *   • For each, look up the company's IG token, call insights, update post.
 *   • On auth error → mark integration_token invalid + skip post (DON'T mark
 *     the post failed — it WAS published, just no insights now).
 *   • On other Graph errors → bump performance_last_polled_at anyway so we
 *     don't busy-loop on a permanently broken post. Persist the error in
 *     performance_data._last_error.
 *
 * No new tables — leverages idx_creator_posts_published from migration 0004.
 */

import type pg from "pg";
import { decryptString } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";
import {
  fetchMediaInsights,
  GraphAPIError,
  type MediaInsights,
} from "../services/instagram-graph.js";

interface PostRow {
  id: string;
  company_id: string;
  external_post_id: string;
  performance_data: Record<string, unknown>;
}

interface TokenRow {
  access_token_encrypted: string;
  invalid: boolean;
  metadata: { ig_user_id?: string } | null;
}

const BATCH = 5;
const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const FOCUS_WINDOW_DAYS = 14;

export async function pollEngagementTick(pool: pg.Pool): Promise<number> {
  // 1. Pick batch of stale posts within the focus window
  const r = await pool.query<PostRow>(
    `SELECT id, company_id, external_post_id, performance_data
       FROM public.creator_posts
      WHERE status = 'published'
        AND external_post_id IS NOT NULL
        AND published_at > now() - INTERVAL '${FOCUS_WINDOW_DAYS} days'
        AND (
          performance_last_polled_at IS NULL
          OR performance_last_polled_at < now() - INTERVAL '${POLL_INTERVAL_MS} milliseconds'
        )
      ORDER BY performance_last_polled_at ASC NULLS FIRST
      LIMIT $1`,
    [BATCH],
  );

  if (r.rows.length === 0) return 0;

  let polled = 0;
  for (const post of r.rows) {
    try {
      await pollOnePost(pool, post);
      polled += 1;
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, postId: post.id },
        "poll-engagement: post failed, marking polled to avoid busy-loop",
      );
      await pool.query(
        `UPDATE public.creator_posts
            SET performance_data = performance_data || $2::jsonb,
                performance_last_polled_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [
          post.id,
          JSON.stringify({
            _last_error: (err as Error).message.slice(0, 200),
            _last_error_at: new Date().toISOString(),
          }),
        ],
      );
    }
  }
  return polled;
}

async function pollOnePost(pool: pg.Pool, post: PostRow): Promise<void> {
  const tokR = await pool.query<TokenRow>(
    `SELECT access_token_encrypted, invalid, metadata
       FROM public.integration_tokens
      WHERE company_id = $1 AND provider = 'instagram_graph'`,
    [post.company_id],
  );
  const tk = tokR.rows[0];
  if (!tk) {
    throw new Error("instagram not connected");
  }
  if (tk.invalid) {
    throw new Error("instagram token marked invalid");
  }

  let pageAccessToken: string;
  try {
    pageAccessToken = decryptString(tk.access_token_encrypted);
  } catch (err) {
    throw new Error(`token decrypt failed: ${(err as Error).message}`);
  }

  let insights: MediaInsights;
  try {
    insights = await fetchMediaInsights({
      mediaId: post.external_post_id,
      pageAccessToken,
    });
  } catch (err) {
    if (err instanceof GraphAPIError && err.isAuthError) {
      // Mark the company's integration token as invalid; user must reconnect.
      await pool.query(
        `UPDATE public.integration_tokens
            SET invalid = true,
                invalid_reason = $2,
                refreshed_at = now()
          WHERE company_id = $1 AND provider = 'instagram_graph'`,
        [post.company_id, err.message.slice(0, 200)],
      );
    }
    throw err;
  }

  await pool.query(
    `UPDATE public.creator_posts
        SET performance_data = performance_data || $2::jsonb,
            performance_last_polled_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [post.id, JSON.stringify(insights)],
  );

  logger.info(
    {
      postId: post.id,
      mediaId: post.external_post_id,
      likes: insights.likes,
      reach: insights.reach,
    },
    "poll-engagement: refreshed",
  );
}
