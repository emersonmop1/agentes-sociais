import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  consumeQuota,
  getQuotaSnapshot,
  refundQuota,
} from "../src/services/quota";
import { getPool, exec } from "../src/db/client";
import { createTestUser, type TestUser } from "./helpers";

describe("quota service", () => {
  let user: TestUser;

  beforeAll(async () => {
    user = await createTestUser();
  });

  afterAll(async () => {
    await user.cleanup();
  });

  it("returns snapshot with default quotas for a fresh company", async () => {
    const snap = await getQuotaSnapshot(undefined, user.companyId);
    expect(snap).not.toBeNull();
    expect(snap!.posts_quota_remaining).toBe(50);
    expect(snap!.reels_quota_remaining).toBe(10);
    expect(snap!.youtube_projects_quota_remaining).toBe(5);
    expect(snap!.chat_messages_quota_remaining).toBe(200);
    expect(snap!.plan).toBe("free");
  });

  it("decrements atomically and returns new remaining", async () => {
    const r1 = await consumeQuota(undefined, user.companyId, "posts");
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.remaining).toBe(49);

    const r2 = await consumeQuota(undefined, user.companyId, "posts");
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.remaining).toBe(48);
  });

  it("refunds restore the counter", async () => {
    await consumeQuota(undefined, user.companyId, "reels");
    const before = await getQuotaSnapshot(undefined, user.companyId);
    expect(before!.reels_quota_remaining).toBe(9);

    await refundQuota(undefined, user.companyId, "reels");
    const after = await getQuotaSnapshot(undefined, user.companyId);
    expect(after!.reels_quota_remaining).toBe(10);
  });

  it("returns quota_exceeded when remaining hits zero", async () => {
    // Force the youtube counter to 0 to avoid burning N consumes
    await exec(
      undefined,
      `UPDATE public.companies SET youtube_projects_quota_remaining = 0 WHERE id = $1`,
      [user.companyId],
    );

    const r = await consumeQuota(undefined, user.companyId, "youtube");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.json.error).toBe("quota_exceeded");
      expect(r.json.kind).toBe("youtube");
    }

    // Counter must NOT have gone negative
    const snap = await getQuotaSnapshot(undefined, user.companyId);
    expect(snap!.youtube_projects_quota_remaining).toBe(0);
  });

  it("each kind decrements its own column independently", async () => {
    // Reset to known values
    await exec(
      undefined,
      `UPDATE public.companies
          SET posts_quota_remaining = 50,
              reels_quota_remaining = 10,
              youtube_projects_quota_remaining = 5,
              chat_messages_quota_remaining = 200
        WHERE id = $1`,
      [user.companyId],
    );
    await consumeQuota(undefined, user.companyId, "chat");
    const snap = await getQuotaSnapshot(undefined, user.companyId);
    expect(snap!.posts_quota_remaining).toBe(50);
    expect(snap!.reels_quota_remaining).toBe(10);
    expect(snap!.youtube_projects_quota_remaining).toBe(5);
    expect(snap!.chat_messages_quota_remaining).toBe(199);
  });

  it("fn_reset_expired_quotas restores defaults when window has elapsed", async () => {
    const pool = getPool();
    // Burn quota and simulate the reset window having passed
    await pool.query(
      `UPDATE public.companies
          SET posts_quota_remaining = 1,
              reels_quota_remaining = 1,
              youtube_projects_quota_remaining = 1,
              chat_messages_quota_remaining = 1,
              quota_resets_at = now() - INTERVAL '1 day'
        WHERE id = $1`,
      [user.companyId],
    );

    // The reset fn updates ALL eligible companies. If other companies in the
    // DB are also expired, they'll be reset too — that's fine, we only
    // assert the row count is at least 1 (ours).
    const r = await pool.query<{ fn_reset_expired_quotas: number }>(
      `SELECT public.fn_reset_expired_quotas()`,
    );
    expect(r.rows[0]?.fn_reset_expired_quotas).toBeGreaterThanOrEqual(1);

    const snap = await getQuotaSnapshot(undefined, user.companyId);
    expect(snap!.posts_quota_remaining).toBe(50); // free-tier default
    expect(snap!.reels_quota_remaining).toBe(10);
    expect(snap!.youtube_projects_quota_remaining).toBe(5);
    expect(snap!.chat_messages_quota_remaining).toBe(200);
    // quota_resets_at advanced ~30 days
    expect(new Date(snap!.quota_resets_at).getTime()).toBeGreaterThan(Date.now());
  });
});
