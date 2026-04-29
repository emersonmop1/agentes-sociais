# Agentes Sociais

Hub de agentes IA para redes sociais e copywriting. SaaS multi-tenant com onboarding self-service, kanban de produção e publish automatizado em Instagram + YouTube.

## Status

Todas as 11 fatias do plano (0–10) entregues:

- Onboarding conversacional via BrandBot
- 5 agentes: CopyMaster, AdMaster, InstaCreator (pipeline 14 status), ReelsCreator, YouTubeGrowth
- Memória RECALL→DETECT→EXTRACT→STORE por agente, escopada por company
- Render de carrossel via Playwright + Handlebars (4 templates visuais)
- Publish Instagram via Graph API; YouTube via Data API v3 resumable + thumbnail
- OAuth Instagram (Facebook Login) + Google (YouTube + Drive)
- Quotas mensais com função SQL atômica + reset por plano
- Quick Flow: gera N carrosséis em batch com ângulos únicos via Content Supervisor
- Engagement poller que atualiza `performance_data` dos posts publicados (1×/h)

## Arquitetura

```
agentes-sociais/
├── apps/
│   ├── api/         Hono + TypeScript (REST + SSE)
│   ├── worker/      Job poller (render Playwright, publish, thumbs, engagement)
│   └── web/         React 19 + Vite + Supabase Auth + TanStack Query
├── packages/
│   └── shared/      Tipos + Zod schemas compartilhados api ↔ web
├── supabase/
│   └── migrations/  SQL versionado (0001 → 0010)
└── masi-negocios-prot/  reference de UI (NÃO faz parte do workspace)
```

Stack: Node 22, TypeScript, Hono, `pg` raw, Gemini 2.5 (Flash + Pro + Image), Playwright, Supabase (Auth + Postgres + Storage), pnpm workspaces.

### Tabelas centrais

| Tabela | Conteúdo |
|---|---|
| `profiles` / `companies` / `company_members` | Identity multi-tenant |
| `brand_configs` | Brand snapshot 1:1 company |
| `agent_catalog` / `chat_sessions` / `chat_messages` | Catálogo + sessões de chat |
| `agent_memories` (GIN trigram) / `agent_executions` | Memória + auditoria |
| `creator_posts` / `creator_render_jobs` / `creator_publish_jobs` | InstaCreator pipeline |
| `reels_scripts` | ReelsCreator scripts |
| `youtube_projects` / `youtube_thumbnail_jobs` / `youtube_publish_jobs` / `creator_faces` | YouTubeGrowth |
| `integration_tokens` (encriptado AES-GCM) / `oauth_state` | OAuth Instagram + Google |
| `companies.*_quota_remaining` + `fn_decrement_quota` / `fn_reset_expired_quotas` | Quotas mensais |

### Rotas principais

| Rota | Função |
|---|---|
| `POST /api/agents/:slug/chat[/stream]` | Chat genérico — quota `chat` |
| `POST /api/insta-creator/chat` | InstaCreator — gera copy, transiciona post |
| `POST /api/insta-creator/quick-flow` (SSE) | Batch N posts com ângulos únicos |
| `POST /api/insta-creator/posts/:id/publish` | Auto-publish Instagram |
| `POST /api/insta-creator/posts/:id/manual-publish` | Marca published com URL externa |
| `POST /api/reels/chat` | ReelsCreator — quota `reels` |
| `POST /api/youtube/projects` | Cria projeto — quota `youtube` |
| `POST /api/youtube/projects/:id/publish` | Auto-publish YouTube (resumable + thumb) |
| `POST /api/integrations/{instagram,google}/connect` | OAuth start |
| `GET /api/integrations/{instagram,google}/callback` | OAuth finish (público) |
| `GET /api/companies/me` | Plano + quotas + reset window |

## Setup local

### Pré-requisitos

- Node.js 22+
- pnpm 10+ (`npm i -g pnpm`)
- psql (cliente Postgres)
- Conta Supabase (Auth + Postgres + Storage — usamos cloud em dev)

### Variáveis de ambiente

```bash
cp .env.example .env
# Gera chave de criptografia (AES-256-GCM):
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Cole no .env como ENCRYPTION_KEY
```

Mínimo necessário no `.env`:

```dotenv
DATABASE_URL=postgresql://postgres:...@aws-1-sa-east-1.pooler.supabase.com:5432/postgres
SUPABASE_URL=https://<id>.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ENCRYPTION_KEY=<32 bytes hex>
GEMINI_API_KEY=AIza...

API_PORT=8000
API_PUBLIC_URL=http://localhost:8000
WEB_PUBLIC_URL=http://localhost:5173

# Opcional — só necessário se for testar publish/OAuth real
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

### Migrations

```bash
set -a; source .env; set +a
for f in supabase/migrations/*.sql; do
  echo "→ $f"
  psql "$DATABASE_URL" -f "$f"
done
```

Migrations atuais:

| Migração | Conteúdo |
|---|---|
| `0001_init_auth_companies.sql` | profiles, companies, members + post-signup trigger |
| `0002_brand_configs_onboarding.sql` | brand_configs, chat_sessions/messages, agent_catalog seed |
| `0003_memory_executions.sql` | agent_memories (GIN trigram), agent_executions |
| `0004_creator_module.sql` | creator_posts (14-status), image_cache, render_jobs, publish_jobs |
| `0005_integration_tokens.sql` | OAuth tokens encriptados + oauth_state |
| `0006_publish_lease.sql` | fn_lease_next_publish_job |
| `0007_reels_module.sql` | reels_scripts (10-status) |
| `0008_youtube_module.sql` | youtube_projects (15-status), thumb_jobs, creator_faces |
| `0009_youtube_publish.sql` | youtube_publish_jobs + lease |
| `0010_quotas_and_supervisor.sql` | fn_decrement_quota, fn_reset_expired_quotas, trigram em titles |

### Install + run

```bash
pnpm install

# Em três terminais (ou via tmux):
pnpm dev:api      # http://localhost:8000  (Hono + tsx watch)
pnpm dev:worker   # background poller     (tsx watch)
pnpm dev:web      # http://localhost:5173 (Vite)
```

Smoke check:

```bash
curl http://localhost:8000/api/health
# → { "status": "ok", "db": true, ... }
```

Abra http://localhost:5173 → cadastre uma conta. O trigger Postgres em `0001` cria company + profile + member automaticamente. Você cai no fluxo de onboarding (BrandBot) e depois no dashboard com os 5 agentes.

## Comandos

| Comando | Ação |
|---|---|
| `pnpm dev:api` | API server com hot-reload |
| `pnpm dev:worker` | Worker (renders, publishes, engagement poll) |
| `pnpm dev:web` | Vite frontend |
| `pnpm typecheck` | `tsc --noEmit` em api + worker + web |
| `pnpm build` | Build de produção dos 3 packages |
| `pnpm --filter @agentes/api dev` | Filtro por package específico |

### Aplicar uma única migração

```bash
set -a; source .env; set +a
psql "$DATABASE_URL" -f supabase/migrations/0010_quotas_and_supervisor.sql
```

### Rodar reset mensal de quotas manualmente

```bash
psql "$DATABASE_URL" -c "SELECT public.fn_reset_expired_quotas();"
```

(Em produção isso entra como cron — `cron.schedule('0 4 * * *', ...)` ou job Fly.)

## Diretórios-chave

```
apps/api/src/
├── index.ts                          server bootstrap (mount routes)
├── env.ts                            zod-validated env
├── middleware/                       auth (JWT Supabase), company resolver
├── db/
│   ├── client.ts                     pg pool + helpers (one, many, exec, tx)
│   └── repositories/                 row types + CRUD por tabela
├── core/
│   ├── memory-manager.ts             RECALL/DETECT/EXTRACT/STORE
│   ├── prompt-builder.ts             ordem fixa: soul + brand + memories + instructions
│   ├── creator-state-machine.ts      Insta 14-status FSM
│   ├── reels-state-machine.ts        Reels 10-status FSM
│   └── youtube-state-machine.ts      YouTube 15-status FSM
├── agents/                           soul + system_prompt em código
│   ├── brand-bot/                    onboarding interno
│   ├── insta-creator/                copy → caption pipeline
│   ├── reels-creator/                hooks → script → caption → broll
│   ├── youtube-growth/               ideation + thumb strategy
│   ├── copy-master/                  chat puro
│   └── ad-master/                    chat puro
├── modules/                          rotas Hono por área
│   ├── agents/         insta-creator/    youtube/
│   ├── reels/          integrations/     companies/
│   ├── onboarding/     agents/chat-routes.ts
│   └── ...
└── services/
    ├── content-supervisor.ts         Quick Flow planner
    ├── quota.ts                      consumeQuota / refundQuota / snapshot
    ├── carousel-renderer.ts          Playwright + Handlebars
    ├── image-search.ts / image-generator.ts
    ├── instagram-graph.ts            publish carousel + insights
    ├── youtube-data-api.ts           resumable upload + thumb
    └── google-oauth.ts               authorize + exchange + refresh

apps/worker/src/
├── index.ts                          poll loop + maybeRunEngagementTick
├── handlers/
│   ├── render-slide.ts
│   ├── publish-instagram.ts
│   ├── publish-youtube.ts
│   ├── generate-thumbnails.ts
│   └── poll-engagement.ts            Graph insights → performance_data
└── services/                         mirror de api/services para handlers

apps/web/src/
├── main.tsx + App.tsx                rotas + providers (TanStack Query, Auth)
├── contexts/AuthContext.tsx          Supabase session
├── pages/
│   ├── onboarding/                   Welcome, Auth, BrandBot, Reveal, FirstTask
│   ├── DashboardPage.tsx
│   ├── ChatPage.tsx                  CopyMaster + AdMaster
│   ├── InstaWorkspacePage.tsx        kanban + chat + Quick Flow
│   ├── ReelsWorkspacePage.tsx
│   └── YouTubeWorkspacePage.tsx
├── components/
│   ├── insta/                        KanbanBoard, PostDetailModal, QuickFlowModal
│   ├── reels/                        HookPicker
│   ├── youtube/                      ThumbPicker
│   └── ui/                           Glass, AgentAvatar, Logo, QuotaBadge, etc
├── hooks/                            useAgents, useChat, useInstaPosts, useQuickFlow,
│                                     useCompany, useIntegrations, useMemories
└── lib/                              api fetch wrapper, supabase client
```

## Deploy

- **API + Worker** → Fly.io (region `gru`). `cd apps/api && fly deploy`. Worker como `[processes]` no `fly.toml`.
- **Frontend** → Vercel. Conecte o repo, root = `apps/web`, framework `Vite`.
- **DB + Auth + Storage** → Supabase Cloud (region `sa-east-1`).

Secrets em produção:

```bash
# API + worker
fly secrets set \
  DATABASE_URL=... \
  ENCRYPTION_KEY=... \
  GEMINI_API_KEY=... \
  SUPABASE_URL=... \
  SUPABASE_ANON_KEY=... \
  SUPABASE_SERVICE_ROLE_KEY=... \
  INSTAGRAM_APP_ID=... \
  INSTAGRAM_APP_SECRET=... \
  GOOGLE_CLIENT_ID=... \
  GOOGLE_CLIENT_SECRET=...

# Web (Vercel dashboard)
VITE_API_URL=...
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## OAuth — primeira configuração

### Instagram (Facebook Login)

1. Crie um app em https://developers.facebook.com → produto **Instagram Graph API**
2. Adicione redirect: `https://api.seu-dominio.com/api/integrations/instagram/callback`
3. Copie `App ID` + `App Secret` para `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`
4. Para testes locais, adicione você como tester (modo dev) — escopo `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`

### Google (YouTube + Drive)

1. Crie um projeto em https://console.cloud.google.com
2. APIs habilitadas: `YouTube Data API v3` (+ futuramente `Drive API`)
3. OAuth consent screen → tipo External, escopos:
   - `youtube`
   - `youtube.upload`
   - `youtube.readonly`
4. Credenciais → OAuth Client → Web application → redirect: `https://api.seu-dominio.com/api/integrations/google/callback`
5. Copie `Client ID` + `Client Secret` para `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`

## Roadmap

- [x] **Fatia 0** — Foundation (workspace, auth, DB, /api/health, login)
- [x] **Fatia 1** — Onboarding conversacional + design system
- [x] **Fatia 2** — Agent shell + memory + chat (CopyMaster, AdMaster)
- [x] **Fatia 3** — InstaCreator pipeline core
- [x] **Fatia 4** — Insta caption + publish (Graph API)
- [x] **Fatia 5** — Image generation (Gemini Image)
- [x] **Fatia 6** — Reels/TikTok agent
- [x] **Fatia 7** — YouTube core (transcribe + ideation + thumbs)
- [x] **Fatia 8** — YouTube publish (Data API resumable + thumbnail)
- [x] **Fatia 9** — Quotas + Quick Flow + Content Supervisor
- [x] **Fatia 10** — Polish: engagement poller + README + CI

### Backlog v2

- Studio Automation Playwright headed (A/B title, end screen, pinned comment)
- Tool invocation timeline frontend
- Sentry / OTel tracing
- Playwright E2E smoke (signup → onboarding → primeiro post → publish)
- Custom agents via DB (`agent_catalog` editável)
- Team invites (`company_members.role = admin/member`)
- Billing tier `pro` (já modelado em `companies.plan`)

## Documentação adicional

- Plano original: `~/.claude/plans/vamos-criar-um-sistema-iridescent-hummingbird.md`
- Referência clubhub (Python source): `resumo-tecnico-club-hub.md`
- Referência InstaCreator (Masi port): `final.md`
- UI reference (paleta, componentes): `masi-negocios-prot/`
