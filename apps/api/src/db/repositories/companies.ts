import type { OnboardingDraft } from "@agentes/shared";
import { exec, one, oneOrThrow, type Queryable } from "../client.js";

export interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  owner_user_id: string;
  plan: "free" | "pro";
  onboarding_completed: boolean;
  onboarding_draft: OnboardingDraft;
  posts_quota_remaining: number;
  reels_quota_remaining: number;
  youtube_projects_quota_remaining: number;
  chat_messages_quota_remaining: number;
  quota_resets_at: string;
  created_at: string;
  updated_at: string;
}

export async function getCompanyById(
  q: Queryable | undefined,
  id: string,
): Promise<CompanyRow | null> {
  return one<CompanyRow>(q, `SELECT * FROM public.companies WHERE id = $1`, [id]);
}

export async function getCompanyByIdOrThrow(
  q: Queryable | undefined,
  id: string,
): Promise<CompanyRow> {
  return oneOrThrow<CompanyRow>(q, `SELECT * FROM public.companies WHERE id = $1`, [id]);
}

export async function updateOnboardingDraft(
  q: Queryable | undefined,
  companyId: string,
  draft: OnboardingDraft,
): Promise<void> {
  await exec(
    q,
    `UPDATE public.companies
        SET onboarding_draft = $2,
            updated_at = now()
      WHERE id = $1`,
    [companyId, JSON.stringify(draft)],
  );
}

export async function markOnboardingCompleted(
  q: Queryable | undefined,
  companyId: string,
  brandName: string,
): Promise<void> {
  await exec(
    q,
    `UPDATE public.companies
        SET onboarding_completed = true,
            name = $2,
            updated_at = now()
      WHERE id = $1`,
    [companyId, brandName],
  );
}
