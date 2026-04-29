import { onboardingDraftSchema, type OnboardingDraft } from "@agentes/shared";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import {
  buildPrompt,
  detectReadySignal,
  extractDraftDelta,
  isReadyToFinish,
  mergeDraft,
} from "../../agents/brand-bot/handler.js";
import { tx } from "../../db/client.js";
import {
  appendMessage,
  getOrCreateOnboardingSession,
  listMessages,
} from "../../db/repositories/chat.js";
import {
  getCompanyByIdOrThrow,
  markOnboardingCompleted,
  updateOnboardingDraft,
} from "../../db/repositories/companies.js";
import { loadEnv } from "../../env.js";
import { getDefaultProvider, type LLMMessage } from "../../lib/llm/index.js";
import { logger } from "../../lib/logger.js";
import type { AuthContext } from "../../middleware/auth.js";
import type { CompanyContext } from "../../middleware/company.js";

export const onboardingRoutes = new Hono<{
  Variables: { auth: AuthContext; company: CompanyContext };
}>();

// ─── GET /api/onboarding/state — initial load ──────────────────────────────
onboardingRoutes.get("/state", async (c) => {
  const company = await getCompanyByIdOrThrow(undefined, c.var.company.companyId);
  const sessionId = await getOrCreateOnboardingSession(
    undefined,
    company.id,
    c.var.auth.userId,
  );
  const messages = await listMessages(undefined, sessionId);
  return c.json({
    company_id: company.id,
    company_name: company.name,
    onboarding_completed: company.onboarding_completed,
    draft: company.onboarding_draft,
    ready_to_finish: isReadyToFinish(company.onboarding_draft),
    session_id: sessionId,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.created_at,
      metadata: m.metadata,
    })),
  });
});

// ─── POST /api/onboarding/messages — non-streaming chat turn ───────────────
const messageBodySchema = z.object({
  content: z.string().min(1).max(4000),
});

onboardingRoutes.post("/messages", async (c) => {
  const body = messageBodySchema.parse(await c.req.json());
  const company = await getCompanyByIdOrThrow(undefined, c.var.company.companyId);

  if (company.onboarding_completed) {
    return c.json(
      { error: "already_completed", message: "Onboarding já está completo" },
      409,
    );
  }

  const sessionId = await getOrCreateOnboardingSession(
    undefined,
    company.id,
    c.var.auth.userId,
  );

  // 1. Persist user message + load history
  await appendMessage(undefined, {
    sessionId,
    role: "user",
    content: body.content,
  });
  const history = await listMessages(undefined, sessionId);
  const llmHistory: LLMMessage[] = history.map((m) => ({
    role: m.role === "system" ? "user" : m.role,
    content: m.content,
  }));

  // 2. Build prompt and call BrandBot
  const systemPrompt = buildPrompt(company.onboarding_draft);
  const provider = getDefaultProvider();
  const response = await provider.chat(llmHistory, {
    system: systemPrompt,
    tier: "flash",
    temperature: 0.7,
    maxOutputTokens: 1024,
  });

  // 3. Detect [ONBOARDING_READY] signal & strip
  const { text: cleanedReply, ready } = detectReadySignal(response.content);

  // 4. Extract structured delta and merge into draft
  const delta = await extractDraftDelta({
    userMessage: body.content,
    agentReply: cleanedReply,
    currentDraft: company.onboarding_draft,
  });
  const merged = mergeDraft(company.onboarding_draft, delta);
  const nowReady = ready || isReadyToFinish(merged);

  // 5. Persist agent reply + updated draft (in a single tx)
  const assistantMsgId = await tx(async (client) => {
    const id = await appendMessage(client, {
      sessionId,
      role: "assistant",
      content: cleanedReply,
      tokensUsed: response.tokens,
      providerModel: response.model,
      metadata: { onboarding_complete: nowReady },
    });
    await updateOnboardingDraft(client, company.id, merged);
    return id;
  });

  return c.json({
    message: {
      id: assistantMsgId,
      role: "assistant",
      content: cleanedReply,
      metadata: { onboarding_complete: nowReady },
    },
    draft: merged,
    ready_to_finish: nowReady,
  });
});

// ─── POST /api/onboarding/upload-logo ── attach a logo image to the draft ──
//
// Accepts a data-URL JSON payload (mirrors the brand-faces upload pattern in
// youtube/routes.ts) so it works through the existing apiFetch wrapper without
// multipart parsing. Stores in the public `logos/` bucket and patches
// onboarding_draft.logo_url so the next BrandBot turn can see it.
const uploadLogoSchema = z.object({
  /** Either a `data:image/...;base64,...` URL or a raw base64 string. */
  data_url: z.string().min(64).max(12 * 1024 * 1024),
});

onboardingRoutes.post("/upload-logo", async (c) => {
  const env = loadEnv();
  const company = await getCompanyByIdOrThrow(undefined, c.var.company.companyId);
  if (company.onboarding_completed) {
    return c.json({ error: "already_completed" }, 409);
  }

  const body = uploadLogoSchema.parse(await c.req.json());

  // Strip data URL prefix if present
  const m = body.data_url.match(/^data:(image\/\w+);base64,(.+)$/);
  const mime = m?.[1] ?? "image/png";
  const base64 = m?.[2] ?? body.data_url;
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024) {
    return c.json({ error: "invalid_image", message: "size 0 or > 8MB" }, 400);
  }
  const ext = mime.includes("png")
    ? "png"
    : mime.includes("jpeg") || mime.includes("jpg")
      ? "jpg"
      : mime.includes("webp")
        ? "webp"
        : mime.includes("svg")
          ? "svg"
          : "bin";
  const path = `${company.id}/${randomUUID()}.${ext}`;

  const supa = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { error: upErr } = await supa.storage.from("logos").upload(path, bytes, {
    contentType: mime,
    cacheControl: "604800",
    upsert: false,
  });
  if (upErr) {
    return c.json({ error: "upload_failed", message: upErr.message }, 500);
  }
  // Public bucket — no signing needed.
  const { data: pub } = supa.storage.from("logos").getPublicUrl(path);
  const logoUrl = pub.publicUrl;

  // Patch the draft so the BrandBot's next turn sees logo_url and the
  // DraftPreview renders it instantly.
  const merged: OnboardingDraft = {
    ...company.onboarding_draft,
    logo_url: logoUrl,
  };
  await updateOnboardingDraft(undefined, company.id, merged);

  // Drop a "system" chat note so the conversation reflects the upload event
  // and the next LLM turn knows it happened (history includes this).
  const sessionId = await getOrCreateOnboardingSession(
    undefined,
    company.id,
    c.var.auth.userId,
  );
  await appendMessage(undefined, {
    sessionId,
    role: "user",
    content: `[anexei meu logo: ${logoUrl}]`,
    metadata: { kind: "logo_upload", logo_url: logoUrl },
  });

  logger.info(
    { companyId: company.id, size: bytes.length, mime },
    "onboarding: logo uploaded",
  );

  return c.json({
    logo_url: logoUrl,
    draft: merged,
    ready_to_finish: isReadyToFinish(merged),
  });
});

// ─── PATCH /api/onboarding/draft — manual edit (BrandReveal page) ──────────
const draftPatchSchema = onboardingDraftSchema;

onboardingRoutes.patch("/draft", async (c) => {
  const company = await getCompanyByIdOrThrow(undefined, c.var.company.companyId);
  if (company.onboarding_completed) {
    return c.json({ error: "already_completed" }, 409);
  }
  const partial = draftPatchSchema.parse(await c.req.json()) as Partial<OnboardingDraft>;
  const merged: OnboardingDraft = { ...company.onboarding_draft, ...partial };
  // Arrays in the patch fully replace (manual edit semantics — different
  // from the conversational dedupe-append).
  await updateOnboardingDraft(undefined, company.id, merged);
  return c.json({ draft: merged, ready_to_finish: isReadyToFinish(merged) });
});

// ─── POST /api/onboarding/complete — promote draft to brand_configs ────────
onboardingRoutes.post("/complete", async (c) => {
  const company = await getCompanyByIdOrThrow(undefined, c.var.company.companyId);
  if (company.onboarding_completed) {
    return c.json({ error: "already_completed" }, 409);
  }

  const draft = company.onboarding_draft;
  const brandName = draft.brand_name;
  const niche = draft.niche;
  if (!brandName || !niche) {
    return c.json(
      {
        error: "draft_incomplete",
        message: "brand_name e niche são obrigatórios pra concluir o onboarding",
        missing: [
          ...(!brandName ? ["brand_name"] : []),
          ...(!niche ? ["niche"] : []),
        ],
      },
      400,
    );
  }

  await tx(async (client) => {
    // Insert brand_configs (UNIQUE on company_id, so re-running fails — guarded by completed flag above)
    await client.query(
      `INSERT INTO public.brand_configs (
        company_id, brand_name, niche,
        instagram_handle, tiktok_handle, youtube_channel,
        logo_url, avatar_url,
        primary_color, secondary_color, accent_color,
        voice_tone, voice_examples, forbidden_terms, signature_phrases,
        icp_description, target_audience,
        default_visual_style
      ) VALUES (
        $1, $2, $3,
        $4, $5, $6,
        $7, $8,
        COALESCE($9, '#0F172A'), COALESCE($10, '#22C55E'), COALESCE($11, '#F59E0B'),
        $12, $13, $14, $15,
        $16, $17::jsonb,
        COALESCE($18::public.visual_style, 'tweet_thread'::public.visual_style)
      )
      ON CONFLICT (company_id) DO NOTHING`,
      [
        company.id,
        brandName,
        niche,
        draft.instagram_handle ?? null,
        draft.tiktok_handle ?? null,
        draft.youtube_channel ?? null,
        draft.logo_url ?? null,
        draft.avatar_url ?? null,
        draft.primary_color ?? null,
        draft.secondary_color ?? null,
        draft.accent_color ?? null,
        draft.voice_tone ?? [],
        draft.voice_examples ?? [],
        draft.forbidden_terms ?? [],
        draft.signature_phrases ?? [],
        draft.icp_description ?? null,
        JSON.stringify(draft.target_audience ?? {}),
        draft.default_visual_style ?? null,
      ],
    );
    await markOnboardingCompleted(client, company.id, brandName);
  });

  logger.info(
    { companyId: company.id, brand: brandName },
    "onboarding completed",
  );

  return c.json({ ok: true, company_id: company.id });
});
