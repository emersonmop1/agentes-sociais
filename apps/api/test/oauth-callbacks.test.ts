import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env";
import { publicFetch } from "./helpers";

/**
 * Public OAuth callback routes — no auth, redirect-based flows. They run on
 * the public router because Facebook/Google won't carry our JWT. We assert:
 *   • Missing code/state → redirect to web with error reason
 *   • Provider error param → redirect with error reason passed through
 *   • State mismatch → redirect with state_mismatch
 */
describe("/api/integrations callbacks — Google/YouTube", () => {
  const env = loadEnv();

  it("redirects with missing_code_or_state when params absent", async () => {
    const r = await publicFetch("/api/integrations/google/callback", {
      redirect: "manual",
    });
    expect(r.status).toBe(302);
    const loc = r.headers.get("location")!;
    expect(loc).toContain(`${env.WEB_PUBLIC_URL}/agents/youtube-growth`);
    expect(loc).toContain("google_connect=error");
    expect(loc).toContain("reason=missing_code_or_state");
  });

  it("passes provider error param through", async () => {
    const r = await publicFetch(
      "/api/integrations/google/callback?error=access_denied",
      { redirect: "manual" },
    );
    expect(r.status).toBe(302);
    const loc = r.headers.get("location")!;
    expect(loc).toContain("google_connect=error");
    expect(loc).toContain("reason=access_denied");
  });

  it("returns state_mismatch when cookie != query state", async () => {
    const r = await publicFetch(
      "/api/integrations/google/callback?code=fake&state=nostate",
      { redirect: "manual" },
    );
    expect(r.status).toBe(302);
    const loc = r.headers.get("location")!;
    expect(loc).toContain("google_connect=error");
    expect(loc).toContain("reason=state_mismatch");
  });
});

describe("/api/integrations callbacks — Instagram", () => {
  const env = loadEnv();

  it("redirects to insta-creator workspace with missing_code_or_state", async () => {
    const r = await publicFetch("/api/integrations/instagram/callback", {
      redirect: "manual",
    });
    expect(r.status).toBe(302);
    const loc = r.headers.get("location")!;
    expect(loc).toContain(`${env.WEB_PUBLIC_URL}/agents/insta-creator`);
    expect(loc).toContain("ig_connect=error");
    expect(loc).toContain("reason=missing_code_or_state");
  });

  it("passes provider error param through", async () => {
    const r = await publicFetch(
      "/api/integrations/instagram/callback?error=user_cancelled&error_description=user%20cancelled",
      { redirect: "manual" },
    );
    expect(r.status).toBe(302);
    const loc = r.headers.get("location")!;
    expect(loc).toContain("ig_connect=error");
  });
});

describe("public health endpoint", () => {
  it("returns ok + db: true", async () => {
    const r = await publicFetch("/api/health");
    expect(r.status).toBe(200);
    const body = (await r.json()) as { status: string; db: boolean; version: string };
    expect(body.status).toBe("ok");
    expect(body.db).toBe(true);
    expect(body.version).toBeDefined();
  });
});
