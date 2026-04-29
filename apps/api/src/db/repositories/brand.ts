import { one, type Queryable } from "../client.js";

export interface BrandConfigRow {
  id: string;
  company_id: string;
  brand_name: string;
  niche: string | null;
  instagram_handle: string | null;
  tiktok_handle: string | null;
  youtube_channel: string | null;
  logo_url: string | null;
  avatar_url: string | null;
  badge_verified: boolean;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  background_color: string;
  text_color: string;
  font_family_heading: string;
  font_family_body: string;
  voice_tone: string[];
  voice_examples: string[];
  forbidden_terms: string[];
  signature_phrases: string[];
  icp_description: string | null;
  target_audience: { age?: string; pain?: string; gender?: string };
  default_visual_style: "tweet_thread" | "dark" | "acid_text" | "tweet_single";
  created_at: string;
  updated_at: string;
}

export async function getBrandConfig(
  q: Queryable | undefined,
  companyId: string,
): Promise<BrandConfigRow | null> {
  return one<BrandConfigRow>(
    q,
    `SELECT * FROM public.brand_configs WHERE company_id = $1`,
    [companyId],
  );
}
