import { z } from "zod";

export const hexColorSchema = z
  .string()
  .regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/, "must be hex color");

export const visualStyleSchema = z.enum([
  "tweet_thread",
  "dark",
  "acid_text",
  "tweet_single",
]);
export type VisualStyle = z.infer<typeof visualStyleSchema>;

/**
 * BrandBot fills this draft incrementally as the user chats.
 * Persisted in companies.onboarding_draft (JSONB).
 */
export const onboardingDraftSchema = z
  .object({
    brand_name: z.string().nullable().optional(),
    niche: z.string().nullable().optional(),
    voice_tone: z.array(z.string()).default([]),
    voice_examples: z.array(z.string()).default([]),
    icp_description: z.string().nullable().optional(),
    target_audience: z
      .object({
        age: z.string().nullable().optional(),
        gender: z.string().nullable().optional(),
        pain: z.string().nullable().optional(),
      })
      .partial()
      .optional(),
    logo_url: z.string().url().nullable().optional(),
    avatar_url: z.string().url().nullable().optional(),
    primary_color: hexColorSchema.nullable().optional(),
    secondary_color: hexColorSchema.nullable().optional(),
    accent_color: hexColorSchema.nullable().optional(),
    instagram_handle: z.string().nullable().optional(),
    youtube_channel: z.string().nullable().optional(),
    tiktok_handle: z.string().nullable().optional(),
    forbidden_terms: z.array(z.string()).default([]),
    signature_phrases: z.array(z.string()).default([]),
    default_visual_style: visualStyleSchema.default("tweet_thread"),
  })
  .partial();
export type OnboardingDraft = z.infer<typeof onboardingDraftSchema>;

/** Areas BrandBot tries to cover. ≥4 of 6 + the core 4 → onboarding_complete. */
export const ONBOARDING_AREAS = [
  "name_niche",
  "voice",
  "icp",
  "visual",
  "handles",
  "phrases",
] as const;
export type OnboardingArea = (typeof ONBOARDING_AREAS)[number];

export const CORE_REQUIRED_AREAS: OnboardingArea[] = [
  "name_niche",
  "voice",
  "icp",
];
