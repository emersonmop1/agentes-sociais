import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authedFetch, createTestUser, type TestUser } from "./helpers";

describe("invites — happy path", () => {
  let owner: TestUser;
  let invitee: TestUser;
  let inviteUrl: string;
  let inviteId: string;

  beforeAll(async () => {
    owner = await createTestUser();
    invitee = await createTestUser();
  });

  afterAll(async () => {
    await Promise.allSettled([owner.cleanup(), invitee.cleanup()]);
  });

  it("owner can create an invite for the invitee's email", async () => {
    const r = await authedFetch(owner, "/api/companies/me/invites", {
      method: "POST",
      body: JSON.stringify({ email: invitee.email, role: "member" }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      invite: { id: string; email: string; role: string; status: string };
      invite_url: string;
    };
    expect(body.invite.email.toLowerCase()).toBe(invitee.email.toLowerCase());
    expect(body.invite.role).toBe("member");
    expect(body.invite.status).toBe("pending");
    expect(body.invite_url).toMatch(/\/invite\/[0-9a-f]{64}$/);
    inviteUrl = body.invite_url;
    inviteId = body.invite.id;
  });

  it("invite shows up in owner's list with status=pending", async () => {
    const r = await authedFetch(owner, "/api/companies/me/invites");
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      invites: Array<{ id: string; status: string; email: string }>;
    };
    const found = body.invites.find((i) => i.id === inviteId);
    expect(found).toBeDefined();
    expect(found!.status).toBe("pending");
  });

  it("invitee can preview the invite (auth not strictly required for preview, but we exercise auth path)", async () => {
    const token = inviteUrl.split("/invite/")[1]!;
    const r = await authedFetch(invitee, `/api/invites/${token}`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      email: string;
      role: string;
      status: string;
      company_name: string | null;
    };
    expect(body.email.toLowerCase()).toBe(invitee.email.toLowerCase());
    expect(body.role).toBe("member");
    expect(body.status).toBe("pending");
  });

  it("rejects accept when signed-in user's email != invite.email", async () => {
    const token = inviteUrl.split("/invite/")[1]!;
    // Owner's email doesn't match the invite (which targets invitee). Should 403.
    const r = await authedFetch(owner, `/api/invites/${token}/accept`, {
      method: "POST",
    });
    expect(r.status).toBe(403);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe("email_mismatch");
  });

  it("invitee can accept the invite and becomes a member", async () => {
    const token = inviteUrl.split("/invite/")[1]!;
    const r = await authedFetch(invitee, `/api/invites/${token}/accept`, {
      method: "POST",
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      ok: boolean;
      company_id: string;
      role: string;
    };
    expect(body.ok).toBe(true);
    expect(body.company_id).toBe(owner.companyId);
    expect(body.role).toBe("member");
  });

  it("re-accepting a now-accepted invite returns 409", async () => {
    const token = inviteUrl.split("/invite/")[1]!;
    const r = await authedFetch(invitee, `/api/invites/${token}/accept`, {
      method: "POST",
    });
    expect(r.status).toBe(409);
  });
});

describe("invites — role guard", () => {
  let owner: TestUser;

  beforeAll(async () => {
    owner = await createTestUser();
  });

  afterAll(async () => {
    await owner.cleanup();
  });

  it("returns 400 on invalid email", async () => {
    const r = await authedFetch(owner, "/api/companies/me/invites", {
      method: "POST",
      body: JSON.stringify({ email: "not-an-email", role: "member" }),
    });
    expect(r.status).toBe(400);
  });

  it("revoke a pending invite", async () => {
    // Create
    const created = await authedFetch(owner, "/api/companies/me/invites", {
      method: "POST",
      body: JSON.stringify({ email: "tovrevoke@example.com", role: "member" }),
    });
    const cBody = (await created.json()) as { invite: { id: string } };
    const id = cBody.invite.id;

    // Revoke
    const r = await authedFetch(owner, `/api/companies/me/invites/${id}`, {
      method: "DELETE",
    });
    expect(r.status).toBe(200);

    // Listing reflects revoked status
    const listR = await authedFetch(owner, "/api/companies/me/invites");
    const listBody = (await listR.json()) as {
      invites: Array<{ id: string; status: string }>;
    };
    const found = listBody.invites.find((i) => i.id === id);
    expect(found?.status).toBe("revoked");
  });

  it("revoke endpoint returns 404 for non-existent invite id", async () => {
    const r = await authedFetch(
      owner,
      "/api/companies/me/invites/00000000-0000-0000-0000-000000000000",
      { method: "DELETE" },
    );
    expect(r.status).toBe(404);
  });
});

describe("invites — owner-only enforcement", () => {
  let owner: TestUser;
  let other: TestUser;
  let inviteUrl: string;

  beforeAll(async () => {
    owner = await createTestUser();
    other = await createTestUser();

    // Owner invites `other` as a *member* (so other has a non-owner role in
    // owner's company), then `other` accepts. After this, `other` is a member
    // of owner's company and should NOT be able to create new invites because
    // the active company resolves to their OWN (owner role there) by default.
    // To exercise the role guard cleanly, we POST with X-Company-Id pointing
    // at owner's company — there `other` is a member.
    const c = await authedFetch(owner, "/api/companies/me/invites", {
      method: "POST",
      body: JSON.stringify({ email: other.email, role: "member" }),
    });
    const body = (await c.json()) as { invite_url: string };
    inviteUrl = body.invite_url;

    const token = inviteUrl.split("/invite/")[1]!;
    const accept = await authedFetch(other, `/api/invites/${token}/accept`, {
      method: "POST",
    });
    expect(accept.status).toBe(200);
  });

  afterAll(async () => {
    await Promise.allSettled([owner.cleanup(), other.cleanup()]);
  });

  it("non-owner member can't create an invite (403 from requireOwner)", async () => {
    const r = await authedFetch(other, "/api/companies/me/invites", {
      method: "POST",
      headers: { "X-Company-Id": owner.companyId },
      body: JSON.stringify({ email: "x@example.com", role: "member" }),
    });
    expect(r.status).toBe(403);
    const body = (await r.json()) as { error: string; current_role: string };
    expect(body.error).toBe("forbidden");
    expect(body.current_role).toBe("member");
  });

  it("non-owner member can't list invites either", async () => {
    const r = await authedFetch(other, "/api/companies/me/invites", {
      headers: { "X-Company-Id": owner.companyId },
    });
    expect(r.status).toBe(403);
  });
});
