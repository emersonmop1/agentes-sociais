export type CompanyPlan = "free" | "pro";
export type CompanyMemberRole = "owner" | "admin" | "member";

export interface Company {
  id: string;
  name: string;
  slug: string;
  owner_user_id: string;
  plan: CompanyPlan;
  onboarding_completed: boolean;
  onboarding_draft: Record<string, unknown>;
  posts_quota_remaining: number;
  youtube_projects_quota_remaining: number;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  default_company_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyMember {
  company_id: string;
  user_id: string;
  role: CompanyMemberRole;
  joined_at: string;
}
