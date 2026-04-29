import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authedFetch, createTestUser, publicFetch, type TestUser } from "./helpers";

describe("auth + identity", () => {
  let user: TestUser;

  beforeAll(async () => {
    user = await createTestUser();
  });

  afterAll(async () => {
    await user.cleanup();
  });

  it("rejects /api/me without bearer token", async () => {
    const r = await publicFetch("/api/me");
    expect(r.status).toBe(401);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("rejects /api/me with malformed bearer", async () => {
    const r = await publicFetch("/api/me", {
      headers: { Authorization: "Bearer not-a-jwt" },
    });
    expect(r.status).toBe(401);
  });

  it("returns user + company on /api/me with valid JWT", async () => {
    const r = await authedFetch(user, "/api/me");
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      user: { id: string; email: string };
      company: { id: string; role: string };
    };
    expect(body.user.id).toBe(user.userId);
    expect(body.user.email).toBe(user.email);
    expect(body.company.id).toBe(user.companyId);
    expect(body.company.role).toBe("owner"); // post-signup trigger sets owner
  });

  it("returns plan + quotas on /api/companies/me", async () => {
    const r = await authedFetch(user, "/api/companies/me");
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      id: string;
      plan: "free" | "pro";
      onboarding_completed: boolean;
      quotas: {
        posts_remaining: number;
        reels_remaining: number;
        youtube_remaining: number;
        chat_remaining: number;
        resets_at: string;
      };
    };
    expect(body.id).toBe(user.companyId);
    expect(body.plan).toBe("free");
    expect(body.onboarding_completed).toBe(false);
    // Defaults from migration 0001
    expect(body.quotas.posts_remaining).toBe(50);
    expect(body.quotas.reels_remaining).toBe(10);
    expect(body.quotas.youtube_remaining).toBe(5);
    expect(body.quotas.chat_remaining).toBe(200);
    expect(typeof body.quotas.resets_at).toBe("string");
  });
});
