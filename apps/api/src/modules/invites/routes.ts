/**
 * Invite routes.
 *
 * Two surfaces:
 *
 *   /api/companies/me/invites  (owner-only, scoped to the active company)
 *     POST   create  → returns the once-only URL
 *     GET    list    → all invites for the company (any status)
 *     DELETE :id     → revoke a pending invite
 *
 *   /api/invites/:token  (auth required — invitee must be signed in)
 *     GET            → preview invite details (company name, role, expiry)
 *     POST :accept   → join the company
 *
 * Email match is enforced at accept time: signed-in user's email must match
 * the email the invite was issued to (case-insensitive). Otherwise we'd be
 * a free credentials-elevation tool.
 */

import { Hono } from "hono";
import { z } from "zod";
import { tx } from "../../db/client.js";
import {
  createOrReplaceInvite,
  findInviteByToken,
  getInviteById,
  listInvitesForCompany,
  markInviteAccepted,
  revokeInvite,
  type CompanyMemberRole,
} from "../../db/repositories/invites.js";
import { logger } from "../../lib/logger.js";
import { loadEnv } from "../../env.js";
import type { AuthContext } from "../../middleware/auth.js";
import type { CompanyContext } from "../../middleware/company.js";
import { requireOwner } from "../../middleware/company.js";

// ─── Owner-only company-invite routes ─────────────────────────────────────
//
// Mounted at /api/companies/me/invites. Caller already passes through
// requireAuth + resolveCompany, so c.var.auth + c.var.company are set.
export const ownerInviteRoutes = new Hono<{
  Variables: { auth: AuthContext; company: CompanyContext };
}>();

const createInviteSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(["admin", "member"]).default("member"),
});

ownerInviteRoutes.use("*", requireOwner);

// ─── POST /api/companies/me/invites ───────────────────────────────────────
ownerInviteRoutes.post("/", async (c) => {
  const env = loadEnv();
  const body = createInviteSchema.parse(await c.req.json());

  const { invite, rawToken } = await createOrReplaceInvite(undefined, {
    companyId: c.var.company.companyId,
    email: body.email,
    role: body.role as CompanyMemberRole,
    invitedBy: c.var.auth.userId,
  });

  const url = `${env.WEB_PUBLIC_URL}/invite/${rawToken}`;
  logger.info(
    { companyId: invite.company_id, email: invite.email, role: invite.role },
    "invite created",
  );

  return c.json({
    invite: {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      status: invite.status,
      expires_at: invite.expires_at,
      created_at: invite.created_at,
    },
    /**
     * Token is only ever returned in this response. After this, the URL
     * lives only in the invitee's email/clipboard — the DB has only the hash.
     */
    invite_url: url,
  });
});

// ─── GET /api/companies/me/invites ────────────────────────────────────────
ownerInviteRoutes.get("/", async (c) => {
  const rows = await listInvitesForCompany(undefined, c.var.company.companyId);
  return c.json({
    invites: rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      status: r.status,
      expires_at: r.expires_at,
      accepted_at: r.accepted_at,
      created_at: r.created_at,
    })),
  });
});

// ─── DELETE /api/companies/me/invites/:id ─────────────────────────────────
ownerInviteRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await getInviteById(undefined, id, c.var.company.companyId);
  if (!existing) return c.json({ error: "not_found" }, 404);
  await revokeInvite(undefined, id, c.var.company.companyId);
  return c.json({ ok: true });
});

// ─── Authed (invitee) invite routes ───────────────────────────────────────
//
// Mounted at /api/invites. requireAuth has run; resolveCompany has not (we
// don't want it 403-ing the user before they've joined this company).
export const inviteRoutes = new Hono<{
  Variables: { auth: AuthContext };
}>();

// ─── GET /api/invites/:token ──────────────────────────────────────────────
// Returns invite details for the preview screen on /invite/:token.
// Does NOT require email match — we want the user to know what they'd be
// accepting before signing in. Token alone is enough to read.
inviteRoutes.get("/:token", async (c) => {
  const token = c.req.param("token");
  const invite = await findInviteByToken(undefined, token);
  if (!invite) return c.json({ error: "not_found" }, 404);

  const expired = new Date(invite.expires_at).getTime() < Date.now();
  const status = expired && invite.status === "pending" ? "expired" : invite.status;

  // Resolve company name in the same query for nicer UX
  const { one } = await import("../../db/client.js");
  const co = await one<{ name: string }>(
    undefined,
    `SELECT name FROM public.companies WHERE id = $1`,
    [invite.company_id],
  );

  return c.json({
    email: invite.email,
    role: invite.role,
    status,
    company_name: co?.name ?? null,
    expires_at: invite.expires_at,
  });
});

// ─── POST /api/invites/:token/accept ──────────────────────────────────────
inviteRoutes.post("/:token/accept", async (c) => {
  const token = c.req.param("token");
  const auth = c.var.auth;
  const userEmail = auth.email?.toLowerCase().trim() ?? "";

  const invite = await findInviteByToken(undefined, token);
  if (!invite) return c.json({ error: "not_found" }, 404);

  if (invite.status !== "pending") {
    return c.json({ error: "invalid_state", status: invite.status }, 409);
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return c.json({ error: "expired" }, 410);
  }
  if (invite.email.toLowerCase() !== userEmail) {
    return c.json(
      {
        error: "email_mismatch",
        message:
          "Este convite foi emitido para outro email. Faça login com o endereço correto.",
      },
      403,
    );
  }

  // Apply: insert company_members + mark invite accepted, atomically.
  // ON CONFLICT no-op covers the "user is already a member" case.
  await tx(async (client) => {
    await client.query(
      `INSERT INTO public.company_members (company_id, user_id, role)
       VALUES ($1, $2, $3::public.company_member_role)
       ON CONFLICT (company_id, user_id) DO UPDATE
         SET role = EXCLUDED.role`,
      [invite.company_id, auth.userId, invite.role],
    );
    await markInviteAccepted(client, invite.id, auth.userId);
  });

  logger.info(
    { companyId: invite.company_id, userId: auth.userId, role: invite.role },
    "invite accepted",
  );

  return c.json({ ok: true, company_id: invite.company_id, role: invite.role });
});
