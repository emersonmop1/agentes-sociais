/**
 * company_invites repository.
 *
 * Tokens never live in the DB in plaintext — we store sha256(token) and
 * compare hashes on accept. The raw token is only returned once at create
 * time (the response carries the URL-friendly form).
 */

import { createHash, randomBytes } from "node:crypto";
import { exec, many, one, oneOrThrow, type Queryable } from "../client.js";

export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";
export type CompanyMemberRole = "owner" | "admin" | "member";

export interface CompanyInviteRow {
  id: string;
  company_id: string;
  email: string;
  role: CompanyMemberRole;
  token_hash: string;
  invited_by: string;
  status: InviteStatus;
  expires_at: string;
  accepted_by: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

export function generateInviteToken(): { token: string; tokenHash: string } {
  // 32 bytes → 64 hex chars. URL-safe and high-entropy enough for invite use.
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  return { token, tokenHash };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CreateInviteArgs {
  companyId: string;
  email: string;
  role: CompanyMemberRole;
  invitedBy: string;
  /** TTL in milliseconds. Default 7 days. */
  ttlMs?: number;
}

/**
 * Upsert by (company_id, lower(email)) WHERE status='pending'. If a pending
 * invite already exists for this email, replace it with the new token and
 * extend the expiry. This is idempotent from the user's POV — re-sending
 * the invite from the UI just refreshes the URL.
 */
export async function createOrReplaceInvite(
  q: Queryable | undefined,
  args: CreateInviteArgs,
): Promise<{ invite: CompanyInviteRow; rawToken: string }> {
  const { token, tokenHash } = generateInviteToken();
  const ttl = args.ttlMs ?? 7 * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttl);

  // Revoke any pre-existing pending invite for this (company, email) so the
  // partial-unique index doesn't conflict, then insert fresh.
  await exec(
    q,
    `UPDATE public.company_invites
        SET status = 'revoked'::public.company_invite_status,
            updated_at = now()
      WHERE company_id = $1
        AND lower(email) = lower($2)
        AND status = 'pending'`,
    [args.companyId, args.email],
  );

  const invite = await oneOrThrow<CompanyInviteRow>(
    q,
    `INSERT INTO public.company_invites
       (company_id, email, role, token_hash, invited_by, expires_at)
     VALUES ($1, $2::citext, $3::public.company_member_role, $4, $5, $6)
     RETURNING *`,
    [args.companyId, args.email, args.role, tokenHash, args.invitedBy, expiresAt],
  );

  return { invite, rawToken: token };
}

export async function listInvitesForCompany(
  q: Queryable | undefined,
  companyId: string,
): Promise<CompanyInviteRow[]> {
  return many<CompanyInviteRow>(
    q,
    `SELECT * FROM public.company_invites
      WHERE company_id = $1
      ORDER BY created_at DESC
      LIMIT 100`,
    [companyId],
  );
}

export async function getInviteById(
  q: Queryable | undefined,
  inviteId: string,
  companyId: string,
): Promise<CompanyInviteRow | null> {
  return one<CompanyInviteRow>(
    q,
    `SELECT * FROM public.company_invites
      WHERE id = $1 AND company_id = $2`,
    [inviteId, companyId],
  );
}

export async function revokeInvite(
  q: Queryable | undefined,
  inviteId: string,
  companyId: string,
): Promise<void> {
  await exec(
    q,
    `UPDATE public.company_invites
        SET status = 'revoked'::public.company_invite_status,
            updated_at = now()
      WHERE id = $1 AND company_id = $2 AND status = 'pending'`,
    [inviteId, companyId],
  );
}

export async function findInviteByToken(
  q: Queryable | undefined,
  token: string,
): Promise<CompanyInviteRow | null> {
  return one<CompanyInviteRow>(
    q,
    `SELECT * FROM public.company_invites WHERE token_hash = $1`,
    [hashToken(token)],
  );
}

export async function markInviteAccepted(
  q: Queryable | undefined,
  inviteId: string,
  acceptedBy: string,
): Promise<void> {
  await exec(
    q,
    `UPDATE public.company_invites
        SET status = 'accepted'::public.company_invite_status,
            accepted_by = $2,
            accepted_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [inviteId, acceptedBy],
  );
}
