-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0003 — agent_memories + agent_executions
--
-- Self-learning memory system (mirror of clubhub §7):
--   • RECALL keywords → ILIKE on search_text → top-K by priority
--   • DETECT correction → LLM checks (assistant_msg, user_followup) for is_correction
--   • EXTRACT memory → LLM produces structured {content, type, priority, keywords}
--   • STORE with dedupe (find_similar by 5 keywords AND)
--   • mark_used → +times_used, auto-boost +1 every 5 uses
--   • Weekly decay → -1 priority after 30d unused, deactivate after 60d unused
--
-- Memories scoped by (company_id, agent_slug). Brain graph (cross-agent
-- learnings) is a separate table — added later in Fatia 5+.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE public.memory_type AS ENUM (
  'correction',   -- "no, don't do X / do Y instead"
  'knowledge',    -- "X is true / our policy is Y"
  'pattern',      -- "we usually format Z this way"
  'preference'    -- "we prefer A over B"
);

CREATE TYPE public.memory_source AS ENUM (
  'user_correction',   -- detected from chat by DETECT/EXTRACT
  'user_explicit',     -- user typed "remember X"
  'agent_extracted',   -- agent itself decided to remember
  'manual',            -- inserted via UI/API directly
  'user_feedback'      -- 👍/👎 explicit feedback turned into memory
);

CREATE TABLE public.agent_memories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  agent_slug      TEXT NOT NULL REFERENCES public.agent_catalog(slug),

  content         TEXT NOT NULL,
  context         TEXT,                   -- optional, where the memory came from
  category        TEXT,                   -- free-form tag (format, tone, fact, …)

  memory_type     public.memory_type NOT NULL DEFAULT 'knowledge',
  source          public.memory_source NOT NULL DEFAULT 'user_correction',

  priority        INTEGER NOT NULL DEFAULT 5
    CHECK (priority >= 1 AND priority <= 10),

  -- Pre-tokenized search field. Lowercased, stopwords removed at write time.
  search_text     TEXT NOT NULL,

  times_used      INTEGER NOT NULL DEFAULT 0,
  last_used_at    TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT true,

  -- Optional link back to the conversation that produced this memory
  session_id      UUID REFERENCES public.chat_sessions(id) ON DELETE SET NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_memories_company_agent_active
  ON public.agent_memories(company_id, agent_slug)
  WHERE is_active = true;

-- Trigram index for fast ILIKE keyword matching during RECALL
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_agent_memories_search_trgm
  ON public.agent_memories USING gin (search_text gin_trgm_ops)
  WHERE is_active = true;

CREATE TRIGGER trg_agent_memories_updated_at
  BEFORE UPDATE ON public.agent_memories
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.agent_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_memories_member_read ON public.agent_memories
  FOR SELECT USING (
    company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
  );

CREATE POLICY agent_memories_member_write ON public.agent_memories
  FOR ALL USING (
    company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
  );

-- ─── agent_executions ──────────────────────────────────────────────────────
-- Audit log for every agent run. One row per chat call (sync or stream),
-- cron firing, or pipeline step. Used for cost tracking, debugging,
-- and the future ToolTimeline UI.
CREATE TABLE public.agent_executions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  agent_slug        TEXT NOT NULL REFERENCES public.agent_catalog(slug),
  session_id        UUID REFERENCES public.chat_sessions(id) ON DELETE SET NULL,

  trigger           TEXT NOT NULL,          -- 'chat' | 'chat_stream' | 'cron' | 'pipeline_step' | 'feedback'
  -- LLM call summary
  provider          TEXT,                   -- 'gemini', 'anthropic', etc.
  model             TEXT,
  tokens_input      INTEGER,
  tokens_output     INTEGER,
  latency_ms        INTEGER,
  -- Outcome
  status            TEXT NOT NULL DEFAULT 'ok',  -- 'ok' | 'error'
  error_message     TEXT,
  -- Memory pipeline outcomes (small JSON, no need for separate table yet)
  memories_recalled INTEGER NOT NULL DEFAULT 0,
  memories_stored   INTEGER NOT NULL DEFAULT 0,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_executions_company_agent
  ON public.agent_executions(company_id, agent_slug, created_at DESC);

CREATE INDEX idx_agent_executions_session
  ON public.agent_executions(session_id) WHERE session_id IS NOT NULL;

ALTER TABLE public.agent_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_executions_member_read ON public.agent_executions
  FOR SELECT USING (
    company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
  );
-- Inserts come from server side (service role) — no insert policy needed.
