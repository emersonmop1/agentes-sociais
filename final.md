# Insta Creator no Masi — De/Para vs DevClub Agent Hub

> **Objetivo:** documento de referência pra portar o pipeline de carrosséis Instagram do DevClub Agent Hub (Python/FastAPI/SQLAlchemy/ClaudeCLI) pra dentro da plataforma Masi (TypeScript/Hono/pg/Gemini), respeitando a arquitetura modular já estabelecida.
>
> **Versão:** 2026-04-27 · status: blueprint de implementação
>
> **Audiência principal:** Rodolfo Mori (autor do DevClub Agent Hub) — vai liderar a implementação.
> **Audiência secundária:** time de engenharia Masi e revisores de arquitetura.

---

## 0. Contexto pro Rodolfo

### 0.1 O que é o Masi

Masi é a plataforma B2B de mentoria empresarial via agentes IA (gestão pra dono de SMB). 13 agentes especialistas, diagnóstico MASI-EF dos 6 pilares (Marketing, Aceleração de Vendas, Sistemas, Inovação, Escala, Financeiro), Coach Semanal, RAG com base de conhecimento. Roda em Supabase Cloud (sa-east-1) + Fly.io (GRU). Frontend Vite + React na Vercel.

Stack técnica:
- **Backend:** Node 22, TypeScript, Hono, `pg` (raw queries), Supabase Auth (Google SSO + email), Gemini (Flash + Pro)
- **Worker:** mesmo Node, consome jobs de uma tabela `agent_jobs`, roda agentes via LangGraph
- **Frontend:** React (sem framework de roteamento robusto ainda — `window.location.pathname`), estilos inline (sem Tailwind), Realtime via Supabase Broadcast
- **Banco:** Postgres 16 com migrations versionadas em `supabase/migrations/`
- **Infra:** Fly.io (api + worker), Vercel (front), Supabase Storage (buckets pra arquivos)

### 0.2 O que estamos te pedindo

Trazer o pipeline Instagram do DevClub Agent Hub pra dentro da plataforma Masi como um **módulo isolado** (`src/modules/insta_creator/`), respeitando 6 regras de arquitetura modular que combinamos antes:

1. Código isolado por módulo (sem imports cruzados)
2. Schema com prefixo `creator_`
3. API com namespace `/api/insta-creator/*`
4. Brain compartilhado, mas via I/O explícito (`brain.read`, `brain.write`)
5. Feature flags desde o dia 1 (mesmo que hoje todos tenham acesso)
6. Frontend em sub-app extraível (vai ser standalone no futuro como add-on/upsell)

Ou seja: você não vai mexer em outras partes do Masi. Sua área é a pasta `src/modules/insta_creator/` (backend e frontend). Tudo que precisa de fora consome via API ou eventos.

### 0.3 Premissas adotadas

- **Stack:** TypeScript + Hono + pg + Gemini (não dá pra portar Python direto, então é re-implementação respeitando os mesmos conceitos)
- **Storage:** Supabase Storage (bucket `creator-slides`)
- **Multi-tenancy:** `company_id` (equivalente a `player_id` do DevClub)
- **Pricing:** módulo faz parte do Masi platform, mas estruturalmente preparado pra virar add-on/upsell standalone no futuro
- **Escopo:** porte completo de tudo que o DevClub Insta Creator faz — Telegram bot, Manus, auto-aprendizado de memória, crons globais, image generation. Nada cortado.

Recomendações pontuais sobre OAuth, stack de imagens e geração de imagem estão na §14 ao final, com justificativa.

---

## 1. Sumário executivo

O DevClub Agent Hub tem um pipeline maduro de criação de carrosséis Instagram com revisão humana etapa-a-etapa (kanban de 15 status), 4 estilos visuais, image search multi-fonte, render via Playwright e publicação via Graph API. Este documento mapeia esse sistema pra dentro da arquitetura Masi mantendo as boas práticas:

- **Modular** (`src/modules/insta_creator/`)
- **Self-contained** (pode virar standalone)
- **Multi-tenant por `company_id`** (em vez do `player_id` do DevClub)
- **TypeScript/Hono** no backend, **React/Vite** no frontend (já é o stack do Masi)
- **Gemini** como provider LLM (já configurado), em vez do ClaudeCLI

A entrega é um módulo completo com 5 tabelas, 7 grupos de endpoints, 1 worker de render, integrações com 2-6 fontes de imagem e publisher via Graph API.

---

## 2. Stack — De/Para

| Camada | DevClub Agent Hub | Masi (alvo) |
|---|---|---|
| Linguagem | Python 3.12 | TypeScript (já em uso) |
| Framework HTTP | FastAPI | Hono (já em uso) |
| Servidor | uvicorn | @hono/node-server (já em uso) |
| ORM | SQLAlchemy async | `pg` raw queries com helpers (`db/client.ts`, já em uso) |
| Migrations | `init_db()` + `_add_missing_columns` | Supabase migrations versionadas (já em uso) |
| LLM | ClaudeCLI subprocess | Gemini Flash/Pro via SDK (já em uso, `lib/gemini.ts`) |
| Background jobs | APScheduler | tabela `agent_jobs` + worker existente |
| Browser automation | Playwright Python | Playwright Node (adicionar no worker) |
| Bot Telegram | aiogram 3.x | grammy (Node) — Fatia 8 |
| Auth | Vault SSO | Supabase Auth (já em uso) |
| Multi-tenancy | `X-Player-Id` header | `company_id` derivado do JWT (já em uso) |
| Frontend | React 19 + Vite + Tailwind v4 | React + Vite + estilos inline (já em uso) |
| Storage de imagens | Filesystem `data/instagram/posts/{id}/` | Supabase Storage (recomendado) |
| Publishers | Graph API direto + Manus | Graph API direto (Manus fica como Fatia 7+) |

---

## 3. Modelo de domínio — De/Para

### 3.1 Mapeamento de entidades

| DevClub | Masi (alvo) | Observação |
|---|---|---|
| `Player` (id, slug, name, owner_name, logo_emoji) | **`companies`** (já existe) | Sem nova tabela. Multi-tenancy por `company_id`. |
| `Agent` (slug, soul, system_prompt, provider_config, telegram_topic_id) | **`agent_catalog`** (já existe) + system prompt no código do agente | Speaker + nova entrada `insta_creator` (ou reusa `speaker`). |
| `AgentMemory` (correction/knowledge/pattern/preference) | **`brain_graph_nodes`** (já existe) | Aprendizado de marca/voz vira nó do brain compartilhado. |
| `BrandConfig` (logo, cores, fontes, handle, voz) | **`creator_brand_config`** (NOVA) | Nova tabela exclusiva do módulo. |
| `InstagramPost` (15 status, slides_config, caption, …) | **`creator_posts`** (NOVA) | Equivalente direto. |
| `Conversation` + `Message` (USER/ASSISTANT/SYSTEM) | **`chat_sessions`** + **`chat_messages`** (já existem) | Reuso direto, com `session_type='insta_creator'`. |
| `AgentCron` (schedule, prompt, last_run_at) | **`agent_jobs`** (já existe, expandido) | Schedule via DateTrigger ou cron string. |
| `ToolInvocation` (auditoria de tools) | **`agent_executions`** (já existe) | Já capturamos isso no Masi. |

### 3.2 Decisão arquitetural sobre agentes

O DevClub tem **5 agentes seedados em código**, cada um com `agent.py` + `soul.py` + `system_prompt.py`. O Masi já tem `agent_catalog` no banco. Decisão:

- **System prompt do `insta_creator` fica em código** (`src/modules/insta_creator/agents/insta-creator/system-prompt.ts`), não no banco — facilita versionar.
- **Soul (persona)** também fica em código.
- **`agent_catalog` mantém o registro** (id, name, description, gradient_colors, avatar) pra UI.
- **Memória de marca** (BrandConfig) vira tabela dedicada porque tem campos visuais estruturados.

---

## 4. Schema — Tabela por tabela

Migration nova: `supabase/migrations/<timestamp>_insta_creator_module.sql`.

### 4.1 `creator_brand_config`

Snapshot da identidade visual da marca do cliente. **1 registro por company.**

```sql
CREATE TABLE public.creator_brand_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,

  -- Identidade
  brand_name TEXT NOT NULL,
  handle TEXT,                              -- @handle do Instagram
  logo_url TEXT,                            -- Supabase Storage URL
  avatar_url TEXT,                          -- foto/avatar do criador
  badge_verified BOOLEAN DEFAULT false,

  -- Cores (hex)
  primary_color TEXT DEFAULT '#0F172A',
  secondary_color TEXT DEFAULT '#22C55E',
  accent_color TEXT DEFAULT '#F59E0B',
  background_color TEXT DEFAULT '#FFFFFF',
  text_color TEXT DEFAULT '#0F172A',

  -- Tipografia
  font_family_heading TEXT DEFAULT 'Inter',
  font_family_body TEXT DEFAULT 'Inter',

  -- Voz da marca
  voice_tone TEXT,                          -- 'direto'|'casual'|'técnico'|...
  voice_examples TEXT[],                    -- 2-3 exemplos textuais
  forbidden_terms TEXT[],                   -- termos a evitar
  signature_phrases TEXT[],                 -- bordões da marca

  -- Default visual
  default_visual_style TEXT DEFAULT 'tweet_thread'
    CHECK (default_visual_style IN ('tweet_thread','dark','acid_text','tweet_single')),

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.2 `creator_posts`

**1 registro por carrossel Instagram.** Equivalente direto a `instagram_posts` do DevClub.

```sql
CREATE TYPE creator_post_status AS ENUM (
  'draft',
  'copy_review',     'copy_approved',
  'design_review',   'design_approved',
  'caption_review',  'caption_approved',
  'final_review',
  'ready', 'scheduled',
  'publishing', 'published',
  'publish_failed', 'rejected'
);

CREATE TYPE creator_post_type AS ENUM ('carousel','single');

CREATE TABLE public.creator_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by UUID REFERENCES profiles(id),

  -- Metadados
  title TEXT NOT NULL,
  post_type creator_post_type DEFAULT 'carousel',
  status creator_post_status DEFAULT 'draft',
  visual_style TEXT NOT NULL DEFAULT 'tweet_thread'
    CHECK (visual_style IN ('tweet_thread','dark','acid_text','tweet_single')),

  -- Slides (estrutura no §4.6)
  slides_config JSONB DEFAULT '[]'::jsonb,
  slides_count INT DEFAULT 0,

  -- Storage
  slides_storage_prefix TEXT,               -- ex: "creator/posts/{id}/"
  cover_image_url TEXT,                     -- atalho pro slide 1 publicado

  -- Caption
  caption TEXT,
  first_comment TEXT,
  hashtags TEXT[],

  -- Pesquisa (research feita pelo agente)
  research_data JSONB,
  source_urls TEXT[],

  -- Brand snapshot (clone da BrandConfig no momento da criação)
  brand_snapshot JSONB,

  -- Feedback / revisão
  rejection_feedback TEXT,
  revision_count INT DEFAULT 0,

  -- Publicação
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  publish_error TEXT,
  external_post_id TEXT,                    -- ID retornado pela Graph API
  external_post_url TEXT,

  -- Performance pós-publicação
  performance_data JSONB,                   -- { likes, comments, reach, saves… }
  performance_last_polled_at TIMESTAMPTZ,

  -- Referência pra conversa onde foi gerado
  chat_session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_creator_posts_company_status
  ON creator_posts(company_id, status);
CREATE INDEX idx_creator_posts_scheduled
  ON creator_posts(scheduled_at)
  WHERE status = 'scheduled';
```

### 4.3 `creator_image_cache`

**Cache de buscas de imagem.** Evita refetch quando o cliente edita o post várias vezes.

```sql
CREATE TABLE public.creator_image_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  search_query TEXT NOT NULL,               -- normalizado pra lowercase
  source TEXT NOT NULL,                     -- 'unsplash'|'pexels'|'pixabay'|...
  results JSONB NOT NULL,                   -- array de {url, credit, width, height}
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days'),
  UNIQUE (search_query, source)
);

CREATE INDEX idx_creator_image_cache_query
  ON creator_image_cache(LOWER(search_query));
```

### 4.4 `creator_render_jobs`

**Fila de renderização de slides.** Separada de `agent_jobs` porque o renderer Playwright é específico.

```sql
CREATE TYPE creator_render_status AS ENUM ('pending','running','completed','failed');

CREATE TABLE public.creator_render_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES creator_posts(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  slide_indexes INT[],                      -- quais slides re-renderizar (vazio = todos)
  status creator_render_status DEFAULT 'pending',
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 3,
  error TEXT,

  output_urls TEXT[],                       -- URLs dos PNGs no Storage

  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_creator_render_pending
  ON creator_render_jobs(created_at)
  WHERE status = 'pending';
```

### 4.5 `creator_publish_jobs`

Fila de publicações (com retry resiliente). Separada por mesmo motivo.

```sql
CREATE TYPE creator_publish_status AS ENUM (
  'queued','validating','uploading','publishing',
  'completed','failed','cancelled'
);

CREATE TABLE public.creator_publish_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES creator_posts(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  publisher TEXT NOT NULL DEFAULT 'graph_api'
    CHECK (publisher IN ('graph_api','manus')),
  scheduled_for TIMESTAMPTZ,                -- agendamento (NULL = imediato)

  status creator_publish_status DEFAULT 'queued',
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 5,
  error TEXT,

  external_response JSONB,                  -- raw response da API

  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_creator_publish_due
  ON creator_publish_jobs(scheduled_for)
  WHERE status = 'queued';
```

### 4.6 Estrutura JSON de `slides_config`

**1 array de slides.** Cada slide é um objeto:

```json
{
  "index": 0,
  "title": "Texto principal do slide",
  "subtitle": "Texto secundário (opcional)",
  "body": "Texto longo (opcional, alguns templates)",
  "is_cover": true,
  "is_cta": false,
  "image": {
    "search_query": "person coding laptop dark room",
    "source": "unsplash",
    "url": "https://images.unsplash.com/...",
    "credit": "Photo by John Doe on Unsplash",
    "width": 1080,
    "height": 1350
  },
  "rendered_url": "https://supabase.../slide_00.png",
  "rendered_at": "2026-04-27T10:00:00Z",
  "background_color": "#000000",
  "highlight_color": "#22C55E"
}
```

`search_query` em **inglês** sempre (Unsplash/Pexels indexam melhor). Validações:

- `slides_config.length` máximo 10 (limite Graph API).
- Se `visual_style = 'acid_text'`, `image` é opcional (só texto).
- Se `visual_style = 'tweet_single'`, `slides_config.length === 1`.

---

## 5. Os 4 estilos visuais

Cada estilo é um template HTML/CSS no servidor (renderizado pelo Playwright headless em PNG 1080×1350).

| Slug | Nome | Características visuais | Imagens? |
|---|---|---|---|
| `tweet_thread` | Carrossel Varos | Fundo branco, header avatar+nome+badge, texto preto, foto real (Unsplash/Pexels) por slide | Sim, real |
| `dark` | Carrossel Dark | Fundo preto, texto branco, imagens cinematográficas geradas por IA (Gemini Image) | Sim, IA |
| `acid_text` | Texto Ácido | Fundo branco, avatar+@handle, **APENAS texto provocativo**, sem imagens | Não |
| `tweet_single` | Post Único | UMA imagem 1080×1350, frase impactante grande sobreposta | Sim |

Templates ficam em `src/modules/insta_creator/templates/{slug}.html` com placeholders Handlebars/Mustache (`{{ title }}`, `{{ image.url }}`, `{{ brand.handle }}`, etc.).

---

## 6. Os 15 status do pipeline

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  draft ─→ copy_review ─→ copy_approved ─→ design_review ─→   │
│   ↑           │              │                  │             │
│   └──── reject (back)  ──────┴──────────────────┘            │
│                                                              │
│  ─→ design_approved ─→ caption_review ─→ caption_approved    │
│           │                  │                  │             │
│           └──── reject (back) ──────────────────┘            │
│                                                              │
│  ─→ final_review ─→ ready ─→ scheduled ─→ publishing ─→     │
│         │             │           │            │              │
│         │             │           │            └→ published   │
│         │             │           │            └→ publish_    │
│         │             │           │                failed     │
│         │             │           │                           │
│         └─────────────┴───────────┴── rejected (qualquer hr)  │
└──────────────────────────────────────────────────────────────┘
```

### 6.1 Transições válidas (state machine)

| De | Eventos válidos | Pra |
|---|---|---|
| `draft` | gerar copy | `copy_review` |
| `draft` | rejeitar | `rejected` |
| `copy_review` | aprovar | `copy_approved` |
| `copy_review` | rejeitar (com feedback) | `draft` (revisão) |
| `copy_approved` | gerar slides | `design_review` |
| `design_review` | aprovar | `design_approved` |
| `design_review` | rejeitar (regenerar imagem N) | `copy_approved` |
| `design_approved` | gerar caption | `caption_review` |
| `caption_review` | aprovar | `caption_approved` |
| `caption_approved` | revisão final | `final_review` |
| `final_review` | aprovar | `ready` |
| `ready` | publicar agora | `publishing` |
| `ready` | agendar | `scheduled` |
| `scheduled` | trigger time chegou | `publishing` |
| `publishing` | sucesso | `published` |
| `publishing` | erro | `publish_failed` |

Implementar como função `transition(post, event, context)` que valida transição antes de aplicar (rejeita transições inválidas com erro 409).

---

## 7. As 4 etapas do agente

O agente **InstaCreator** orquestra as 4 etapas. **CRÍTICO:** sempre para e espera resposta humana entre cada etapa.

### Etapa 1 — Pesquisa + copy

- Status: `draft → copy_review`
- Inputs: tema do post, `visual_style`, instruções do usuário
- Ações:
  1. Pesquisa do tema (web search ou base própria — usa Gemini com tool ou Tavily se configurado)
  2. Gera N slides (3-10) com `title`, `subtitle`, `body` quando aplicável
  3. Para cada slide define `search_query` em inglês
  4. **NÃO gera imagens ainda** — só copy
  5. Atualiza `slides_config` no banco
- Output: `slides_config` populado sem `image.url`

### Etapa 2 — Aprovação copy → gera slides

- Status: `copy_review → copy_approved → design_review`
- Disparado quando humano aprova
- Ações:
  1. Pra cada slide com `search_query`, busca imagem (multi-fonte)
  2. Preenche `slides_config[].image`
  3. Cria job em `creator_render_jobs` pra renderizar PNGs
  4. Worker Playwright pega o job e renderiza cada slide
  5. Sobe PNGs no Supabase Storage
  6. Atualiza `slides_config[].rendered_url` e `slides_config[].rendered_at`
- Output: PNGs renderizados, post em `design_review`

### Etapa 3 — Caption + first_comment

- Status: `design_approved → caption_review`
- Disparado quando humano aprova design
- Ações:
  1. Lê `slides_config` final + `brand_snapshot` + `research_data`
  2. Gera `caption` (200-400 palavras) com gancho, conteúdo, CTA
  3. Gera `first_comment` (será postado como primeiro comentário)
  4. Gera `hashtags[]` (15-30 hashtags relevantes)
- Output: `caption`, `first_comment`, `hashtags` populados

### Etapa 4 — Final review

- Status: `caption_approved → final_review → ready`
- Humano vê tudo junto (slides + caption) num modal de revisão final
- Aprovação manda pra `ready`. Reprovação volta pra `caption_review` ou `design_review` com feedback

---

## 8. Image search — multi-fonte com fallback

Service `src/modules/insta_creator/services/image-search.ts`:

```ts
type Source = 'unsplash' | 'pexels' | 'pixabay' | 'google_cse' | 'brave' | 'serpapi';

const ORDER: Source[] = ['unsplash', 'pexels', 'pixabay', 'google_cse'];

export async function searchImages(
  query: string,
  limit: number = 5,
): Promise<ImageResult[]> {
  // 1. Cache hit?
  const cached = await getCached(query);
  if (cached.length >= limit) return cached.slice(0, limit);

  // 2. Tenta fontes em ordem
  for (const source of ORDER) {
    if (!isSourceConfigured(source)) continue;
    try {
      const results = await fetchFrom(source, query, limit);
      if (results.length > 0) {
        await setCache(query, source, results);
        return results;
      }
    } catch (err) {
      console.warn(`[image-search] ${source} failed:`, err.message);
    }
  }

  return [];
}
```

**APIs e env vars:**

| Source | Env var | Limite grátis | Quality |
|---|---|---|---|
| Unsplash | `UNSPLASH_ACCESS_KEY` | 50 req/h | ★★★★★ |
| Pexels | `PEXELS_API_KEY` | 200 req/h | ★★★★ |
| Pixabay | `PIXABAY_API_KEY` | 5k req/h | ★★★ |
| Google CSE | `GOOGLE_CSE_API_KEY` + `GOOGLE_CSE_ID` | 100 req/dia | ★★★★ |
| Brave Search | `BRAVE_SEARCH_API_KEY` | 2k req/mês free | ★★★ |
| SerpAPI | `SERPAPI_API_KEY` | 100 req/mês free | ★★★★ |

**Recomendação MVP:** começar só com Unsplash + Pexels (ambos grátis, 1 conta cada). Adicionar fallbacks depois se taxa de "no results" for alta.

**Domain blocklist:** filtra resultados de `dreamstime.com`, `shutterstock.com`, `gettyimages.com` (têm watermark).

---

## 9. Carousel Renderer — Playwright

Service `src/modules/insta_creator/services/carousel-renderer.ts`:

### 9.1 Arquitetura

```
                     ┌─────────────────────┐
                     │   Worker process    │
                     │  (já existente)     │
                     └─────────┬───────────┘
                               │ poll creator_render_jobs
                               ▼
                     ┌─────────────────────┐
                     │  CarouselRenderer   │
                     └─────────┬───────────┘
                               │
                ┌──────────────┼──────────────────┐
                ▼              ▼                  ▼
      Browser singleton    Templates HTML   Slide data + brand
      (Playwright          (4 estilos)      (do creator_posts)
       chromium headless)
                ▼
         Renderiza HTML, captura screenshot 1080×1350 PNG
                ▼
         Upload no Supabase Storage (bucket "creator-slides")
                ▼
         Atualiza slides_config[i].rendered_url
                ▼
         Marca creator_render_jobs.status = 'completed'
```

### 9.2 Boas práticas

- **Browser singleton:** 1 instância do Chromium reusada entre renders (boot do Chromium custa ~2s; manter rodando economiza tempo).
- **Pool de pages:** N pages simultâneas (3-5). Cada page renderiza 1 slide por vez.
- **Timeout por slide:** 30s. Se passar, marca fail e move pra próxima tentativa.
- **Fontes:** carrega via `<link rel="preconnect">` + `<link rel="stylesheet" href="https://fonts.googleapis.com/...">`.
- **Aguarda networkidle:** `await page.goto(url, { waitUntil: 'networkidle' })` antes de screenshot pra garantir que imagens carregaram.

### 9.3 Templates (Handlebars)

Cada template em `src/modules/insta_creator/templates/{slug}.html` com placeholders:

```handlebars
<!-- tweet_thread.html (Carrossel Varos) -->
<div class="slide" style="background:{{brand.background_color}}; color:{{brand.text_color}};">
  <header class="header">
    <img src="{{brand.avatar_url}}" class="avatar"/>
    <div class="user">
      <div class="name">{{brand.brand_name}}
        {{#if brand.badge_verified}}<span class="badge">✓</span>{{/if}}
      </div>
      <div class="handle">@{{brand.handle}}</div>
    </div>
  </header>

  {{#if image.url}}
  <img src="{{image.url}}" class="slide-image"/>
  {{/if}}

  <div class="content">
    <h1 class="title">{{title}}</h1>
    {{#if subtitle}}<p class="subtitle">{{subtitle}}</p>{{/if}}
    {{#if body}}<p class="body">{{body}}</p>{{/if}}
  </div>

  {{#if is_cta}}
  <footer class="cta">{{brand.signature_phrase}}</footer>
  {{/if}}
</div>
```

CSS inline ou tag `<style>` direto no HTML pra evitar fetch externo. Tamanho fixo `width:1080px;height:1350px`.

---

## 10. Publisher — Instagram Graph API

Service `src/modules/insta_creator/services/publishers/graph-api.ts`:

### 10.1 Pré-requisitos

1. Conta Instagram **Business** (não pessoal)
2. Conectada a uma **Página do Facebook**
3. Página conectada a um **App do Facebook Developers** (`INSTAGRAM_APP_ID` + `INSTAGRAM_APP_SECRET`)
4. OAuth flow pra cliente Masi conectar a conta dele
5. Token de longa duração (60d) armazenado em `creator_brand_config.metadata` ou `integration_tokens`

### 10.2 Fluxo de publicação

```
1. POST /<ig-user-id>/media com:
   { image_url: <slide_NN.png>, is_carousel_item: true, ... }
   ↓
   Resposta: { id: "<container_id>" }

2. Repete passo 1 pra cada slide → coleta lista de container_ids

3. POST /<ig-user-id>/media com:
   { media_type: "CAROUSEL", children: [container_ids], caption: "..." }
   ↓
   Resposta: { id: "<carousel_container_id>" }

4. POST /<ig-user-id>/media_publish?creation_id=<carousel_container_id>
   ↓
   Resposta: { id: "<media_id>" }

5. Salva external_post_id = media_id
```

### 10.3 First comment

Depois da publicação, posta o `first_comment` como comment do post:

```
POST /<media_id>/comments?message=<first_comment>
```

### 10.4 Retry policy

- 3 tentativas com backoff exponencial (5s, 30s, 5min)
- Erros 4xx (quota, token inválido): não retry, marca como failed
- Erros 5xx (transient): retry

---

## 11. Estrutura de arquivos no repositório

```
masi-ai-orquestration/
├── supabase/migrations/
│   └── 20260427_insta_creator_module.sql       ← 5 tabelas + enums
│
├── src/modules/insta_creator/                  ← MÓDULO ISOLADO
│   ├── README.md                                ← princípios e roadmap interno
│   ├── routes/
│   │   ├── index.ts                             ← /api/insta-creator/* (registro)
│   │   ├── posts.ts                             ← CRUD + transições
│   │   ├── slides.ts                            ← regenerar slide individual
│   │   ├── caption.ts                           ← gerar/editar caption
│   │   ├── publishing.ts                        ← agendar/publicar
│   │   ├── brand.ts                             ← brand config
│   │   └── images.ts                            ← search e proxy de imagem
│   ├── services/
│   │   ├── post-pipeline.ts                     ← state machine + transições
│   │   ├── carousel-renderer.ts                 ← Playwright + templates
│   │   ├── image-search.ts                      ← multi-fonte com fallback
│   │   ├── image-generator.ts                   ← Gemini Image (estilo dark)
│   │   ├── publishers/
│   │   │   ├── graph-api.ts                     ← Instagram Graph API direto
│   │   │   └── manus.ts                         ← (Fatia 7+, alternativa)
│   │   ├── brand-snapshot.ts                    ← clona BrandConfig no momento
│   │   ├── feature-flag.ts                      ← isInstaCreatorEnabled()
│   │   └── storage.ts                           ← Supabase Storage helper
│   ├── agents/
│   │   ├── insta-creator/
│   │   │   ├── system-prompt.ts                 ← prompt do agente
│   │   │   ├── soul.ts                          ← persona/identidade
│   │   │   └── handler.ts                       ← orquestra etapas
│   │   ├── researcher/
│   │   │   └── handler.ts                       ← pesquisa web
│   │   └── caption-writer/
│   │       └── handler.ts                       ← gera caption + hashtags
│   ├── templates/
│   │   ├── tweet_thread.html                    ← Carrossel Varos
│   │   ├── dark.html
│   │   ├── acid_text.html
│   │   └── tweet_single.html
│   ├── workers/
│   │   ├── render-worker.ts                     ← consome creator_render_jobs
│   │   └── publish-worker.ts                    ← consome creator_publish_jobs
│   └── types/
│       └── index.ts                             ← interfaces TS
│
└── src/index.ts                                 ← registra /api/insta-creator
```

Frontend espelhado em `masi-negocios-prot/src/modules/insta_creator/`.

---

## 12. Boas práticas — 10 regras inegociáveis

1. **State machine obrigatória.** Toda transição de status passa por função `transition()` que valida. Não permitir update direto de `status` no banco.
2. **Brand snapshot imutável.** Quando post é criado, `brand_snapshot` clona BrandConfig atual. Mesmo que cliente mude marca depois, post antigo preserva look original.
3. **Search query em inglês.** APIs de imagem funcionam mil vezes melhor com inglês. Agente forçado a gerar em inglês mesmo em conta brasileira.
4. **Pause obrigatório entre etapas.** Agente nunca pode pular de Etapa 1 pra Etapa 2 sem aprovação humana. Forçar via flag `await_human_approval` no system prompt.
5. **Image cache de 7 dias.** Mesma `search_query` não dispara nova request. Cache key = `LOWER(search_query) + source`.
6. **Render assíncrono.** Endpoint nunca renderiza inline. Cria job em `creator_render_jobs`, retorna 202, frontend faz polling ou usa Realtime.
7. **Render em browser singleton.** 1 Chromium reusado pelo worker. Boot custa 2s, então manter aberto economiza muito.
8. **Storage com TTL implícito.** Imagens renderizadas ficam em `creator-slides/posts/{post_id}/slide_NN.png`. Se post for `rejected`, agendar limpeza após 30 dias.
9. **Audit log de todas as transições.** Tabela `agent_executions` (já existe) registra cada mudança de status com user_id + timestamp.
10. **Multi-tenant rigoroso.** Toda query filtra `WHERE company_id = $1`. Sem exceção. Middleware de auth já entrega `companyId` no contexto.

---

## 13. Plano de implementação por fatias

Cada fatia é entregável e testável independente.

### Fatia 1 — Esqueleto modular (1 dia)
- [ ] Migration com 5 tabelas + enums + indexes
- [ ] Pasta `src/modules/insta_creator/` com README + estrutura
- [ ] `routes/index.ts` com `GET /api/insta-creator/health`
- [ ] Feature flag service
- [ ] Frontend: rota `/insta-creator` + página status
- [ ] Registro em `src/index.ts`

### Fatia 2 — Brand config (1 dia)
- [ ] Endpoints CRUD `creator_brand_config`
- [ ] UI de edição (logo upload, cores, voz, exemplos)
- [ ] Upload de logo/avatar pro Supabase Storage

### Fatia 3 — Etapa 1: Copy gen (3 dias)
- [ ] Endpoint `POST /api/insta-creator/posts` (cria DRAFT)
- [ ] Agente `researcher` (Gemini com prompt de pesquisa)
- [ ] Agente `insta-creator` etapa 1 (gera slides_config sem imagens)
- [ ] State machine `transition()`
- [ ] UI: editor de copy com aprovação/rejeição

### Fatia 4 — Etapa 2: Slides + render (4 dias)
- [ ] Service `image-search` com Unsplash + Pexels
- [ ] Templates HTML dos 4 estilos
- [ ] Service `carousel-renderer` com Playwright
- [ ] Worker `render-worker` consumindo `creator_render_jobs`
- [ ] Upload pro Supabase Storage
- [ ] UI: preview slides + crop/refazer por slide

### Fatia 5 — Etapa 3 + 4: Caption + final (1-2 dias)
- [ ] Agente `caption-writer`
- [ ] Endpoint `POST /api/insta-creator/posts/:id/caption/generate`
- [ ] UI: editor de caption + final review modal

### Fatia 6 — Publicação Graph API (4 dias)
- [ ] Setup Facebook App + Instagram OAuth flow
- [ ] Service `publishers/graph-api`
- [ ] Worker `publish-worker` consumindo `creator_publish_jobs`
- [ ] Endpoint `POST /api/insta-creator/posts/:id/publish` (now ou scheduled)
- [ ] UI: agendamento + acompanhamento de publicação

### Fatia 7 — Publisher Manus AI (3 dias)
- [ ] Service `publishers/manus.ts` — cliente HTTP do Manus
- [ ] Toggle no brand config: `publisher_preference` (`graph_api` | `manus`)
- [ ] Endpoint público (`BACKEND_PUBLIC_URL`) servindo PNGs dos slides pra Manus consumir
- [ ] Webhook receiver pra atualização de status do Manus
- [ ] UI: seletor de publisher na tela de "Pronto pra publicar"

### Fatia 8 — Notificações via Telegram bot (3 dias)
- [ ] Lib `grammy` (Node) instalada no backend
- [ ] Bot criado no BotFather, token em env (`TELEGRAM_BOT_TOKEN`)
- [ ] Tabela `creator_telegram_bindings` (company_id ↔ chat_id)
- [ ] Comando `/start` no bot pra cliente vincular conta Masi via deep link
- [ ] Notificação automática: post agendado pra sair, post publicado, post falhou
- [ ] Comandos `/posts pending`, `/publish-now <id>`, `/status` pra operar fora do app
- [ ] Forum topics (1 agente = 1 topic) pro futuro multi-agente

### Fatia 9 — Engagement poller (2 dias)
- [ ] Worker que roda a cada 1h em todos os posts publicados nos últimos 30 dias
- [ ] Lê métricas do Instagram Graph API: likes, comments, reach, saves, impressões
- [ ] Atualiza `creator_posts.performance_data` e `performance_last_polled_at`
- [ ] UI: dashboard de performance dos posts publicados (tabela + gráfico)

### Fatia 10 — Auto-aprendizado de memória (5-7 dias)
- [ ] Migration: tabela `creator_brand_memory` (4 tipos × 5 sources, prioridade 1-10)
- [ ] Service `memory-manager` — ciclo RECALL → DETECT → EXTRACT → STORE
- [ ] DETECT: LLM analisa par (msg do agente, msg de feedback do humano) → identifica correção
- [ ] EXTRACT: LLM gera memória estruturada (correction/knowledge/pattern/preference)
- [ ] STORE: deduplica via similar search e persiste
- [ ] Auto-boost: a cada 5 usos, prioridade +1 (max 10)
- [ ] Decay: memórias sem uso há 30+ dias perdem prioridade; sem uso há 60+ dias viram inativas
- [ ] Cron weekly de hygiene: roda decay em todas as memórias
- [ ] Endpoint `POST /api/insta-creator/posts/:id/feedback` (👍/👎 + comentário)
- [ ] Memórias injetadas no prompt do agente em formato `<learned_memories>...</learned_memories>`

### Fatia 11 — Crons globais + Quick Flow (3 dias)
- [ ] Cron `creator-daily-auto-posts` — gera N posts/dia automático pra cada cliente com flag ligada
- [ ] Cron `creator-engagement-poller` (já implementado na Fatia 9, registrar)
- [ ] Endpoint `POST /api/insta-creator/quick-flow` com SSE
- [ ] Quick Flow: gera N posts em batch, escolhe temas únicos via Content Supervisor
- [ ] UI: botão "Gerar 3 posts pra essa semana" → abre painel SSE com progresso

### Fatia 12 — Image generation (Gemini Image / OpenAI) (3 dias)
- [ ] Service `image-generator` com providers Gemini Image + OpenAI gpt-image
- [ ] Toggle por estilo: `dark` usa geração obrigatória; `tweet_thread` usa search
- [ ] Pra `dark`: gera prompt cinematográfico baseado em `slides_config[].title`
- [ ] Pra YouTube thumbnails (futuro): gera 4 conceitos via thumbnail-strategist
- [ ] Storage no Supabase, mesmo padrão dos slides
- [ ] UI: preview da imagem gerada com botão "regenerar com outro prompt"

### Fatia 13 — Studio automation (futuro, depois do módulo YouTube) (5-7 dias)
- Não pertence ao Insta Creator (é YouTube). Listado aqui só como anchor pra módulo futuro `youtube_creator`.

### Fatia 14 — Frontend polish completo (3-4 dias)
- [ ] Kanban com 15 colunas, drag-and-drop entre status (validando state machine)
- [ ] Modal de PostDetail com 4 abas (copy, design, caption, final)
- [ ] SlideEditor com drag-and-drop de imagem, crop nativo, regenerar individual
- [ ] PreGenerateSlidesModal (pergunta `visual_style` + `user_instructions`)
- [ ] Lego Story Dialog (geração via story building)
- [ ] News Dialog (puxa feed de notícias relevantes pro tema)
- [ ] Analytics Dashboard (account stats + insights + top posts)

**Total estimado:** ~6-8 semanas pra módulo completo (todas as 14 fatias).

---

## 14. Recomendações de implementação

Três pontos com sugestão de caminho e racional. Não são decisões a tomar agora — são propostas a partir do que vivemos no Masi até aqui. Quem implementa pode seguir ou ajustar conforme contexto encontrado.

### 14.1 OAuth Instagram — modelo de App

**Sugerido:** Masi cria 1 Facebook App único (`app_id` + `app_secret` em env do backend). Cliente final conecta a conta Instagram Business dele via OAuth padrão (botão "Conectar Instagram" → fluxo Facebook Login → callback retorna long-lived token, armazenado em `creator_brand_config.metadata` ou tabela `integration_tokens`).

Trade-offs:
- Cliente final tem zero fricção (não precisa entrar em developer.facebook.com)
- Masi controla quotas e telemetria
- Custo: precisa passar pelo Facebook App Review (2-6 semanas) pra liberar `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement` em produção
- Risco centralizado: se App for banido, todos clientes ficam fora simultaneamente

Alternativa (cliente cria App próprio): elimina o risco centralizado e o App Review, mas mata onboarding — cliente médio não tem competência pra criar App no developer.facebook.com.

### 14.2 Stack de imagens MVP

**Sugerido:** começar Fatia 4 com **Unsplash + Pexels** apenas. Ambos grátis, 50-200 req/h. Cobrem ~85% das queries comuns no nosso universo (negócios SMB brasileiro). Adicionar fallbacks (Pixabay, Google CSE, Brave, SerpAPI) na Fatia 4.5 conforme telemetria de "no results" mostrar necessidade.

Trade-offs:
- Implementação ~2 dias mais rápida vs 6 fontes
- Apenas 2 chaves API pra gerenciar nos primeiros meses
- Custo: ocasionalmente uma query muito específica retorna vazio (cliente reclama, dispara investigação, adiciona fonte certa)

### 14.3 Image generation (Gemini Image / OpenAI gpt-image)

**Sugerido:** primeira versão (Fatia 4) usa **só search**. Estilo `dark` funciona com imagens reais (Unsplash com queries cinematográficas — `"dark cinematic studio man laptop dramatic lighting"` etc.). Geração de imagem entra na Fatia 12 como camada de polish, quando o pipeline estiver maduro e tivermos ROI claro pra justificar custo de API.

Trade-offs:
- Pipeline funcional desde Fatia 4-5 sem nova dependência
- Custo de API zero no MVP
- Custo: estilo `dark` fica visualmente menos cinematográfico que o equivalente DevClub original (que usa Gemini 3 Pro Image)

Alternativa (geração desde Fatia 4): adiciona ~3 dias de implementação + dependência Vertex AI ou Google AI Studio + ~US$ 0.04 por imagem (com 5 slides/post × 100 posts/mês = US$ 20/mês por cliente).
