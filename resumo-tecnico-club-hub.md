# DevClub Agent Hub — Documentação Técnica Completa

> Versão deste documento: 2026-04-26
> Objetivo: blueprint de reprodução. Quem ler este arquivo do zero deve conseguir reconstruir o sistema inteiro.

---

## Índice

1. [Visão Geral](#1-visão-geral)
2. [Stack Tecnológica Completa](#2-stack-tecnológica-completa)
3. [Arquitetura de Diretórios](#3-arquitetura-de-diretórios)
4. [Modelo Conceitual (Domínio)](#4-modelo-conceitual-domínio)
5. [Schema de Banco — Tabela por Tabela](#5-schema-de-banco--tabela-por-tabela)
6. [Sistema de Agentes](#6-sistema-de-agentes)
7. [Sistema de Memórias (Auto-Aprendizado)](#7-sistema-de-memórias-auto-aprendizado)
8. [Provider LLM (Plugável)](#8-provider-llm-plugável)
9. [Multi-tenancy (Players)](#9-multi-tenancy-players)
10. [Construção de Prompts](#10-construção-de-prompts)
11. [API REST Completa](#11-api-rest-completa)
12. [Streaming SSE](#12-streaming-sse)
13. [Sistema de Crons (APScheduler)](#13-sistema-de-crons-apscheduler)
14. [Pipeline Instagram (Kanban Carrossel)](#14-pipeline-instagram-kanban-carrossel)
15. [Pipeline YouTube Projects](#15-pipeline-youtube-projects)
16. [Telegram Bot](#16-telegram-bot)
17. [Frontend — Arquitetura React](#17-frontend--arquitetura-react)
18. [Tema Visual (Warm Clay)](#18-tema-visual-warm-clay)
19. [Autenticação (Vault SSO)](#19-autenticação-vault-sso)
20. [Image Search Multi-source e Geração de Imagens](#20-image-search-multi-source-e-geração-de-imagens)
21. [Variáveis de Ambiente](#21-variáveis-de-ambiente)
22. [Deploy (Railway + Docker)](#22-deploy-railway--docker)
23. [Como Rodar Localmente (Setup Completo)](#23-como-rodar-localmente-setup-completo)
24. [Testes](#24-testes)
25. [Hooks e Skills do Claude Code (.claude/)](#25-hooks-e-skills-do-claude-code-claude)
26. [Roadmap / Funcionalidades Planejadas](#26-roadmap--funcionalidades-planejadas)
27. [Apêndices](#27-apêndices)

---

## 1. Visão Geral

### 1.1 O que é

DevClub Agent Hub é um centro de controle de **agentes de IA verticais** voltado para o ecossistema Rodolfo Mori (DevClub, TI na Europa, Celebra). Cada agente é uma "alma" (Soul) com personalidade própria, memória persistente, capacidade de aprender com o uso, crons agendados, integração Telegram (1 tópico = 1 agente), e endpoints REST para automatizar tarefas reais (publicar carrossel no Instagram, agendar vídeo no YouTube, escrever copy de anúncio, etc.).

A plataforma serve dois universos simultaneamente:

1. **Chat conversacional** — usuário dialoga com agentes pela web ou Telegram, com streaming SSE em tempo real, aprendizado automático de correções e feedback explícito (👍 / 👎).
2. **Pipelines Kanban** — fluxos visuais para produção de conteúdo (carrosséis Instagram, vídeos YouTube) com revisão humana etapa a etapa, drag & drop entre status, retrabalho, agendamento e publicação.

### 1.2 Quem usa

- **Rodolfo Mori** — CEO do DevClub (15.000+ alunos pagantes em programação, 232k inscritos no canal `@rodolfomori`), criador do TI na Europa
- **Multi-player** — a mesma instância serve múltiplos perfis/marcas. Hoje: `devclub` (devclub) e `ti-na-europa` (TI na Europa)

### 1.3 Capacidades principais

| Capacidade | Descrição |
|---|---|
| Chat com agentes | Conversa via web (SSE) ou Telegram (forum topics) |
| Memória auto-aprendida | Ciclo RECALL → DETECT → EXTRACT → STORE detecta correções e armazena lições |
| Feedback 👍/👎 | Cada mensagem do agente pode receber feedback explícito que vira memória PATTERN ou CORRECTION |
| Crons agendados | APScheduler (5-field cron + timezone SP) executa prompts em horários fixos |
| Soul + System Prompt | Identidade do agente separada das instruções técnicas |
| Pipeline Instagram | Kanban com 14 status, geração de slides, image search multi-fonte, render via Playwright, publicação via Manus |
| Pipeline YouTube | Drive download → transcrição → ideação (5 títulos) → thumbnail (4 conceitos com creator face) → publicação + Studio automation |
| Browser automation | Playwright com sessão persistente (YouTube Studio para A/B title, end screen, pinned comment) |
| Tools nos agentes | Claude CLI com `Bash(curl:*)` permite agentes chamarem o próprio backend |
| Multi-tenancy | Header `X-Player-Id` filtra todos os dados (conversas, memórias, posts, projetos) |
| Auth Vault SSO | OAuth via servidor Vault (interno) — `AUTH_ENABLED` toggle |

### 1.4 Diagrama de blocos

```
┌─────────────────────────────────────────────────────────────────────┐
│                          USUÁRIOS                                   │
│  Web (React 19 SPA)   Telegram Forum Topics   API direta            │
└──────────┬─────────────────┬──────────────────────┬─────────────────┘
           │ HTTPS + SSE     │ Bot token            │ X-Internal-Key
           ▼                 ▼                      ▼
┌──────────────────────────────────────────────────────────────────┐
│                    FastAPI Backend (Python 3.12)                 │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────┐  │
│  │ /api/agents    │  │ /api/chat      │  │ /api/instagram     │  │
│  │ /api/memories  │  │ /api/conv...   │  │ /api/youtube       │  │
│  │ /api/crons     │  │ /api/players   │  │ /api/youtube_proj. │  │
│  └────────────────┘  └────────────────┘  └────────────────────┘  │
│                                                                    │
│  Core (memory_manager, prompt_builder, scheduler, brand_context,   │
│  agent_registry, content_supervisor, auth)                         │
│                                                                    │
│  Providers ── ClaudeCLIProvider (subprocess `claude` CLI)          │
│                                                                    │
│  Services (youtube, drive, browser, carousel_renderer, image_      │
│  search, instagram, manus, video_transcriber, thumbnail_strategist,│
│  studio_automator, slide_reviewer, visual_analyzer, ...)           │
│                                                                    │
│  Telegram (aiogram 3.x + topic_manager)                            │
│  Scheduler (APScheduler async — crons + scheduled posts)           │
└──────────┬─────────────────────────────────────────────┬───────────┘
           │ SQLAlchemy async                            │
           ▼                                             ▼
   ┌───────────────┐                          ┌─────────────────────┐
   │ Postgres 16   │                          │ Filesystem          │
   │ (Railway)     │                          │ data/instagram/     │
   │ ou SQLite dev │                          │ assets/images/      │
   └───────────────┘                          └─────────────────────┘

   ┌──────────────────── EXTERNOS ───────────────────────────────┐
   │ Claude CLI (subprocess local)                                │
   │ YouTube Data API v3 (channel, videos, comments, upload)      │
   │ Instagram Graph API (publishing direct)                      │
   │ Manus AI (Instagram publishing scheduler)                    │
   │ Google Drive API (download de vídeos brutos)                 │
   │ Image Search: Unsplash, Pexels, Pixabay, Google CSE,         │
   │               Brave, Tavily, SerpAPI                         │
   │ Image Generation: Gemini 3 Pro Image, OpenAI gpt-image-2     │
   │ Vault SSO (OAuth)                                            │
   │ Telegram Bot API                                             │
   └──────────────────────────────────────────────────────────────┘
```

---

## 2. Stack Tecnológica Completa

### 2.1 Backend

| Camada | Tecnologia | Versão |
|---|---|---|
| Runtime | Python | 3.12 |
| Framework HTTP | FastAPI | >= 0.115 |
| Servidor ASGI | uvicorn[standard] | >= 0.34 |
| ORM | SQLAlchemy[asyncio] | >= 2.0.36 |
| Driver SQLite async | aiosqlite | >= 0.20 |
| Driver Postgres async | asyncpg | >= 0.30 |
| Migrations | Alembic | >= 1.14 |
| Modelagem schemas | Pydantic | >= 2.10 |
| Settings | pydantic-settings | >= 2.7 |
| Bot Telegram | aiogram | >= 3.15 |
| HTTP client async | httpx | >= 0.28 |
| Scheduler | APScheduler | >= 3.11 |
| Logging estruturado | loguru | >= 0.7 |
| Browser automation | Playwright (chromium) | >= 1.49 |
| Imagens | Pillow | >= 10 |
| Google APIs | google-api-python-client + google-auth-oauthlib | >= 2.150 |
| Drive download | gdown | >= 5.2 |
| Repair JSON LLM | json-repair | >= 0.30 |
| OAuth/JWT | PyJWT + cryptography | >= 2.8 / >= 42 |
| Testes | pytest + pytest-asyncio | >= 8.3 / >= 0.25 |

### 2.2 Frontend

| Camada | Tecnologia | Versão |
|---|---|---|
| UI lib | React | 19.2.4 |
| Bundler | Vite | 8.0.1 |
| Linguagem | TypeScript | 5.9 |
| CSS | Tailwind CSS v4 (`@tailwindcss/vite`) | 4.2 |
| Componentes | shadcn/ui (CLI) | base-nova style |
| Server state | TanStack Query (React Query) | 5.96 |
| Roteamento | React Router DOM | 7.13 |
| Markdown | react-markdown + remark-gfm | 10 / 4 |
| Toast | sonner | 2.0 |
| Ícones | lucide-react | 1.7 |
| Classnames | clsx + tailwind-merge | 2.1 / 3.5 |
| CVA | class-variance-authority | 0.7 |
| Animações | tw-animate-css | 1.4 |
| Fontes | @fontsource-variable/inter + Satoshi (Fontshare) + JetBrains Mono | — |
| Lint | ESLint + typescript-eslint + react-hooks + react-refresh | — |

### 2.3 Infraestrutura

| Item | Tecnologia |
|---|---|
| DB dev | SQLite (`sqlite+aiosqlite:///./devclub_agents.db`) |
| DB prod | PostgreSQL 16 (Railway) |
| Container | Docker (multi-stage para frontend) |
| Orquestração local | docker-compose |
| Deploy | Railway (3 serviços: backend + frontend + Postgres) |
| Web server frontend | nginx alpine |
| Certificados | Railway gerencia HTTPS |

### 2.4 LLM

- **Único provider implementado hoje**: ClaudeCLIProvider — chama o binário `claude` (Claude Code CLI) via subprocess, aproveitando assinatura Pro/Max do Anthropic sem consumir tokens da API on-demand.
- Modelo padrão: `claude-opus-4-20250514` (configurável por agente).
- Tools opcionais: `Bash(curl:*)` permite que o agente faça curls reais para o próprio backend (ações concretas).
- Streaming via `--output-format stream-json --verbose`.
- Captura de tool invocations (tool_use + tool_result) para auditoria na tabela `tool_invocations`.

### 2.5 Auth

Vault SSO interno (OAuth). Backend valida JWT via JWKS (cache de 1h). `AUTH_ENABLED=False` em dev, `True` em prod. `X-Player-Id` header (default `devclub`) seleciona qual player está ativo.

### 2.6 APIs externas

| Serviço | Uso |
|---|---|
| YouTube Data API v3 | Stats de canal, list/get/update vídeos, postar e fixar comentários, upload via OAuth refresh token |
| YouTube Studio (Playwright) | A/B test de título, end screen, pinned comment (operações que a Data API não cobre) |
| Instagram Graph API | Publicação direta de carrosséis, métricas de posts, insights |
| Manus AI | Serviço externo de agendamento e publicação Instagram (alternativa à Graph API direta) |
| Google Drive API | Download de vídeos brutos via service account JSON |
| Google CSE | Busca de imagens (uma das fontes) |
| Unsplash / Pexels / Pixabay | Imagens stock para slides |
| Brave Search / Tavily / SerpAPI | Busca de imagens (fallbacks) |
| Gemini 3 Pro Image (`gemini-3-pro-image-preview`) | Geração de imagens cinematográficas para slides dark + thumbnails |
| OpenAI `gpt-image-2` | Geração de imagens (alternativa) |
| Telegram Bot API | Bot em forum topics, comandos `/start`, `/help`, `/agents`, `/status`, `/memories`, `/remember`, `/forget`, `/soul` |
| Vault SSO | OAuth — issuer interno do ecossistema Rodolfo Mori |

---

## 3. Arquitetura de Diretórios

```
agentesclub/
├── backend/
│   ├── app/
│   │   ├── agents/
│   │   │   ├── base.py                     # BaseAgent ABC
│   │   │   ├── ad_creative/                # AdMaster — performance ads
│   │   │   ├── ceo_advisor/                # CEO Advisor — board strategy
│   │   │   ├── copymaster/                 # CopyMaster — conversion copy
│   │   │   ├── instagram_content/          # InstaCreator — carrossel pipeline
│   │   │   └── youtube_growth/             # ViralDev — YouTube growth
│   │   │       (cada pasta: agent.py + soul.py + system_prompt.py)
│   │   ├── api/
│   │   │   ├── router.py                   # router principal
│   │   │   ├── agents.py                   # CRUD agentes + soul
│   │   │   ├── chat.py                     # /chat + /chat/stream + /chat/feedback
│   │   │   ├── conversations.py            # histórico
│   │   │   ├── memories.py                 # CRUD memórias
│   │   │   ├── crons.py                    # CRUD crons + toggle + run
│   │   │   ├── instagram.py                # pipeline kanban Instagram
│   │   │   ├── youtube.py                  # YouTube Data API wrapper
│   │   │   ├── youtube_projects.py         # pipeline kanban YouTube
│   │   │   ├── players.py                  # CRUD players (multi-tenancy)
│   │   │   ├── settings.py                 # leitura/escrita de .env via UI
│   │   │   ├── browser.py                  # Playwright primitives
│   │   │   ├── analytics.py                # tool impact + invocations
│   │   │   ├── ctas.py                     # CTAs configuráveis por agente
│   │   │   ├── news.py                     # feed de notícias tech
│   │   │   ├── lego_story.py               # geração de posts via story building
│   │   │   ├── quick_flow.py               # geração em batch via SSE
│   │   │   └── health.py                   # /health
│   │   ├── core/
│   │   │   ├── agent_registry.py           # mapa slug → classe
│   │   │   ├── memory_manager.py           # ciclo RECALL/DETECT/EXTRACT/STORE
│   │   │   ├── prompt_builder.py           # build_full_prompt + posts context
│   │   │   ├── brand_context.py            # build_brand_context por player
│   │   │   ├── scheduler.py                # APScheduler + execute_cron_job
│   │   │   ├── content_supervisor.py       # geração automática de carrosséis
│   │   │   ├── player.py                   # resolução de player do header
│   │   │   ├── auth.py                     # get_current_user (JWT/JWKS)
│   │   │   ├── seed.py                     # seed_default_agents + crons + players
│   │   │   └── exceptions.py               # AgentNotFoundError, ProviderError, …
│   │   ├── models/
│   │   │   ├── agent.py                    # Agent (5 agentes seedados)
│   │   │   ├── conversation.py             # Conversation + Message + enums
│   │   │   ├── memory.py                   # AgentMemory + MemoryType + MemorySource
│   │   │   ├── player.py                   # Player (multi-tenancy)
│   │   │   ├── cron.py                     # AgentCron
│   │   │   ├── instagram_post.py           # InstagramPost + PostStatus (15) + PostType
│   │   │   ├── youtube_project.py          # YouTubeProject + ProjectStatus (15)
│   │   │   ├── brand_config.py             # BrandConfig por player
│   │   │   ├── player_config.py            # PlayerConfig (chaves/segredos por player)
│   │   │   ├── tool_invocation.py          # ToolInvocation (auditoria de tools)
│   │   │   └── video_tracking.py           # VideoTracking (engagement polling)
│   │   ├── providers/
│   │   │   ├── base.py                     # BaseLLMProvider ABC
│   │   │   ├── claude_cli.py               # ClaudeCLIProvider
│   │   │   └── __init__.py                 # PROVIDER_REGISTRY + get_provider()
│   │   ├── schemas/                        # Pydantic request/response
│   │   │   ├── agent.py
│   │   │   ├── conversation.py
│   │   │   ├── message.py
│   │   │   ├── memory.py
│   │   │   ├── cron.py
│   │   │   ├── instagram.py
│   │   │   ├── youtube_project.py
│   │   │   └── video_tracking.py
│   │   ├── services/
│   │   │   ├── youtube.py                  # Data API v3 (channel, videos, comments, upload)
│   │   │   ├── drive.py                    # Google Drive download
│   │   │   ├── browser.py                  # BrowserService singleton (Playwright)
│   │   │   ├── carousel_renderer.py        # HTML+CSS → PNG via Playwright
│   │   │   ├── image_search.py             # multi-source com fallback ordenado
│   │   │   ├── instagram.py                # InstagramService (orquestra pipeline)
│   │   │   ├── instagram_publisher.py      # Graph API direct publishing
│   │   │   ├── instagram_analytics.py      # métricas via Graph
│   │   │   ├── manus.py                    # Manus AI publisher
│   │   │   ├── video_transcriber.py        # transcrição via Claude/Gemini
│   │   │   ├── thumbnail_strategist.py     # gera 4 conceitos de thumb
│   │   │   ├── youtube_thumb_generator.py  # gera PNG dos conceitos (Gemini/OpenAI)
│   │   │   ├── studio_automator.py         # Playwright em studio.youtube.com
│   │   │   ├── slide_reviewer.py           # review por LLM dos slides
│   │   │   ├── visual_analyzer.py          # análise visual (cores, OCR)
│   │   │   ├── engagement_poller.py        # polling horário de métricas
│   │   │   └── tool_logger.py              # record_invocation()
│   │   ├── telegram/
│   │   │   ├── bot.py                      # cria aiogram Bot + start polling
│   │   │   ├── handlers.py                 # comandos + roteamento
│   │   │   └── topic_manager.py            # mapping topic_id → agent
│   │   ├── config.py                       # Settings (pydantic-settings)
│   │   ├── database.py                     # engine async + init_db + add_missing_columns
│   │   └── main.py                         # FastAPI app + lifespan
│   ├── alembic/                            # versions/ (vazio hoje — usa init_db)
│   ├── tests/                              # conftest + test_agents/api/providers
│   ├── data/                                # runtime: instagram/posts/{post_id}/slide_NN.png
│   ├── assets/                              # estático: images/brand/devclub-logo.png + avatares
│   ├── studio_session.json                  # cookies + localStorage de studio.youtube.com
│   ├── Dockerfile                           # python:3.12-slim + Node 20 + Playwright + Claude CLI
│   ├── entrypoint.sh                        # fix perms volume + gosu appuser uvicorn
│   ├── railway.toml
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx                          # rotas + providers globais
│   │   ├── main.tsx                         # bootstrap
│   │   ├── index.css                        # Tailwind + tokens Warm Clay light/dark
│   │   ├── pages/
│   │   │   └── Settings.tsx                 # 7 tabs por agente + create/delete
│   │   ├── contexts/
│   │   │   ├── AuthContext.tsx              # Vault OAuth state
│   │   │   └── PlayerContext.tsx            # multi-player + tema CSS dinâmico
│   │   ├── hooks/
│   │   │   ├── useAgents.ts
│   │   │   ├── useChat.ts                   # SSE stream + 45s inactivity timeout
│   │   │   ├── useConversations.ts
│   │   │   ├── useCrons.ts
│   │   │   ├── useMemories.ts               # + useSoul, useUpdateSoul
│   │   │   ├── useYouTube.ts                # videos + trackings + analyze
│   │   │   ├── useYouTubeProjects.ts        # kanban refetch 5s + brand faces
│   │   │   ├── useInstagram.ts
│   │   │   ├── useKanban.ts                 # kanban refetch 10s
│   │   │   └── useAnalytics.ts
│   │   ├── lib/
│   │   │   ├── types.ts                     # ~40 interfaces (todos os domínios)
│   │   │   ├── api.ts                       # 80+ funções (REST + SSE)
│   │   │   ├── utils.ts                     # cn()
│   │   │   ├── env.ts                       # window.__ENV__ + import.meta.env
│   │   │   ├── vault-sdk.js                 # VaultAuth class (OAuth client)
│   │   │   └── vault-sdk.d.ts
│   │   └── components/
│   │       ├── layout/                       # Layout, Sidebar, Header, PlayerSelector
│   │       ├── chat/                         # ChatWindow, StandardChatWindow, ChatPanel,
│   │       │                                 # ChatInput, MessageRow, StreamingRow,
│   │       │                                 # ThinkingIndicator, LearningIndicator,
│   │       │                                 # AnalysisActions, ToolTimeline, AgentStatus
│   │       ├── agents/                       # GeneralSettings, SoulEditor, MemoryPanel,
│   │       │                                 # ProviderSettings, ImageProviderSettings,
│   │       │                                 # CronSettings, CTASettings, SystemSettings,
│   │       │                                 # CreateAgentDialog, AgentSettingsSheet
│   │       ├── instagram/                    # InstagramWorkspace, KanbanBoard,
│   │       │   ├── kanban/                   #   KanbanCard, KanbanColumn,
│   │       │   │                             #   PostDetailModal, RejectDialog
│   │       │   ├── PostDetailModal,          # editor completo (slides + caption + crop)
│   │       │   ├── PreGenerateSlidesModal,   # escolhe visual_style + instructions
│   │       │   ├── SlideEditor, SlidesPreview
│   │       │   ├── ImageCropEditor, QuickActions, PipelineActions
│   │       │   ├── AnalyticsDashboard        # account stats + insights + top posts
│   │       │   ├── LegoStoryDialog, NewsDialog
│   │       ├── youtube/                      # YouTubeProjectsWorkspace, YouTubePanel,
│   │       │   ├── kanban/                   #   YouTubeKanbanBoard / Card / Column
│   │       │   ├── VideoCard, EditVideoDialog,
│   │       │   ├── NewYouTubeProjectDialog,
│   │       │   └── YouTubeProjectDetailModal
│   │       ├── adcreative/AdQuickActions.tsx
│   │       ├── copymaster/CopyQuickActions.tsx
│   │       ├── analytics/ToolImpactPanel.tsx
│   │       └── ui/                           # 17+ shadcn components (button, dialog, …)
│   ├── public/                                # favicon.svg, icons.svg
│   ├── Dockerfile                             # build (Node 20) + nginx alpine + env-config.js runtime
│   ├── nginx.conf                             # SPA routing + static cache 1y
│   ├── railway.toml
│   ├── vite.config.ts                         # alias @ + proxy /api → :8000
│   ├── tsconfig*.json (3 files)
│   ├── eslint.config.js
│   ├── components.json                        # shadcn CLI
│   ├── package.json
│   └── README.md
│
├── docker-compose.yml                         # backend + frontend + postgres:16-alpine
├── .env.example
├── .mcp.json                                  # MCP servers para Claude CLI (postgres, filesystem)
├── CLAUDE.md                                  # docs/regras gerais do projeto
├── RESUMO-TECNICO.md                          # ESTE DOCUMENTO
│
├── new_design/                                # referência redesign Warm Clay (HTML + JSX)
├── instagram-export/                          # 17 carrosséis exemplares (slide_NN.png + post.txt)
├── hormozi/                                   # frameworks $100M (knowledge base)
├── ti na europa/                              # ICP, voz da marca, transcrições estratégicas
├── project_educational_carousel.md
├── project_instagram_dashboard.md
├── project_slide_review_agent.md
└── .claude/
    ├── settings.json                          # PostToolUse hook (syntax check Python/TS)
    ├── agents/                                # backend-architect, telegram-specialist, frontend-builder
    ├── rules/                                 # python.md, react.md
    ├── commands/                              # test-agent, status, deploy-check
    └── skills/                                # new-agent, new-provider
```

---

## 4. Modelo Conceitual (Domínio)

O domínio se organiza em torno de **Agente** (entidade central) e **Player** (multi-tenancy). Demais entidades são satélites de Agente, todas escopadas opcionalmente por Player.

```
┌──────────┐     1   N   ┌──────────────┐
│ Player   │─────────────│ Agent        │ (não — agente é shared, mas suas conversas/memórias/posts/projetos têm player_id)
└──────────┘             └──────────────┘
                               │ 1
                               │ N
        ┌──────────────────────┼─────────────────────────┐
        │                      │                          │
        ▼                      ▼                          ▼
┌─────────────┐         ┌──────────────┐          ┌──────────────┐
│ Conversation│   1     │ AgentMemory  │          │ AgentCron    │
│ (player_id) │   N     │ (player_id)  │          │ (player_id)  │
└─────┬───────┘         └──────────────┘          └──────────────┘
      │ 1
      │ N
      ▼
┌─────────────┐
│ Message     │ (USER | ASSISTANT | SYSTEM)
└─────────────┘

Tabelas de pipeline:
┌─────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ InstagramPost   │    │ YouTubeProject   │    │ ToolInvocation   │
│ (player_id)     │    │ (player_id)      │    │ (auditoria)      │
└─────────────────┘    └──────────────────┘    └──────────────────┘

Tabelas de configuração:
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ BrandConfig  │    │ PlayerConfig │    │ VideoTracking│
│ (1:1 player) │    │ (1:1 player) │    │              │
└──────────────┘    └──────────────┘    └──────────────┘
```

**Regras de negócio chave:**

1. **Agente é compartilhado entre players** — a definição (slug, soul, system_prompt) é única. Mas tudo que ele produz/lembra é segregado por `player_id`.
2. **Memórias têm 4 tipos × 5 sources** com prioridade 1-10. Auto-boost a cada 5 usos. Decay: -1 prioridade após 30 dias sem uso, deactivate após 60 dias se nunca usadas.
3. **Conversa pode vir de 3 sources**: WEB (chat), TELEGRAM (forum topic), API (cron ou call externo).
4. **InstagramPost tem 15 status** mapeando todo o pipeline de aprovação humana etapa-a-etapa (DRAFT → … → PUBLISHED ou REJECTED ou PUBLISH_FAILED).
5. **YouTubeProject tem 15 status** cobrindo transcrição → ideação → thumbnails → publicação + Studio automation.
6. **Tudo escopado por player** — endpoints filtram por `X-Player-Id` header (default `devclub`). PlayerConfig pode ter chaves API distintas por player (ex: cada player com sua conta YouTube/Instagram).
7. **Cron 5-field + timezone fixo America/Sao_Paulo** — APScheduler reagenda a cada criação/update via `schedule_cron()`.

---

## 5. Schema de Banco — Tabela por Tabela

Todas as tabelas usam UUID v4 (`String` PK), `created_at`/`updated_at` com timezone-aware (UTC default), e `Base = DeclarativeBase`. Schema é gerenciado via SQLAlchemy ORM + `init_db()` que executa `create_all` + `_add_missing_columns` (que detecta colunas presentes no model mas não no banco e roda `ALTER TABLE ADD COLUMN`).

> Por que não Alembic? `_add_missing_columns()` foi escolhido como caminho rápido para evolução de schema sem precisar gerar migrations a cada mudança. A pasta `alembic/` existe mas a `versions/` está vazia. Em prod com Postgres, mudanças destrutivas (drop, rename) ainda requerem migration manual.

### 5.1 Player (`players`)

```sql
CREATE TABLE players (
    id           VARCHAR PRIMARY KEY,
    slug         VARCHAR(50) UNIQUE NOT NULL,
    name         VARCHAR(200) NOT NULL,
    owner_name   VARCHAR(200) NOT NULL,
    logo_emoji   VARCHAR(10) DEFAULT '🎯',
    is_active    BOOLEAN DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_players_slug ON players(slug);
```

Players seedados: `devclub` (DevClub, owner Rodolfo Mori, 🎓), `ti-na-europa` (TI na Europa, owner Guilherme Soares, 🌍).

### 5.2 Agent (`agents`)

```sql
CREATE TABLE agents (
    id                VARCHAR PRIMARY KEY,
    slug              VARCHAR(50) UNIQUE NOT NULL,
    name              VARCHAR(100) NOT NULL,
    description       TEXT,
    avatar_emoji      VARCHAR(10) DEFAULT '🤖',
    system_prompt     TEXT NOT NULL,
    soul              TEXT,
    is_active         BOOLEAN DEFAULT TRUE,
    provider_type     VARCHAR(50) DEFAULT 'claude_cli',
    provider_config   JSON DEFAULT '{}',
    telegram_topic_id VARCHAR(50),
    created_at        TIMESTAMPTZ NOT NULL,
    updated_at        TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_agents_slug ON agents(slug);
```

5 agentes são seedados (ver §6).

### 5.3 Conversation + Message (`conversations`, `messages`)

```sql
CREATE TYPE message_source AS ENUM ('web', 'telegram', 'api');
CREATE TYPE message_role   AS ENUM ('user', 'assistant', 'system');

CREATE TABLE conversations (
    id           VARCHAR PRIMARY KEY,
    agent_id     VARCHAR NOT NULL REFERENCES agents(id),
    player_id    VARCHAR REFERENCES players(id),
    title        VARCHAR(200),
    source       message_source DEFAULT 'web',
    metadata     JSON DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_conversations_player_id ON conversations(player_id);

CREATE TABLE messages (
    id              VARCHAR PRIMARY KEY,
    conversation_id VARCHAR NOT NULL REFERENCES conversations(id),
    role            message_role NOT NULL,
    content         TEXT NOT NULL,
    tokens_used     JSON DEFAULT '{}',  -- {input, output}
    provider_model  VARCHAR(100),
    created_at      TIMESTAMPTZ NOT NULL
);
```

Cascade: `Conversation.messages` tem `cascade="all, delete-orphan"` ordenado por `created_at`. `Agent.conversations` tem `cascade="all, delete-orphan"` (deletar agente apaga todo histórico). Coluna `metadata` é mapeada como `metadata_` no Python (palavra reservada do SQLAlchemy).

### 5.4 AgentMemory (`agent_memories`)

```sql
CREATE TYPE memory_type   AS ENUM ('correction', 'knowledge', 'pattern', 'preference');
CREATE TYPE memory_source AS ENUM ('user_correction', 'user_explicit', 'agent_extracted',
                                     'manual', 'user_feedback');

CREATE TABLE agent_memories (
    id              VARCHAR PRIMARY KEY,
    agent_id        VARCHAR NOT NULL REFERENCES agents(id),
    player_id       VARCHAR REFERENCES players(id),
    content         TEXT NOT NULL,
    context         TEXT,
    category        VARCHAR(100),
    memory_type     memory_type NOT NULL DEFAULT 'knowledge',
    source          memory_source NOT NULL DEFAULT 'user_correction',
    priority        INTEGER DEFAULT 5,        -- 1-10
    search_text     TEXT NOT NULL,
    times_used      INTEGER DEFAULT 0,
    last_used_at    TIMESTAMPTZ,
    is_active       BOOLEAN DEFAULT TRUE,
    conversation_id VARCHAR,
    created_at      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_agent_memories_agent_id ON agent_memories(agent_id);
CREATE INDEX ix_agent_memories_player_id ON agent_memories(player_id);
```

### 5.5 AgentCron (`agent_crons`)

```sql
CREATE TABLE agent_crons (
    id           VARCHAR PRIMARY KEY,
    agent_id     VARCHAR NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    player_id    VARCHAR REFERENCES players(id),
    name         VARCHAR(100) NOT NULL,
    schedule     VARCHAR(100) NOT NULL,    -- "0 9 * * *" (5-field cron)
    prompt       TEXT NOT NULL,
    is_active    BOOLEAN DEFAULT TRUE,
    last_run_at  TIMESTAMPTZ,
    next_run_at  TIMESTAMPTZ,
    run_count    INTEGER DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_agent_crons_agent_id ON agent_crons(agent_id);
CREATE INDEX ix_agent_crons_player_id ON agent_crons(player_id);
```

### 5.6 InstagramPost (`instagram_posts`)

```sql
CREATE TYPE post_type AS ENUM ('CAROUSEL', 'TWITTER_THREAD');
CREATE TYPE post_status AS ENUM (
    'DRAFT', 'COPY_REVIEW', 'COPY_APPROVED', 'DESIGN_REVIEW', 'DESIGN_APPROVED',
    'CAPTION_REVIEW', 'CAPTION_APPROVED', 'FINAL_REVIEW',
    'READY', 'SCHEDULED', 'NOTIFIED',
    'PUBLISHING', 'PUBLISH_FAILED', 'PUBLISHED', 'REJECTED'
);

CREATE TABLE instagram_posts (
    id                     VARCHAR PRIMARY KEY,
    agent_id               VARCHAR NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    player_id              VARCHAR REFERENCES players(id),
    title                  VARCHAR(500) NOT NULL,
    post_type              post_type DEFAULT 'CAROUSEL',
    status                 post_status DEFAULT 'DRAFT',
    -- Slides
    slides_config          JSON,                  -- list[Slide] (ver §27 apêndice A)
    slides_count           INTEGER DEFAULT 0,
    slides_dir             VARCHAR(500),          -- caminho local: data/instagram/posts/{id}/
    -- Caption
    caption                TEXT,
    first_comment          TEXT,
    hashtags               JSON,                  -- list[str]
    -- Brand snapshot
    brand_config_snapshot  JSON,
    -- Pesquisa
    research_data          JSON,
    source_urls            JSON,                  -- list[str]
    images_metadata        JSON,                  -- por slide: source/credit
    -- Feedback / revisão
    rejection_feedback     TEXT,
    revision_count         INTEGER DEFAULT 0,
    -- Performance pós-publicação
    performance_data       JSON,
    posted_at              TIMESTAMPTZ,
    -- Publicação
    scheduled_at           TIMESTAMPTZ,
    published_at_real      TIMESTAMPTZ,
    publish_error          TEXT,
    manus_task_id          VARCHAR(100),
    manus_task_url         VARCHAR(500),
    -- Telegram (legacy)
    notified_at            TIMESTAMPTZ,
    telegram_message_id    VARCHAR(100),
    -- Fila
    queue_position         INTEGER,
    -- Referências
    conversation_id        VARCHAR REFERENCES conversations(id) ON DELETE SET NULL,
    created_at             TIMESTAMPTZ NOT NULL,
    updated_at             TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_instagram_posts_agent_id ON instagram_posts(agent_id);
CREATE INDEX ix_instagram_posts_player_id ON instagram_posts(player_id);
```

### 5.7 YouTubeProject (`youtube_projects`)

```sql
CREATE TYPE project_status AS ENUM (
    'DRAFT', 'TRANSCRIBING', 'TRANSCRIBED',
    'IDEATION', 'IDEATION_REVIEW',
    'GENERATING_THUMBS', 'THUMBS_REVIEW',
    'FINAL_REVIEW', 'READY', 'SCHEDULED',
    'PUBLISHING', 'PUBLISHED', 'PUBLISH_FAILED',
    'REJECTED', 'FAILED'
);

CREATE TABLE youtube_projects (
    id                       VARCHAR PRIMARY KEY,
    agent_id                 VARCHAR NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    player_id                VARCHAR REFERENCES players(id),
    status                   project_status DEFAULT 'DRAFT',
    error                    TEXT,
    progress_step            VARCHAR(200),
    progress_pct             INTEGER DEFAULT 0,
    -- Source
    drive_url                VARCHAR(1000) NOT NULL,
    drive_file_id            VARCHAR(200),
    local_video_path         VARCHAR(500),
    video_duration_s         INTEGER,
    video_size_mb            INTEGER,
    -- Transcrição
    transcript               TEXT,
    transcript_summary       TEXT,
    key_moments              JSON,                  -- list[{timestamp, description}]
    -- Ideação
    title_options            JSON,                  -- list[str] (5 candidatos)
    top_3_titles             JSON,                  -- list[str] (top 3 escolhidos pela IA)
    chosen_title             VARCHAR(500),
    description              TEXT,
    tags                     JSON,                  -- list[str]
    chapters                 JSON,                  -- list[{timestamp, title}]
    cited_videos             JSON,                  -- list[{timestamp, video_id, title, url}]
    end_screen_videos        JSON,                  -- list[{video_id, title, reason}]
    -- Thumbnails
    thumbnail_concepts       JSON,                  -- list[ThumbConcept]
    thumbnail_paths          JSON,                  -- list[str]
    chosen_thumbnail_idx     INTEGER,
    chosen_thumbnail_path    VARCHAR(500),
    use_creator_face         BOOLEAN DEFAULT FALSE,
    creator_face_refs        JSON,                  -- list[path]
    -- Publicação
    youtube_video_id         VARCHAR(100),
    youtube_url              VARCHAR(500),
    scheduled_at             TIMESTAMPTZ,
    published_at             TIMESTAMPTZ,
    publish_error            TEXT,
    -- Studio automation
    ab_test_status           VARCHAR(50),  -- PENDING | SUCCESS | FAILED
    ab_test_error            TEXT,
    end_screen_status        VARCHAR(50),
    end_screen_error         TEXT,
    pinned_comment_text      TEXT,
    pinned_comment_id        VARCHAR(200),
    pinned_comment_status    VARCHAR(50),  -- POSTED | PINNED | FAILED
    pinned_comment_error     TEXT,
    title_ab_status          VARCHAR(50),
    title_ab_error           TEXT,
    -- Review loop
    rejection_feedback       TEXT,
    revision_count           INTEGER DEFAULT 0,
    created_at               TIMESTAMPTZ NOT NULL,
    updated_at               TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_youtube_projects_agent_id ON youtube_projects(agent_id);
CREATE INDEX ix_youtube_projects_player_id ON youtube_projects(player_id);
```

### 5.8 BrandConfig (`brand_configs`)

Configuração de marca (logo, cores, fontes, handle, badge, voz, tema default) por agente/player. Snapshot é congelado em `instagram_posts.brand_config_snapshot` no momento da criação do post para preservar consistência mesmo se a marca mudar depois.

### 5.9 PlayerConfig (`player_configs`)

Configurações sensíveis por player (chaves API distintas, refresh tokens, IDs de canais/contas). Permite dois players coexistirem com contas diferentes de YouTube/Instagram.

### 5.10 ToolInvocation (`tool_invocations`)

Log de cada execução de tool (Bash etc.) feita pelo Claude CLI durante streaming. Capturada via `provider.last_tool_events` e gravada por `services/tool_logger.record_invocation()`.

```sql
CREATE TABLE tool_invocations (
    id              VARCHAR PRIMARY KEY,
    conversation_id VARCHAR NOT NULL,
    agent_id        VARCHAR NOT NULL,
    message_id      VARCHAR,
    tool_name       VARCHAR(100) NOT NULL,    -- "Bash", "Read", etc.
    input_text      TEXT,
    output_text     TEXT,
    status          VARCHAR(20) NOT NULL,     -- success | error | incomplete
    latency_ms      INTEGER,
    created_at      TIMESTAMPTZ NOT NULL
);
```

### 5.11 VideoTracking (`video_tracking`)

Acompanha métricas de vídeos YouTube específicos ao longo do tempo (cada checagem cria snapshot). Pode estar atrelada a um cron.

### 5.12 Cascades e integridade

- Apagar Agent → cascata em Conversations, Memories, Crons, InstagramPosts, YouTubeProjects.
- Apagar Conversation → cascata em Messages.
- Conversation referenciada por InstagramPost: `ON DELETE SET NULL` (post sobrevive).
- Player não tem cascade — apagar player deixa entidades órfãs (decisão consciente: protege contra perda acidental). Para limpar, deve-se primeiro deletar manualmente os filhos.

---

## 6. Sistema de Agentes

### 6.1 BaseAgent (interface ABC)

`backend/app/agents/base.py`:

```python
from abc import ABC
from typing import AsyncIterator
from app.providers.base import BaseLLMProvider, LLMMessage, LLMResponse


class BaseAgent(ABC):
    """Base class for all agents."""

    slug: str = ""
    name: str = ""
    description: str = ""
    avatar_emoji: str = "🤖"

    def __init__(self, provider: BaseLLMProvider, system_prompt: str = ""):
        self.provider = provider
        self._system_prompt = system_prompt

    @property
    def system_prompt(self) -> str:
        return self._system_prompt

    async def chat(self, messages: list[LLMMessage]) -> LLMResponse:
        return await self.provider.chat(messages, self.system_prompt)

    async def stream(self, messages: list[LLMMessage]) -> AsyncIterator[str]:
        async for chunk in self.provider.stream(messages, self.system_prompt):
            yield chunk

    def format_history(self, messages: list[dict]) -> list[LLMMessage]:
        return [LLMMessage(role=m["role"], content=m["content"]) for m in messages]
```

Cada classe filha define `slug`, `name`, `description`, `avatar_emoji` como atributos de classe e nada mais — toda a lógica vive em `BaseAgent`. As pastas dos agentes contêm 3 arquivos:

- `agent.py` — classe que herda de `BaseAgent`
- `soul.py` — constante `SOUL` (ou `<SLUG>_SOUL`) com identidade/personalidade
- `system_prompt.py` — constante `SYSTEM_PROMPT` (ou `<SLUG>_SYSTEM_PROMPT`) com instruções técnicas

### 6.2 Registry (`backend/app/core/agent_registry.py`)

```python
AGENT_CLASSES = {
    "ad-creative":       AdCreativeAgent,
    "ceo-advisor":       CEOAdvisorAgent,
    "copymaster":        CopyMasterAgent,
    "instagram-content": InstaContentAgent,
    "youtube-growth":    YouTubeGrowthAgent,
}

def get_agent_class(slug: str): return AGENT_CLASSES.get(slug)
def list_available_agents() -> list[dict]: ...
```

O slug aqui precisa bater com `Agent.slug` no banco. Quando `get_agent_class()` retorna `None`, o sistema cai em `BaseAgent` puro (mas sem persona específica) — útil para criar agentes 100% configuráveis via UI sem código.

### 6.3 Os 5 agentes hoje

#### CEO Advisor — `ceo-advisor` 🧠

- **Persona** (Soul): conselheiro estratégico pessoal, board advisor com skin in the game. Tom direto, bottom-line-up-front. Frameworks EOS, Hormozi, Collins.
- **Domínio**: decisões estratégicas, gestão de pessoas, análise financeira, produto, growth, operações.
- **Tools**: nenhum.
- **Crons**: nenhum.
- **Comportamento**: começa SEMPRE com a recomendação, depois racional/riscos/próximos passos. Nunca responde "depende" sem explorar cenários. Nunca ignora impacto financeiro.

#### ViralDev — `youtube-growth` 🚀

- **Persona**: growth hacker obsessivo do canal YouTube DevClub. Conhece métricas, fórmulas virais, psicologia de thumbnail, o canal `@rodolfomori` (232k subs).
- **Tools**: `Bash(curl:*)` habilitado — pode chamar `/api/youtube/...` para atualizar título de vídeo, postar comentário, fixar comentário etc.
- **Crons** (seedados, inativos por padrão): `daily-status` (09:00 SP), `reply-comments` (06:00 SP), `content-ideas` (segunda 06:00), `performance-check` (a cada 3h).
- **Browser**: usa Playwright via `studio_automator` para A/B test de título e end screen.

#### InstaCreator — `instagram-content` 📸

- **Persona** (Soul): criador de carrosséis Instagram. Filosofia "Entretenimento PRIMEIRO. Educação vem junto. Venda vem no final." Referência principal: @leandro.varos. Os 5 mandamentos: slide 1 mata ou morre; cliffhangers entre slides; pedir opinião; números chocam; CTA conecta história → seguidor.
- **System Prompt** (extracto): regra crítica de PARAR e ESPERAR resposta do usuário em cada etapa do pipeline (4 etapas: copy → aprovação → slides → caption). Nunca aprovar copy E gerar slides na mesma resposta. Sempre perguntar tipo de post: Carrossel Varos / Dark / Texto Ácido / Post Único. Imagem em todos os slides exceto acid_text. search_query em INGLÊS. Máximo 10 slides (limite Graph API).
- **Tools**: `Bash(curl:*)` para chamar `/api/instagram/posts` etc.
- **Posts existentes**: prompt recebe lista dos últimos 500 posts (buckets recent/older/archive) — proibido repetir tema.

#### CopyMaster — `copymaster` ✍️

- **Persona**: copywriter de conversão. Domínios: emails de vendas, copy de landing page, WhatsApp/SMS de lançamento, headlines A/B.
- **Tools**: nenhum (gera texto puro).
- **Crons**: nenhum.

#### AdMaster — `ad-creative` 🎯

- **Persona**: diretor de criação de performance ads. Meta Ads, Google Ads, scripts de vídeo, copy de lançamento, criativos.
- **Tools**: nenhum.
- **Crons**: nenhum.

### 6.4 Como adicionar um novo agente

Skill `new-agent` (em `.claude/skills/new-agent/SKILL.md`) automatiza isso. Manualmente:

1. Criar pasta `backend/app/agents/{slug}/` com:
   - `__init__.py` (vazio)
   - `soul.py` — `SOUL = """..."""`
   - `system_prompt.py` — `SYSTEM_PROMPT = """..."""`
   - `agent.py` — classe herdando `BaseAgent`:
     ```python
     from app.agents.base import BaseAgent
     class MyAgent(BaseAgent):
         slug = "my-slug"
         name = "MyAgent"
         description = "..."
         avatar_emoji = "🤖"
     ```
2. Registrar em `backend/app/core/agent_registry.py`:
   ```python
   AGENT_CLASSES["my-slug"] = MyAgent
   ```
3. Adicionar seed em `backend/app/core/seed.py` (idempotente — só insere se não existir):
   ```python
   await _seed_agent(
       slug="my-slug", name="MyAgent", description="...",
       avatar_emoji="🤖",
       system_prompt=MY_SYSTEM_PROMPT, soul=MY_SOUL,
       provider_config={"model": "claude-opus-4-20250514", "tools_enabled": False},
   )
   ```
4. (Opcional) Criar tópico no grupo Telegram + setar `telegram_topic_id`.
5. (Opcional) Crons default no seed via `_seed_cron(...)`.

O frontend descobre agentes novos automaticamente via `GET /api/agents`.

---

## 7. Sistema de Memórias (Auto-Aprendizado)

Núcleo do sistema. Após cada resposta do agente, um ciclo assíncrono não-bloqueante decide se aprendeu algo. Essa "aprendizagem" alimenta os próximos prompts do mesmo agente, fazendo-o evoluir com o uso.

### 7.1 Os 4 estágios

```
                  ┌───────────────────────────┐
   query usuário  │       1. RECALL           │   busca por keywords
  ──────────────▶ │  filtra stopwords PT/EN   │   prioriza correções
                  │  ordena priority desc     │   limit 10
                  └────────────┬──────────────┘
                               │ memorias relevantes
                               ▼
                  ┌───────────────────────────┐
                  │   build_full_prompt()     │
                  │ injeta <learned_memories> │
                  └────────────┬──────────────┘
                               │
                               ▼
                  ┌───────────────────────────┐
                  │   Agente responde (LLM)   │
                  └────────────┬──────────────┘
                               │ próxima msg do user
                               ▼
                  ┌───────────────────────────┐
                  │      2. DETECT            │   LLM analisa par
                  │ (msg_anterior, resposta)  │   {is_correction, confidence}
                  └────────────┬──────────────┘
                               │ se confidence >= 0.7
                               ▼
                  ┌───────────────────────────┐
                  │      3. EXTRACT           │   LLM gera memória
                  │ output JSON: content,     │   estruturada
                  │ category, type, priority, │
                  │ search_keywords           │
                  └────────────┬──────────────┘
                               ▼
                  ┌───────────────────────────┐
                  │      4. STORE             │   deduplica
                  │ find_similar() ou cria    │   atualiza priority se existe
                  │ AgentMemory novo          │   commit
                  └───────────────────────────┘
```

### 7.2 RECALL — busca por keywords

Implementação em `backend/app/core/memory_manager.py:recall()`:

1. Extrai keywords do `query` (`text.lower().split()`, filtra stopwords PT+EN, mantém palavras > 2 chars, top 10).
2. Se nenhuma keyword: fallback para top-5 memórias com `priority >= 8`.
3. Busca por `ILIKE` em `search_text` para cada keyword (OR), filtra `is_active=True`.
4. Ordena por `priority DESC, times_used DESC`, limit 10.
5. Garante pelo menos 3 correções de alta prioridade no resultado (se nenhuma veio das keywords, anexa).

**Stopwords** (definidas estáticas):
```
PT: a, o, e, de, do, da, em, um, uma, para, com, nao, que, os, as, por, mais,
    na, no, se, eu, ele, ela, isso, este, esta, como, mas, foi, ao, dos, das,
    seu, sua, ou, ser, quando, muito, nos, tambem, pelo, pela, pode, aqui
EN: the, is, are, was, an, in, on, to, and, or, but, for, with, not, you, he
```

### 7.3 DETECT — LLM detecta correção

`detect_correction(assistant_msg, user_msg, provider) → dict | None`:

Prompt enviado ao LLM (system: "Voce e um detector de correcoes. Responda apenas JSON valido."):

> Analise esta troca de mensagens e determine se o USUARIO esta corrigindo o ASSISTENTE.
>
> Mensagem anterior do assistente: {assistant_message}
> Resposta do usuario: {user_message}
>
> Uma correcao e quando o usuario:
> - Diz que a resposta esta errada ou inadequada
> - Mostra como deveria ter respondido
> - Pede para mudar o tom, abordagem ou conteudo
> - Diz "nao faca X" ou "faca Y ao inves"
> - Da um exemplo de resposta melhor
> - Ensina algo novo que o agente deveria saber
>
> Responda APENAS com um JSON: {"is_correction": true/false, "confidence": 0.0-1.0,
> "correction_type": "tone|content|knowledge|approach|null", "summary": "..."}

Aceita só se `is_correction == true && confidence >= 0.7`.

### 7.4 EXTRACT — LLM extrai memória estruturada

`extract_memory(context, correction, provider) → dict | None`:

Prompt:

> Extraia a licao aprendida desta correcao feita pelo usuario ao assistente.
>
> Contexto: {context}
> Correcao do usuario: {correction}
>
> Crie uma memoria clara e acionavel que o assistente deve seguir no futuro.
>
> JSON: { memory_content (formato: "Quando [situacao], [acao correta]. Exemplo: ..."),
> category, memory_type (correction|knowledge|pattern|preference), priority (1-10),
> search_keywords }

### 7.5 STORE — deduplica e persiste

`store(content, memory_type, source, category, priority, search_text, ...) → AgentMemory`:

1. `_find_similar(content)`: busca primeira memória existente cujo `search_text` contém TODAS as primeiras 5 keywords (AND).
2. Se encontrou: atualiza `content`, escala `priority = max(old, new)`, atualiza `updated_at`. Retorna existente.
3. Senão: cria novo `AgentMemory`, com `search_text` = keywords normalizadas se não fornecido. Add + flush. Retorna novo.

### 7.6 Mark used + auto-boost

Após `recall()` retornar memórias usadas no prompt, `mark_used(memory_ids)` é chamado:
- `times_used += 1`
- `last_used_at = now`
- A cada 5 usos, `priority = min(10, priority + 1)` (boost automático).

### 7.7 Decay de memórias (hygiene)

Cron weekly (domingos 04:00 SP) chama `decay_stale_memories(db)`:
- Memórias `times_used == 0 && created_at < 60d atrás`: `is_active = False`.
- Memórias `last_used_at < 30d atrás && priority > 1`: `priority -= 1` (mínimo 1).

Garante que memórias ruins/irrelevantes saiam do prompt sem precisar deletar.

### 7.8 Feedback explícito (👍/👎)

Endpoint `POST /api/agents/{slug}/chat/feedback` aceita `FeedbackRequest`:

```json
{
  "message_id": "uuid-da-msg-do-assistente",
  "is_positive": true,
  "comment": "gostei do tom direto",
  "section_content": "trecho específico (opcional)"
}
```

Fluxo:
1. Busca `assistant_msg` e a `user_msg` que veio antes (contexto).
2. `extract_feedback_memory(assistant_message, user_message, is_positive, comment, provider)` — LLM gera memória orientada a comportamento (o que fazer / o que evitar).
3. `store()` com:
   - `memory_type = PATTERN` se positivo, `CORRECTION` se negativo
   - `source = USER_FEEDBACK`
   - `priority = 6` se positivo, `8` se negativo
4. Fallback se LLM falhar: armazena texto literal do feedback.

### 7.9 Injeção no prompt

`format_memories_for_prompt(memories)` retorna bloco XML:

```
<learned_memories>

## CORRECOES IMPORTANTES (SEMPRE seguir)
- Quando [situação], [ação correta]. Exemplo: ...
- ...

## CONHECIMENTOS APRENDIDOS
- ...

## PADROES DE COMPORTAMENTO
- ...

## PREFERENCIAS
- ...

</learned_memories>
```

Esse bloco é colocado no fim do prompt completo (depois de soul, brand_context, instructions, api-access, extra_context).

---

## 8. Provider LLM (Plugável)

### 8.1 Interface (`backend/app/providers/base.py`)

```python
@dataclass
class LLMResponse:
    content: str
    model: str
    tokens_input: int = 0
    tokens_output: int = 0
    raw_response: dict | None = None

@dataclass
class LLMMessage:
    role: str           # "user" | "assistant" | "system"
    content: str

class BaseLLMProvider(ABC):
    def __init__(self, config: dict):
        self.config = config

    @abstractmethod
    async def chat(self, messages: list[LLMMessage], system_prompt: str = "") -> LLMResponse: ...

    @abstractmethod
    async def stream(self, messages: list[LLMMessage], system_prompt: str = "") -> AsyncIterator[str]: ...

    @abstractmethod
    async def health_check(self) -> bool: ...
```

### 8.2 ClaudeCLIProvider

`backend/app/providers/claude_cli.py`. Pontos chave:

- **Subprocess** do binário `claude` (Claude Code CLI), não API. Aproveita assinatura Pro/Max.
- **Prompt via stdin** (não argumento) — evita ARG_MAX em conversas longas.
- **Comando montado**:
  ```
  claude -p --model {model} --output-format json --max-turns {n}
         [--tools Bash --allowedTools "{allowed}" --dangerously-skip-permissions]
  ```
- **Timeout**: 600s se tools habilitados, 300s caso contrário.
- **Streaming**: `--output-format stream-json --verbose`. Eventos relevantes:
  - `event.type == "assistant"` + `block.type == "text"` → yield text.
  - `event.type == "assistant"` + `block.type == "tool_use"` → registra `pending_tools[tool_use_id]` (com tool_name, input, started_at) e yields `\n\n> Executando: \`{cmd_text}\`\n\n`.
  - `event.type == "user"` + `block.type == "tool_result"` → casa com pending, calcula latency_ms, push em `self.last_tool_events[]` com {tool_name, input, output, status, latency_ms}.
  - `event.type == "result"` (sem stream) → yield result.
- **Tools incompletos**: se stream foi interrompido, qualquer pending sem result vira evento `status="incomplete"`.
- **Health check**: `shutil.which(self.cli_path) is not None`.
- **Erro Claude CLI**: stderr/stdout combinados em mensagem de erro, levantado como `RuntimeError`.

Config esperado em `provider_config` (JSON na tabela `agents`):

```json
{
  "model": "claude-opus-4-20250514",
  "max_turns": 1,
  "tools_enabled": false,
  "allowed_tools": "Bash(curl:*)",
  "cli_path": "claude"
}
```

### 8.3 Registry

```python
PROVIDER_REGISTRY: dict[str, type[BaseLLMProvider]] = {
    "claude_cli": ClaudeCLIProvider,
}

def get_provider(provider_type: str, config: dict) -> BaseLLMProvider:
    cls = PROVIDER_REGISTRY.get(provider_type)
    if not cls:
        raise ValueError(f"Provider '{provider_type}' nao registrado")
    return cls(config)
```

### 8.4 Como adicionar um novo provider

Skill `new-provider`. Manualmente:

1. Criar `backend/app/providers/{nome}.py` herdando `BaseLLMProvider`.
2. Implementar `chat()`, `stream()`, `health_check()`.
3. Registrar em `__init__.py`:
   ```python
   PROVIDER_REGISTRY["nome"] = NovoProvider
   ```
4. Adicionar suporte UI no `frontend/src/components/agents/ProviderSettings.tsx` (schema do form).

Exemplos planejados (não implementados ainda): `anthropic_api` (chamada direta SDK Anthropic), `openai_api` (fallback OpenAI).

---

## 9. Multi-tenancy (Players)

### 9.1 Conceito

Um Player é uma identidade de marca/criador. Hoje: `devclub` e `ti-na-europa`. A mesma instância serve ambos com:
- Conversas, memórias, posts e projetos isolados via `player_id`.
- Configurações distintas (`PlayerConfig`) — chaves YouTube/Instagram diferentes por player.
- BrandConfig (logo, cores, tom) por player.
- Tema visual (CSS vars) muda dinamicamente no frontend baseado no player ativo.

### 9.2 Header de tenancy

Toda request envia `X-Player-Id: {slug}`. O frontend pega de `localStorage["active-player"]`. O backend resolve em `_resolve_player(db, header_value)`:

```python
async def _resolve_player(db, header_value: str | None) -> Player | None:
    slug = header_value or "devclub"
    result = await db.execute(select(Player).where(Player.slug == slug))
    return result.scalar_one_or_none()
```

`player_id` é então passado para queries que filtram dados.

### 9.3 BrandContext injetado nos prompts

`backend/app/core/brand_context.py` constrói um bloco `<brand-context>` que carrega:
- Nome, owner, emoji da marca.
- Métricas relevantes (seguidores Instagram, subs YouTube).
- ICP, tom de voz, links fixos (typeform, support).
- CTAs configurados por player (em `CTASettings`).

Este bloco entra no prompt antes do `<instructions>` para que o agente personalize sua resposta para a marca certa.

### 9.4 Tema CSS dinâmico (frontend)

`PlayerContext.tsx` aplica CSS vars overrides quando `activePlayer` muda. Variáveis afetadas: `--primary`, `--ring`, `--sidebar-primary`, etc. Há `PLAYER_THEMES` (dark) e `PLAYER_THEMES_LIGHT` (light) com paletas distintas. Um `MutationObserver` no `<html>` detecta toggle dark/light e reaplica.

**Paletas hoje**:
- `devclub`: amber/warm clay (default)
- `ti-na-europa`: blue

---

## 10. Construção de Prompts

`backend/app/core/prompt_builder.py:build_full_prompt()`:

```python
def build_full_prompt(soul, system_prompt, memories, extra_context="", brand_context=""):
    parts = []
    if soul:           parts.append(f"<soul>\n{soul}\n</soul>")
    if brand_context:  parts.append(f"<brand-context>\n{brand_context}\n</brand-context>")

    # Replace localhost por porta efetiva (PORT do Railway ou API_PORT)
    api_port = settings.effective_port or 8000
    api_base = f"http://localhost:{api_port}"
    system_prompt = system_prompt.replace("http://localhost:8000", api_base)
    system_prompt = system_prompt.replace("http://localhost:8080", api_base)

    # Injeta auth header em curl examples
    internal_key = settings.API_SECRET_KEY
    system_prompt = system_prompt.replace(
        'curl -s', f'curl -s -H "X-Internal-Key: {internal_key}"'
    )

    parts.append(f"<instructions>\n{system_prompt}\n</instructions>")

    # Bloco api-access — informa o agente como falar com o backend
    parts.append(
        f"<api-access>\n"
        f"Base URL: {api_base}/api\n"
        f'Header obrigatório: -H "X-Internal-Key: {internal_key}"\n'
        f"Exemplo: curl -s -H \"X-Internal-Key: {internal_key}\" {api_base}/api/...\n"
        f"</api-access>"
    )

    if extra_context:    parts.append(extra_context)
    if memories.strip(): parts.append(memories)

    return "\n\n".join(parts)
```

### 10.1 Ordem dos blocos no prompt final

```
<soul>...</soul>

<brand-context>...</brand-context>

<instructions>...</instructions>

<api-access>...</api-access>

<posts-existentes>...</posts-existentes>   ← apenas para instagram-content

<learned_memories>...</learned_memories>
```

### 10.2 `get_existing_posts_context(agent_id, player_id)`

Apenas para o agente `instagram-content`. Lista TODOS os títulos de posts criados pelo player (limit 500), agrupados em buckets:

- **ÚLTIMOS 30 DIAS** (recent) — proibido repetir
- **30-90 DIAS ATRÁS** (older) — proibido repetir
- **MAIS DE 90 DIAS** (archive) — só reciclar com ângulo 100% diferente

Formato linha: `- [YYYY-MM-DD] Título do post [STATUS]`. Bloco vai dentro de `<posts-existentes>` com avisos `⚠️ NUNCA repita nenhum deles.`.

### 10.3 Quando o prompt é construído

- **Endpoint `/chat`**: para CADA request. `_build_agent_prompt()` chama `MemoryManager.recall(query=request.message)` com o texto da última mensagem.
- **Endpoint `/chat/stream`**: igual ao acima.
- **Cron**: idem, com `query=cron.prompt`.
- **Geração automática (daily-posts)**: não usa MemoryManager (fluxo é orquestrado pelo `ContentSupervisor`), mas usa `build_brand_context()` + `get_existing_posts_context()`.

---

## 11. API REST Completa

Todos os endpoints estão em `backend/app/api/` e são montados em `backend/app/api/router.py` com prefixo `/api`. Auth via JWT (Vault) ou `X-Internal-Key` (para chamadas internas dos próprios agentes). Header de tenancy: `X-Player-Id` (default `devclub`).

### 11.1 Health

| Método | Path | Resposta |
|---|---|---|
| GET | `/api/health` | `{ "status": "ok" }` |

### 11.2 Players

| Método | Path | Descrição |
|---|---|---|
| GET | `/api/players` | Lista players ativos |

### 11.3 Agents

| Método | Path | Descrição |
|---|---|---|
| GET | `/api/agents` | Lista agentes (filtra `is_active`) |
| POST | `/api/agents` | Cria agente |
| GET | `/api/agents/{slug}` | Detalhe |
| PATCH | `/api/agents/{slug}` | Atualiza (todos os campos opcionais) |
| DELETE | `/api/agents/{slug}` | Remove (cascade conversas/memórias/crons) |
| GET | `/api/agents/{slug}/soul` | Lê soul (`{slug, soul}`) |
| PUT | `/api/agents/{slug}/soul` | Atualiza soul |

### 11.4 Chat

| Método | Path | Descrição |
|---|---|---|
| POST | `/api/agents/{slug}/chat` | Sync — request: `{message, conversation_id?, source?}`. Response: `{conversation_id, message: {id, role, content, model, created_at}, learned?: {...}}` |
| POST | `/api/agents/{slug}/chat/stream` | SSE — heartbeat 15s, deadline 600s. Eventos `chunk`, `done`, `error`. Captura tool_invocations e persiste após stream |
| POST | `/api/agents/{slug}/chat/feedback` | Body `FeedbackRequest`. Extrai memória via LLM e armazena (USER_FEEDBACK source) |

### 11.5 Conversations

| Método | Path | Descrição |
|---|---|---|
| GET | `/api/agents/{slug}/conversations` | Lista conversas (filtradas por player) |
| GET | `/api/conversations/{id}` | Detalhe com mensagens |
| DELETE | `/api/conversations/{id}` | Remove (cascade messages) |
| GET | `/api/conversations/{id}/tool-invocations` | Lista tool_invocations (limit 200) |

### 11.6 Memories

| Método | Path | Descrição |
|---|---|---|
| GET | `/api/agents/{slug}/memories` | Filtros: `type`, `category`, `active` |
| POST | `/api/agents/{slug}/memories` | Cria manual |
| PATCH | `/api/agents/{slug}/memories/{id}` | Atualiza |
| DELETE | `/api/agents/{slug}/memories/{id}` | Remove |
| POST | `/api/agents/{slug}/memories/{id}/toggle` | `is_active` flip |

### 11.7 Crons

| Método | Path | Descrição |
|---|---|---|
| GET | `/api/agents/{slug}/crons` | Lista |
| POST | `/api/agents/{slug}/crons` | Cria — agenda no APScheduler imediatamente |
| PATCH | `/api/agents/{slug}/crons/{id}` | Atualiza — re-agenda |
| DELETE | `/api/agents/{slug}/crons/{id}` | Remove (do banco e do scheduler) |
| POST | `/api/agents/{slug}/crons/{id}/toggle` | Pause/resume |
| POST | `/api/agents/{slug}/crons/{id}/run` | Roda agora (background task) |

`CronCreate`: `{ name, schedule (5-field cron), prompt, is_active=true }`.

### 11.8 Instagram

| Método | Path | Descrição |
|---|---|---|
| POST | `/api/instagram/posts` | Cria post |
| POST | `/api/instagram/posts/clone` | Clona post de URL Instagram (oEmbed/HTML → adapta tom → DRAFT) |
| GET | `/api/instagram/posts` | Lista paginada (filtros agent + player) |
| GET | `/api/instagram/posts/{id}` | Detalhe |
| PATCH | `/api/instagram/posts/{id}` | Atualiza |
| DELETE | `/api/instagram/posts/{id}` | Remove |
| POST | `/api/instagram/posts/{id}/generate-slides` | Gera slides do `slides_config` |
| POST | `/api/instagram/posts/{id}/generate-slides/stream` | Idem com SSE de progresso slide-a-slide |
| POST | `/api/instagram/posts/{id}/regenerate-slide/{idx}` | Re-renderiza um slide específico |
| POST | `/api/instagram/posts/{id}/rerender-slide/{idx}` | Re-render sem trocar config (apenas reflow) |
| POST | `/api/instagram/posts/{id}/slides/{idx}/crop` | Aplica crop na imagem do slide |
| GET | `/api/instagram/posts/{id}/slides/{idx}/info` | Metadata do slide (dimensões, src) |
| POST | `/api/instagram/posts/{id}/slides/{idx}/remove-image` | Limpa image do slide |
| DELETE | `/api/instagram/posts/{id}/slides/{idx}` | Apaga slide |
| POST | `/api/instagram/posts/{id}/approve-step` | Avança status (COPY → DESIGN → CAPTION → FINAL) |
| POST | `/api/instagram/posts/{id}/reject` | Rejeita com feedback (volta a status anterior) |
| POST | `/api/instagram/posts/{id}/approve-final` | DRAFT → READY |
| POST | `/api/instagram/posts/{id}/notify` | Notifica Telegram (legacy) |
| POST | `/api/instagram/posts/{id}/mark-posted` | Marca como publicado manualmente |
| POST | `/api/instagram/posts/{id}/publish` | Publica via Manus AI (background) |
| POST | `/api/instagram/posts/{id}/schedule` | Agenda publicação para `scheduled_at` |
| POST | `/api/instagram/posts/{id}/confirm-published` | Manus → confirma estado real |
| POST | `/api/instagram/posts/{id}/retry-publish` | Re-tenta publicação |
| GET | `/api/instagram/kanban` | Retorna posts agrupados por status (formato `KanbanData`) |
| POST | `/api/instagram/search-images` | Busca imagens via image_search service |
| GET | `/api/instagram/brand-config` | Lê BrandConfig do player ativo |
| PUT | `/api/instagram/brand-config` | Atualiza BrandConfig |
| GET | `/api/instagram/posts/{id}/media/{filename}` | Serve PNG do slide |

### 11.9 YouTube (Data API wrapper)

| Método | Path | Descrição |
|---|---|---|
| GET | `/api/youtube/channel` | Stats (subs, views, video_count, uploads_playlist) |
| GET | `/api/youtube/videos?limit=N` | Vídeos recentes com métricas |
| GET | `/api/youtube/videos/{id}` | Detalhes |
| GET | `/api/youtube/videos/{id}/comments` | Comentários |
| GET | `/api/youtube/search?q=` | Busca no canal |
| PATCH | `/api/youtube/videos/{id}` | Atualiza title/description/tags |
| POST | `/api/youtube/videos/{id}/comment` | Posta comentário top-level |
| POST | `/api/youtube/videos/{id}/comments` | Responde comentário |
| POST | `/api/youtube/upload` | Upload orquestrado (Drive → YouTube + thumb + comment pinado) |
| GET | `/api/youtube/analyze/{id}` | Gera prompt de análise (alimenta agente) |
| GET | `/api/youtube/trackings` | Lista trackings ativos |
| POST | `/api/youtube/trackings` | Cria tracking (cria cron interno) |
| DELETE | `/api/youtube/trackings/{id}` | Remove |
| POST | `/api/youtube/trackings/{id}/toggle` | Pause/resume |

### 11.10 YouTube Projects (Kanban)

| Método | Path | Descrição |
|---|---|---|
| GET | `/api/youtube_projects` | Lista |
| GET | `/api/youtube_projects/kanban` | Agrupado por status (`YouTubeKanbanData`) |
| GET | `/api/youtube_projects/{id}` | Detalhe |
| POST | `/api/youtube_projects` | Cria (drive_url + flags) |
| DELETE | `/api/youtube_projects/{id}` | Remove |
| POST | `/api/youtube_projects/{id}/start` | DRAFT → TRANSCRIBING (background) |
| POST | `/api/youtube_projects/{id}/generate-ideas` | TRANSCRIBED → IDEATION (5 títulos + descrição + tags + chapters) |
| POST | `/api/youtube_projects/{id}/approve-ideas` | IDEATION_REVIEW → GENERATING_THUMBS |
| POST | `/api/youtube_projects/{id}/regenerate-thumb/{idx}` | Re-gera thumbnail por conceito |
| POST | `/api/youtube_projects/{id}/approve-thumb` | THUMBS_REVIEW → FINAL_REVIEW |
| POST | `/api/youtube_projects/{id}/approve-final` | FINAL_REVIEW → READY |
| POST | `/api/youtube_projects/{id}/reject` | Rejeição com feedback |
| POST | `/api/youtube_projects/{id}/schedule` | READY → SCHEDULED com `scheduled_at` |
| POST | `/api/youtube_projects/{id}/publish` | READY → PUBLISHING (background) |
| POST | `/api/youtube_projects/{id}/retry` | Re-tenta etapa que falhou |
| POST | `/api/youtube_projects/{id}/retry-step` | Retry de step específico |
| POST | `/api/youtube_projects/{id}/retry-studio` | Retry de Studio automation |
| POST | `/api/youtube_projects/{id}/recompose-description` | Re-gera description com chapters/cited |
| GET | `/api/youtube_projects/brand-faces` | Lista faces do criador |
| POST | `/api/youtube_projects/brand-faces` | Upload de face |
| DELETE | `/api/youtube_projects/brand-faces/{filename}` | Remove |

### 11.11 Browser (Playwright)

| Método | Path | Descrição |
|---|---|---|
| POST | `/api/browser/navigate` | Navega URL |
| POST | `/api/browser/screenshot` | Captura tela base64 |
| POST | `/api/browser/click` | Click em selector |
| POST | `/api/browser/fill` | Preenche input |
| POST | `/api/browser/type` | Digita |
| POST | `/api/browser/press` | Tecla |
| POST | `/api/browser/select` | Selecionar option |
| POST | `/api/browser/text` | Texto de elemento |
| POST | `/api/browser/attribute` | Atributo |
| POST | `/api/browser/content` | HTML completo |
| POST | `/api/browser/evaluate` | Roda JS |
| GET | `/api/browser/tabs` | Lista abas |
| POST | `/api/browser/tabs/new` | Abre aba |
| POST | `/api/browser/tabs/close` | Fecha aba |
| GET | `/api/browser/status` | Status do browser |

### 11.12 Settings, Analytics, CTAs, News, Lego Story, Quick Flow

| Método | Path | Descrição |
|---|---|---|
| GET | `/api/settings` | Lê config (secrets mascarados) |
| PUT | `/api/settings` | Atualiza .env via UI + invalida cache |
| GET | `/api/analytics/tool-impact` | Dashboard de uso de tools (latência, contagem) |
| GET | `/api/analytics/tool-invocations` | Lista bruta |
| GET | `/api/analytics/instagram` | Dashboard analytics IG |
| GET | `/api/agents/{slug}/ctas` | Lista CTAs do agente |
| POST | `/api/agents/{slug}/ctas` | Cria CTA |
| PATCH | `/api/agents/{slug}/ctas/{id}` | Atualiza |
| DELETE | `/api/agents/{slug}/ctas/{id}` | Remove |
| POST | `/api/agents/{slug}/ctas/{id}/toggle` | Toggle |
| GET | `/api/news/tech` | Feed agregado de notícias tech |
| POST | `/api/lego-story/chat` | Construção iterativa de história (chat) |
| POST | `/api/lego-story/generate` | Materializa story em InstagramPost |
| POST | `/api/quick-flow/single` | Cria 1 post do zero (DRAFT) |
| POST | `/api/quick-flow/batch` | Cria N posts em sequência |
| POST | `/api/quick-flow/auto` | Loop full auto (cria + gera slides + caption + READY) com SSE |

---

## 12. Streaming SSE

### 12.1 Fluxo do `POST /api/agents/{slug}/chat/stream`

```
1. _resolve_player(db, X-Player-Id)
2. _setup_chat() — busca/cria conversation, salva user_message, monta history
3. provider = get_provider(provider_type, provider_config)
4. agent_class = get_agent_class(slug) or BaseAgent
5. _build_agent_prompt() — soul + brand_context + system_prompt + memories + posts_context
6. mark_used(memory_ids)  ← memórias usadas no prompt
7. db.commit()
8. event_generator():
   - HEARTBEAT_INTERVAL = 15.0  (segundos)
   - STREAM_TIMEOUT = 600.0     (deadline absoluto)
   - producer task: chama agent.stream() e enfileira chunks
   - consumer loop:
     * a cada 15s sem chunk: yield ": keepalive\n\n" (comentário SSE)
     * chunk: yield data: {"type":"chunk","content":"..."}\n\n
     * DONE:
       - persiste assistant_msg (content acumulado)
       - persiste tool_invocations (provider.last_tool_events)
       - tenta detectar correção (em sessão separada)
       - yield data: {"type":"done","conversation_id":...,"message_id":...,"learned":{}}\n\n
     * erro: yield data: {"type":"error","message":"..."}\n\n
9. StreamingResponse(media_type="text/event-stream")
```

### 12.2 Por que heartbeat de 15s?

Railway/Cloudflare HTTP/2 droppam conexões idle após ~100s. Com agente em geração longa (carrosseis, ideação YouTube), isso causava `HTTP2_PROTOCOL_ERROR`. SSE comments (linhas começando com `:`) são keepalive válidos sem injetar dados visíveis.

### 12.3 Por que deadline 600s?

Hard ceiling do LLM. Se Claude trava em alguma tool ou loop, garante que a conexão é encerrada e o cliente sabe. Acima de 600s = `TimeoutError` capturado e enviado como evento `error`.

### 12.4 Reconexão no frontend

`useChat.ts` mantém timer de inatividade de 45s. Se nenhum chunk chega em 45s, considera conexão morta, aborta o `fetch` e mostra erro. Heartbeat do backend (a cada 15s) reseta o timer de fato (porque navegadores entregam comentários SSE como dados em alguns drivers — mas mesmo se ignorados, ao receber `keepalive` o ReadableStream fica vivo).

### 12.5 Captura de tool_invocations

Durante stream, `ClaudeCLIProvider.stream()` popula `self.last_tool_events: list[dict]`. Após DONE, o consumer lê essa lista e grava cada item via `services/tool_logger.record_invocation()`. Permite ao frontend renderizar `ToolTimeline` com latência e status de cada Bash executado.

---

## 13. Sistema de Crons (APScheduler)

### 13.1 Setup

`backend/app/core/scheduler.py`:

```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler
scheduler = AsyncIOScheduler()
```

Inicializado no `lifespan` do FastAPI:
```python
@asynccontextmanager
async def lifespan(app):
    await init_db()
    await seed_default_agents()
    await start_scheduler()
    yield
    stop_scheduler()
```

### 13.2 Formato cron

5-field padrão Unix com timezone fixa `America/Sao_Paulo`:

```python
def parse_cron_expression(expr: str) -> CronTrigger:
    parts = expr.strip().split()
    if len(parts) != 5:
        raise ValueError(f"Invalid cron expression: '{expr}'")
    return CronTrigger(
        minute=parts[0], hour=parts[1], day=parts[2],
        month=parts[3], day_of_week=parts[4],
        timezone="America/Sao_Paulo",
    )
```

### 13.3 Lifecycle

```
POST /crons → DB.add(cron) → schedule_cron(cron)
                                    │
                                    ▼
                       APScheduler.add_job(execute_cron_job, args=[cron.id])
                                    │
                                    │ no horário
                                    ▼
                       execute_cron_job(cron_id):
                         1. carrega cron + agente do DB
                         2. recall memórias com query=cron.prompt
                         3. build_full_prompt
                         4. provider.chat(messages=[user(cron.prompt)], system=final_prompt)
                         5. salva Conversation(source=API) + 2 Messages (user+assistant)
                         6. cron.last_run_at = now, run_count += 1
                         7. db.commit()
```

### 13.4 Crons globais hard-coded

Além dos crons criados via UI, há jobs sistêmicos registrados em `start_scheduler()`:

| Job ID | Schedule | Função |
|---|---|---|
| `memory-hygiene` | Domingo 04:00 SP | `decay_stale_memories()` em todos os agentes |
| `daily-auto-posts` | Diário 09:00 SP | `generate_daily_posts(player, count=3)` para cada player ativo |
| `instagram-engagement-poller` | A cada hora minuto :17 | `poll_pending_posts()` atualiza `performance_data` de posts publicados |

### 13.5 Posts agendados (one-shot)

Status `SCHEDULED` em InstagramPost dispara um `DateTrigger` (não cron):

```python
async def load_scheduled_posts():
    posts = SELECT FROM instagram_posts WHERE status = SCHEDULED
    for post in posts:
        if utc_dt <= now: publish_immediately(post)
        else: scheduler.add_job(_scheduled_publish, DateTrigger(utc_dt), id=f"publish-{post.id}")
```

Roda no startup. `scheduled_at` é tratado como naive em São Paulo time, convertido pra UTC antes de criar trigger.

---

## 14. Pipeline Instagram (Kanban Carrossel)

### 14.1 Os 15 status

```
                    ┌─────────┐
              ┌────▶│  DRAFT  │ (criado, vazio ou pré-gen)
              │     └────┬────┘
   reject     │          │ pre-generate
   (back)     │          ▼
              │     ┌──────────────┐
              ├────│ COPY_REVIEW  │ (revisar copy)
              │     └────┬─────────┘
              │          │ approve
              │          ▼
              │     ┌──────────────┐
              ├────│ COPY_APPROVED│ (gera slides)
              │     └────┬─────────┘
              │          ▼
              │     ┌──────────────┐
              ├────│ DESIGN_REVIEW│ (revisar slides)
              │     └────┬─────────┘
              │          │ approve
              │          ▼
              │     ┌──────────────────┐
              ├────│ DESIGN_APPROVED │
              │     └────┬─────────────┘
              │          ▼
              │     ┌──────────────────┐
              ├────│ CAPTION_REVIEW  │
              │     └────┬─────────────┘
              │          ▼
              │     ┌──────────────────┐
              ├────│ CAPTION_APPROVED│
              │     └────┬─────────────┘
              │          ▼
              │     ┌──────────────────┐
              ├────│ FINAL_REVIEW    │
              │     └────┬─────────────┘
              │          │ approve
              │          ▼
              │     ┌──────────────────┐
              ├────│      READY      │ (publicar agora ou agendar)
              │     └────┬─────────────┘
              │          │ schedule
              │          ▼
              │     ┌──────────────────┐
              │     │   SCHEDULED     │ (DateTrigger registrado)
              │     └────┬─────────────┘
              │          ▼
              │     ┌──────────────────┐
              │     │   NOTIFIED      │ (Telegram avisado — legacy)
              │     └────┬─────────────┘
              │          │ publish (Manus)
              │          ▼
              │     ┌──────────────────┐
              ├────│   PUBLISHING    │
              │     └────┬─────────────┘
              │          │ confirm
              │          ▼
              │     ┌──────────────────┐
              │     │    PUBLISHED    │
              │     └─────────────────┘
              │
              │     em qualquer ponto:
              ▼
        ┌─────────┐    ┌──────────────────┐
        │REJECTED │    │  PUBLISH_FAILED │
        └─────────┘    └──────────────────┘
```

### 14.2 Schema `slides_config` (JSON)

Lista de slides. Cada slide:

```json
{
  "title": "Texto principal do slide",
  "subtitle": "Texto secundário (opcional)",
  "body": "Texto longo (alguns templates)",
  "image": {
    "search_query": "person coding laptop dark room",   // INGLÊS, descreve foto
    "url": "https://images.unsplash.com/...",            // preenchido após image_search
    "credit": "Photo by John Doe on Unsplash"
  },
  "visual_style": "tweet_thread" | "dark" | "acid_text" | "tweet_single",
  "is_cover": true,            // primeiro slide
  "is_cta": true,              // último slide com call-to-action
  "background_color": "#000000",
  "highlight_color": "#f59e0b"
}
```

Tipos de carrossel (escolhidos pelo agente perguntando ao usuário):

| Tipo | visual_style | Características |
|---|---|---|
| Carrossel Varos | `tweet_thread` | Fundo branco, header avatar+nome+badge verificado, texto preto, imagem real (Unsplash) por slide |
| Carrossel Dark | `dark` | Fundo preto, texto branco, imagens cinematográficas geradas por IA (Gemini) em todos os slides |
| Texto Ácido | `acid_text` | Fundo branco, avatar+nome+@handle, APENAS texto provocativo, SEM imagens |
| Post Único | `tweet_single` | UMA imagem 1080x1350, frase impactante grande |

### 14.3 Etapas do agente (4 fases)

O agente `instagram-content` SEMPRE para após cada etapa e espera resposta:

1. **Etapa 1 — Pesquisa + copy** (status DRAFT → COPY_REVIEW): pergunta tipo de post. Faz pesquisa (research_data). Gera copy de cada slide (`slides_config[].title`/body sem imagem ainda). Status: COPY_REVIEW.
2. **Etapa 2 — Aprovação copy → gera slides** (COPY_REVIEW → COPY_APPROVED → DESIGN_REVIEW): após aprovação humana, agente gera as imagens (image_search ou Gemini), preenche `slides_config[].image`, renderiza PNGs em `data/instagram/posts/{id}/slide_NN.png` via Playwright (`carousel_renderer`). Status: DESIGN_REVIEW.
3. **Etapa 3 — Caption + first comment** (DESIGN_APPROVED → CAPTION_REVIEW): agente escreve `caption` (200-400 palavras) + `first_comment` com hashtags + CTA. Status: CAPTION_REVIEW.
4. **Etapa 4 — Final review** (CAPTION_APPROVED → FINAL_REVIEW): humano revê tudo junto. Aprovação manda para READY.

### 14.4 Pre-Generate Modal

Antes de aprovar de DRAFT/COPY_REVIEW, o frontend abre `PreGenerateSlidesModal` que pede:
- `visual_style` (dropdown)
- `user_instructions` (textarea livre)

Esses dados são passados ao agente para guiar a geração dos slides.

### 14.5 Image Search

`backend/app/services/image_search.py:ImageSearchService.search(query, limit)` tenta fontes em ordem (até retornar resultados):

1. **Unsplash** (se `UNSPLASH_ACCESS_KEY`)
2. **Pexels** (se `PEXELS_API_KEY`)
3. **Pixabay** (se `PIXABAY_API_KEY`)
4. **Google CSE** (se `GOOGLE_CSE_API_KEY`)
5. **Brave Search** (se `BRAVE_SEARCH_API_KEY`)
6. **SerpAPI** (se `SERPAPI_API_KEY`)
7. **Tavily** (se `TAVILY_API_KEY`)

Domain blocklist filtra resultados de stock photo com watermark conhecido.

Cache de busca por slide em `data/instagram/posts/{post_id}/images/` para revisitas (rerender, crop) não dispararem nova busca.

### 14.6 Carousel Renderer

`backend/app/services/carousel_renderer.py:CarouselRenderer`:

1. Browser singleton via `BrowserService.get_instance()` (Playwright chromium headless).
2. Templates HTML+CSS por `visual_style` (tweet_thread, dark, acid_text, tweet_single).
3. Renderiza HTML com slide data, captura screenshot 1080x1350 PNG.
4. Salva em `data/instagram/posts/{id}/slide_NN.png`.

### 14.7 Manus Publisher (publicação real)

`backend/app/services/manus.py`:
- Endpoint público do backend (`BACKEND_PUBLIC_URL`) serve as PNGs dos slides.
- Cria task no Manus com URLs dos slides + caption + scheduled_at.
- Manus posta no Instagram do `INSTAGRAM_USER_ID` (@rodolfomorii) usando token Graph API.
- Backend armazena `manus_task_id`/`manus_task_url`.
- Endpoint `/confirm-published` polla o status do Manus.

### 14.8 Direct Graph API (alternativa)

`backend/app/services/instagram_publisher.py`: publicação direta via Graph API (`INSTAGRAM_ACCESS_TOKEN`) sem passar por Manus. Mais rápido mas menos resiliente (sem retry/scheduling robusto).

### 14.9 Quick Flow

`backend/app/api/quick_flow.py:auto`: cria N posts seguidos com SSE. Para cada post:
1. ContentSupervisor escolhe tema único (não-repetido)
2. Cria DRAFT
3. Gera slides
4. Gera caption
5. Marca READY
6. Emite eventos: `{type: progress | post_done | post_rejected | all_done | error}`

Se falhar, marca como REJECTED e continua o batch.

### 14.10 Brand Config Snapshot

No momento da criação do post, `brand_config_snapshot` clona a `BrandConfig` ativa (logo, cores, handle, fontes). Garante que mudanças posteriores na marca não afetem posts antigos em revisão.

---

## 15. Pipeline YouTube Projects

### 15.1 Os 15 status

```
DRAFT
  │ start
  ▼
TRANSCRIBING ─── falha ──▶ FAILED
  │ ok
  ▼
TRANSCRIBED
  │ generate-ideas
  ▼
IDEATION ─── ok ──▶ IDEATION_REVIEW
                       │ approve
                       ▼
                    GENERATING_THUMBS
                       │ ok
                       ▼
                    THUMBS_REVIEW
                       │ approve
                       ▼
                    FINAL_REVIEW
                       │ approve
                       ▼
                    READY
                       │ schedule (DateTrigger) ou publish (now)
                       ▼
                    SCHEDULED
                       │
                       ▼
                    PUBLISHING ─── falha ──▶ PUBLISH_FAILED
                       │ ok
                       ▼
                    PUBLISHED
                       │ Studio automation roda em background:
                       │   - ab_test (top 3 títulos)
                       │   - end_screen (cited videos)
                       │   - pinned_comment

A qualquer momento: REJECTED (human) ou FAILED (sistema).
```

### 15.2 Etapa 1 — Transcrição

`backend/app/services/video_transcriber.py`:
1. Drive download via `services/drive.py` (service account JSON, link público ou compartilhado).
2. Salva em `local_video_path` (tmp).
3. Captura `video_duration_s`, `video_size_mb`.
4. Transcreve áudio (Claude com áudio ou Gemini Whisper-equivalente).
5. Gera `transcript`, `transcript_summary`, `key_moments` (lista de timestamps relevantes).

### 15.3 Etapa 2 — Ideação

`backend/app/api/youtube_projects.py:generate_ideas()`:
1. Prompt com transcript + summary + key_moments para o agente (`youtube-growth`).
2. Gera 5 títulos candidatos (`title_options`).
3. IA escolhe top 3 para A/B test (`top_3_titles`).
4. Gera `description` rica com:
   - `chapters` (timestamps + títulos)
   - `cited_videos` (vídeos do canal mencionados na transcrição com link)
   - `end_screen_videos` (3 sugestões para end screen baseadas em similaridade)
5. Gera `tags` (10-15 tags relevantes).

### 15.4 Etapa 3 — Thumbnails

`backend/app/services/thumbnail_strategist.py` + `youtube_thumb_generator.py`:
1. Strategist gera 4 conceitos textuais (`thumbnail_concepts`):
   ```json
   {
     "subject": "Rodolfo segurando notebook",
     "hook_text": "FUI DEMITIDO",
     "emotion": "shock",
     "color_palette": ["#ff0000", "#000000", "#ffffff"],
     "composition": "rule of thirds, sujeito esquerda",
     "image_prompt": "...",
     "use_creator_face": true
   }
   ```
2. Generator renderiza 4 PNGs via Gemini ou OpenAI image API.
3. Se `use_creator_face=true`, injeta face refs (`creator_face_refs`) no prompt para consistência.
4. Salva em `data/youtube/{project_id}/thumb_NN.png`.

### 15.5 Etapa 4 — Publicação

1. `services/youtube.py:upload_video(local_video_path, title, description, tags, privacy="private")` (resumable upload via Data API v3).
2. `set_thumbnail(video_id, chosen_thumbnail_path)`.
3. Studio Automator (Playwright em `studio.youtube.com` autenticado via `studio_session.json`):
   - **A/B Test**: cadastra os 3 títulos no Studio Title Experiments → `title_ab_status`.
   - **End screen**: configura end screen com cards apontando para `end_screen_videos` → `end_screen_status`.
   - **Pinned comment**: posta `pinned_comment_text` via Data API e fixa via Studio → `pinned_comment_status`.
4. Atualiza `youtube_video_id`, `youtube_url`, `published_at`.

### 15.6 Brand Faces Library

Endpoint `/api/youtube_projects/brand-faces` permite upload de fotos do criador (rosto). Servidas estaticamente. Quando `use_creator_face=true`, esses paths viram `creator_face_refs` no projeto e são passados ao gerador de thumb (Gemini suporta image conditioning multi-modal).

---

## 16. Telegram Bot

### 16.1 Setup

`backend/app/telegram/bot.py`:

```python
from aiogram import Bot, Dispatcher
bot = Bot(token=settings.TELEGRAM_BOT_TOKEN)
dp = Dispatcher()

async def start_telegram_bot():
    setup_handlers(dp)
    await dp.start_polling(bot)
```

Bot inicializa em `main.py` lifespan se `TELEGRAM_BOT_TOKEN` estiver setado.

### 16.2 Forum Topics (1 agente = 1 tópico)

O grupo Telegram tem **forum topics** habilitado. Cada agente registrado tem um `telegram_topic_id` no banco. `topic_manager.py:get_agent_by_topic_id(topic_id) → Agent | None` faz o lookup.

```python
@dp.message(F.message_thread_id)
async def handle_topic_message(message: Message):
    topic_id = str(message.message_thread_id)
    agent = await get_agent_by_topic_id(topic_id)
    if not agent: return
    # ... build prompt + chat + reply ...
```

### 16.3 Comandos disponíveis

| Comando | Função |
|---|---|
| `/start`, `/help` | Lista agentes e comandos |
| `/agents` | Detalha cada agente registrado |
| `/status` | Health do sistema |
| `/memories` | Top memórias do agente do tópico atual |
| `/remember <texto>` | Cria memória explícita (USER_EXPLICIT, priority 7) |
| `/forget <id>` | Desativa memória |
| `/soul` | Mostra soul do agente do tópico |

### 16.4 Roteamento de mensagens

```
Mensagem chega no tópico X
  → topic_manager.get_agent_by_topic_id(X) → Agent
  → MemoryManager.recall(query=msg.text)
  → build_full_prompt()
  → ClaudeCLIProvider.chat(...)
  → Salva Conversation(source=TELEGRAM, metadata_={chat_id, message_id, topic_id})
  → Envia resposta no tópico (split em chunks de 4096 chars se >4096)
  → Pipeline DETECT/EXTRACT/STORE em background
```

### 16.5 Split de mensagens longas

Telegram limita 4096 chars/mensagem. Helper splitter quebra resposta em parts respeitando markdown (não corta no meio de um bloco de código), envia em sequência.

---

## 17. Frontend — Arquitetura React

### 17.1 App.tsx (rotas + providers globais)

```tsx
<QueryClientProvider client={queryClient}>  {/* staleTime: 30s, retry: 1 */}
  <BrowserRouter>
    <AuthProvider>
      <PlayerProvider>
        <Routes>
          <Route path="/callback" element={<CallbackPage />} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          <Route path="/settings/:agentSlug" element={...} />
          <Route path="/:agentSlug/:conversationId" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
          <Route path="/:agentSlug" element={...} />
          <Route path="/" element={...} />  {/* redireciona pro 1º agente */}
        </Routes>
        <Toaster />  {/* sonner */}
      </PlayerProvider>
    </AuthProvider>
  </BrowserRouter>
</QueryClientProvider>
```

### 17.2 Contexts

**AuthContext.tsx**:
- Inicializa `VaultAuth` (lib/vault-sdk.js) com `vaultUrl`, `clientId`, `redirectUri`.
- Expõe `{ user, loading, login, logout, isAuthenticated, getAccessToken }`.
- `useEffect`: detecta callback OAuth via URL params.
- `onAuthChange`: assina mudanças do SDK.

**PlayerContext.tsx**:
- `players` carregado via `GET /api/players`.
- `activePlayer` lido de `localStorage["active-player"]`.
- `setActivePlayer(slug)`: atualiza estado + localStorage + `X-Player-Id` em todas as requests.
- Aplica CSS vars do tema do player ativo (PLAYER_THEMES dark, PLAYER_THEMES_LIGHT).
- `MutationObserver` no `<html>` reaplica tema quando `.dark` é toggled.

### 17.3 Hooks (TanStack Query)

| Hook | Queries / Mutations |
|---|---|
| `useAgents` | `useAgents()`, `useAgent(slug)`, `useUpdateAgent(slug)` |
| `useChat` | `useChat({agentSlug, conversationId?, onConversationCreated?})` — retorna `{messages, isStreaming, streamingContent, lastLearned, sendMessage, loadMessages, clearMessages}` |
| `useConversations` | `useConversations(slug)`, `useConversation(id)`, `useDeleteConversation()` |
| `useCrons` | CRUD + `useToggleCron`, `useRunCron` |
| `useMemories` | CRUD + `useToggleMemory`, `useSoul(slug)`, `useUpdateSoul` |
| `useYouTube` | `useYouTubeVideos`, `useTrackings`, `useAnalyze`, `useUpdateYouTubeVideo`, `useCreate/Delete/ToggleTracking` |
| `useYouTubeProjects` | Kanban (`refetchInterval: 5s`), `useCreate/Start/GenerateIdeas/ApproveIdeas/RegenerateThumb/ApproveThumb/ApproveFinal/RejectProject/Schedule/Publish/Retry/Delete`, brand faces |
| `useInstagram` | Posts CRUD + `useGenerateSlides`, `useApproveStep`, `useRejectPost`, `useNotifyTelegram`, `useMarkPosted`, brand config |
| `useKanban` | Kanban (`refetchInterval: 10s`), `useApproveCopy/Design/Caption/Final`, `useKanbanReject/Notify/GenerateSlides` |
| `useAnalytics` | `useAnalyticsDashboard()` (staleTime 5min, retry false) |

Padrão: todos invalidam queries por `[queryKey, playerSlug]` quando mutam. Toast (sonner) feedback em todas as mutations.

### 17.4 Componentes principais

#### `Layout`
- Container com sidebar fixa (esquerda, 272px expandido / 56px colapsado) + main area.
- Props: `selectedAgent`, `selectedConversation`, `activeView` (chat | pipeline | memories), callbacks de nav.

#### `Sidebar` (272/56px)
1. **Brand** + search placeholder
2. **Nav tabs**: Conversas (MessageSquare), Pipeline (Kanban), Memórias (BookOpen)
3. **Agents header** + create button
4. **Agents list** (selectable, status indicator)
5. **Recent conversations header**
6. **Recent conversations list** (delete on hover)
7. **User footer**: avatar, collapse toggle, settings, theme toggle, logout
- localStorage: `sidebar-collapsed`, `devclub-theme`

#### `ChatWindow` (router)
Despacha entre 3 modos baseado em agent + activeView:
- `instagram-content` + pipeline → `InstagramWorkspace`
- `youtube-growth` + pipeline → `YouTubeProjectsWorkspace` + sidebar chat
- demais → `StandardChatWindow`

#### `StandardChatWindow`
- Empty state com grid de "agent suggestions" (emoji + label + prompt sugerido)
- Lista de mensagens com streaming
- Quick action bars: AdQuickActions (`ad-creative`), CopyQuickActions (`copymaster`)
- YouTube actions: botões Projects + Videos

#### `InstagramWorkspace`
- Dual-pane: kanban (esquerda) + chat (direita, colapsável, resizable)
- Header tabs: Pipeline / Analytics
- QuickActions bar + QuickFlow (auto-create N posts via SSE)
- localStorage: `insta-chat-collapsed`, `insta-chat-width`, `insta-quickflow-ids`
- Resume broken flows on refresh

#### `KanbanBoard` (Instagram)
9 colunas (status visíveis):
1. Draft (yellow)
2. Copy Review (yellow)
3. Design Review (accent)
4. Caption Review (yellow)
5. Final Review (yellow)
6. Ready (green)
7. Publishing (accent)
8. Published (green)
9. Failed (red)

- Drag & drop (forward = approve, backward = reject)
- Pre-generate modal antes de aprovar draft/copy_review
- Double-click protection no publish (publishingRef set)
- Processing state overlay por card

#### `YouTubeProjectsWorkspace` / `YouTubeKanbanBoard`
9 colunas: Drive, Transcribing, Ideation, Thumbs, Final Review, Ready, Publishing, Published, Failed.

#### `Settings` page (7 tabs por agente)
1. **General** — name, emoji, description, system_prompt, is_active
2. **Soul** — markdown editor com preview
3. **Memories** — lista, filtros, create/toggle/delete
4. **Provider** — provider_type + provider_config (model, tools, allowed_tools)
5. **Image** — image generation provider config
6. **Crons** — CRUD + toggle + run-now
7. **CTAs** — gerenciar calls-to-action por agente

Mais: SystemSettings (chaves API globais via `/api/settings`).

### 17.5 lib/types.ts (resumo)

~40 interfaces:
- `Player`, `AgentInfo`, `MessageInfo`, `ConversationInfo`, `ConversationDetail`
- `ChatResponse`, `StreamEvent`, `LearnedMemory`
- `MemoryInfo`, `MemoryCreate`, `MemoryUpdate`
- `CronInfo`, `CronCreate`, `CronUpdate`
- `VideoInfo`, `TrackingInfo`
- `PostStatus` (15 valores), `InstagramPost`, `KanbanData`, `BrandConfig`, `QuickFlowEvent`
- `YouTubeProjectStatus` (15), `YouTubeProject`, `YouTubeKanbanData`, `ThumbnailConcept`, `BrandFace`

### 17.6 lib/api.ts (resumo)

Cliente HTTP centralizado. Headers default:
- `Authorization: Bearer ${getAccessToken()}` (se autenticado)
- `X-Player-Id: ${localStorage.activePlayer || "devclub"}`

~80 funções organizadas por domínio. SSE em `streamMessage()` (para chat) e `quickFlowAuto()` (para batch).

---

## 18. Tema Visual (Warm Clay)

### 18.1 Tokens (ver `frontend/src/index.css`)

Tema light (default `:root`):
```css
--background: #fbf9f5;     /* cream */
--foreground: #1f1b16;     /* dark brown */
--card: #ffffff;
--primary: #b45309;        /* amber queimado */
--secondary: #f5f1ea;
--accent: #fdf3e3;
--accent-foreground: #7c3f07;
--destructive: #b91c1c;
--border: #ebe4d8;
--ring: #b45309;
--radius: 0.625rem;        /* 10px */
```

Tema dark (`.dark`):
```css
--background: #14110d;     /* very dark brown */
--foreground: #f2ebdc;     /* light cream */
--card: #1c1914;
--primary: #f59e0b;        /* gold */
--accent: #2a2111;
--accent-foreground: #fcd34d;
--destructive: #f87171;
--border: #322d24;
```

Tokens semânticos custom:
```css
--text-subtle, --surface-2, --chip,
--success, --success-soft, --warn, --warn-soft, --danger-soft
```

### 18.2 Fontes

```css
--font-sans: 'Satoshi', 'Inter Variable', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
--font-heading: var(--font-sans);
```

Satoshi via Fontshare CDN (`https://api.fontshare.com/.../satoshi`). Inter Variable via `@fontsource-variable/inter`. JetBrains Mono via Google Fonts.

### 18.3 Animações

```css
@keyframes ch-blink   { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0.3; } }
@keyframes ch-spin    { to { transform: rotate(360deg); } }
@keyframes ch-fade-in { 0% { opacity: 0; transform: translateY(4px); } 100% { opacity: 1; transform: none; } }
@keyframes ch-pulse   { 0% { box-shadow: 0 0 0 0 currentColor; } 70% { box-shadow: 0 0 0 6px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }

--animate-ch-blink: ch-blink 1.2s infinite;
--animate-ch-spin: ch-spin 1s linear infinite;
--animate-ch-fade-in: ch-fade-in 200ms ease-out;
--animate-ch-pulse: ch-pulse 2s infinite;
```

### 18.4 Tema dinâmico por player

`PlayerContext` aplica overrides quando `activePlayer` muda:
- `devclub` → mantém Warm Clay (default)
- `ti-na-europa` → paleta blue (override `--primary`, `--ring`, `--sidebar-primary`, `--accent-foreground`)

Implementado via `document.documentElement.style.setProperty(--primary, ...)`.

---

## 19. Autenticação (Vault SSO)

### 19.1 Vault SSO

Vault é um servidor OAuth interno do ecossistema Rodolfo Mori (`VAULT_URL`, default `http://localhost:4000` dev, prod `https://vault-api-production-5ef1.up.railway.app`).

### 19.2 Frontend OAuth flow

`frontend/src/lib/vault-sdk.js`:

```js
class VaultAuth {
  constructor({ vaultUrl, clientId, redirectUri }) { ... }
  onAuthChange(cb) { ... }
  handleCallback() { /* parse URL params, store tokens */ }
  getUser() { /* retorna { id, email, name, picture } | null */ }
  login() { /* redirect para /authorize do vault */ }
  logout() { /* clear tokens, redirect para login */ }
  refresh() { /* refresh token */ }
  getAccessToken() { /* retorna JWT */ }
}
```

`AuthContext` instancia `VaultAuth` com vars de ambiente, expõe estado via React Context.

`ProtectedRoute` componente wrapper:
```tsx
function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth()
  if (loading) return <Spinner />
  if (!isAuthenticated) { vault.login(); return null }
  return children
}
```

### 19.3 Backend validação JWT

`backend/app/core/auth.py`:

```python
async def get_current_user(authorization: str = Header(None)) -> dict | None:
    if not settings.AUTH_ENABLED: return None
    if not authorization: raise HTTPException(401)
    token = authorization.replace("Bearer ", "")

    # JWKS cache (TTL 1h por padrão)
    jwks = await fetch_jwks(settings.VAULT_URL, ttl=settings.VAULT_JWKS_CACHE_TTL)

    decoded = jwt.decode(token, key=jwks_to_pem(jwks), algorithms=["RS256"], audience="...")
    return { "id": decoded["sub"], "email": decoded["email"], ... }
```

`AUTH_ENABLED=False` em dev → retorna `None` (todos endpoints abertos). `True` em Railway → enforce.

### 19.4 X-Internal-Key (chamadas internas)

Para os agentes (rodando dentro do Claude CLI no mesmo container) chamarem o próprio backend, há um shortcut: header `X-Internal-Key: {API_SECRET_KEY}`. Bypassa OAuth. Esse header é injetado automaticamente em todos os curl examples do prompt do agente via `build_full_prompt()`.

---

## 20. Image Search Multi-source e Geração de Imagens

### 20.1 Image Search (busca de imagens reais)

`backend/app/services/image_search.py:ImageSearchService`:

Ordem de fallback (até retornar resultado):

| # | Fonte | Chave |
|---|---|---|
| 1 | Unsplash | `UNSPLASH_ACCESS_KEY` |
| 2 | Pexels | `PEXELS_API_KEY` |
| 3 | Pixabay | `PIXABAY_API_KEY` |
| 4 | Google CSE | `GOOGLE_CSE_ID` + `GOOGLE_CSE_API_KEY` |
| 5 | Brave Search | `BRAVE_SEARCH_API_KEY` |
| 6 | SerpAPI | `SERPAPI_API_KEY` |
| 7 | Tavily | `TAVILY_API_KEY` |

Output: `list[ImageSearchResult] = [{url, title, source, credit}]`.

**Domain blocklist**: filtra resultados de stock photo com watermark conhecido (shutterstock, getty, etc.). Lista mantida no service.

**Cache por slide**: `data/instagram/posts/{post_id}/images/` armazena resultados recentes (rerender, crop) sem nova chamada.

### 20.2 Image Generation (Gemini / OpenAI)

Para `visual_style: "dark"` (Carrossel Dark) e thumbnails YouTube:

**Gemini 3 Pro Image** (`gemini-3-pro-image-preview`):
- Modelo image-conditioning multi-modal.
- Prompt + reference images (creator face refs).
- API key: `GEMINI_API_KEY`.

**OpenAI gpt-image-2** (alternativa):
- `OPENAI_API_KEY` + `OPENAI_IMAGE_MODEL=gpt-image-2`.
- Quality config: `OPENAI_IMAGE_QUALITY=low|medium|high`.

`backend/app/services/youtube_thumb_generator.py` orquestra: pega `thumbnail_concepts[i]`, monta prompt com `subject + hook_text + emotion + color_palette + composition`, passa ao Gemini com `creator_face_refs` se `use_creator_face=true`.

---

## 21. Variáveis de Ambiente

### 21.1 Lista completa

```bash
# ── Database ──
DATABASE_URL=sqlite+aiosqlite:///./devclub_agents.db
# Em prod (Railway): DATABASE_URL é injetado automaticamente pelo addon Postgres.
# Formato: postgresql+asyncpg://user:pass@host:port/db

# ── Telegram ──
TELEGRAM_BOT_TOKEN=                    # opcional — sem isso o bot não inicia
TELEGRAM_GROUP_ID=                     # ID do grupo com forum topics
TELEGRAM_CEO_TOPIC_ID=0                # legacy (default 0)

# ── Claude CLI ──
CLAUDE_CLI_PATH=claude                 # caminho do binário (precisa estar no PATH)
CLAUDE_CLI_MODEL=claude-opus-4-20250514
CLAUDE_CODE_OAUTH_TOKEN=               # token para auth do CLI (Pro/Max sub)

# ── API ──
API_HOST=0.0.0.0
API_PORT=8000
PORT=                                  # Railway injeta isso (override de API_PORT)
API_SECRET_KEY=change-me-in-production # usado em X-Internal-Key

# ── YouTube ──
YOUTUBE_API_KEY=                       # opcional (read-only operations)
YOUTUBE_CHANNEL_ID=
YOUTUBE_CLIENT_ID=                     # OAuth (write operations)
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REFRESH_TOKEN=                 # gerado uma vez via fluxo OAuth

# ── YouTube fixed links (sempre apêndice em descrições) ──
YOUTUBE_HOSTINGER_URL=https://hostinger.devclub.com.br/
YOUTUBE_HOSTINGER_COUPON=DEVCLUB
YOUTUBE_TYPEFORM_URL=https://rodolfomori.typeform.com/to/rQb1MBt5
YOUTUBE_SUPORTE_URL=https://go.rodolfomori.com.br/suporte
YOUTUBE_CHANNEL_HANDLE=@rodolfomori

# ── Google Drive (download de vídeos brutos) ──
GOOGLE_SERVICE_ACCOUNT_JSON=           # JSON inline ou path para arquivo

# ── Image Search ──
UNSPLASH_ACCESS_KEY=
GOOGLE_CSE_ID=86496c5436f0f428a        # default DevClub
GOOGLE_CSE_API_KEY=
PEXELS_API_KEY=
PIXABAY_API_KEY=
BRAVE_SEARCH_API_KEY=
TAVILY_API_KEY=
SERPAPI_API_KEY=

# ── Image Generation ──
GEMINI_API_KEY=
GEMINI_IMAGE_MODEL=gemini-3-pro-image-preview
GEMINI_VISION_MODEL=gemini-2.5-flash
OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_QUALITY=medium

# ── Instagram ──
INSTAGRAM_ACCESS_TOKEN=                # Graph API (publicação direta)
INSTAGRAM_USER_ID=17841443731910041    # @rodolfomorii (default)
BACKEND_PUBLIC_URL=                    # URL pública do backend (para servir PNGs ao Manus)
MANUS_API_KEY=                         # se usar Manus em vez de Graph direto

# ── Vault SSO ──
AUTH_ENABLED=False                     # True em produção
VAULT_URL=http://localhost:4000
VAULT_JWKS_CACHE_TTL=3600              # segundos

# ── CORS ──
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
FRONTEND_URL=                          # URL Railway do frontend (anexada em CORS)

# ── Frontend (definidos no Railway frontend service) ──
VITE_API_URL=https://your-backend.up.railway.app
VITE_VAULT_URL=https://vault-api-production-5ef1.up.railway.app
VITE_VAULT_CLIENT_ID=your-vault-client-id
VITE_VAULT_REDIRECT_URI=https://your-frontend.up.railway.app/callback
```

### 21.2 Obrigatórias para rodar (mínimo viável)

| Var | Para quê |
|---|---|
| `DATABASE_URL` | Persistência |
| `CLAUDE_CLI_PATH` (default `claude`) | Provider funcionar |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude CLI autenticar |
| `API_SECRET_KEY` | Tools dos agentes funcionarem (X-Internal-Key) |

### 21.3 Opcionais por feature

| Feature | Vars necessárias |
|---|---|
| Telegram bot | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_GROUP_ID` |
| YouTube features | `YOUTUBE_API_KEY` (read), `YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN` (write) |
| Drive download | `GOOGLE_SERVICE_ACCOUNT_JSON` |
| Image search | qualquer uma (Unsplash recomendado) |
| Geração de imagens | `GEMINI_API_KEY` ou `OPENAI_API_KEY` |
| Publicação Instagram direta | `INSTAGRAM_ACCESS_TOKEN` |
| Publicação via Manus | `MANUS_API_KEY` |
| Auth | `AUTH_ENABLED=True`, `VAULT_URL` |

---

## 22. Deploy (Railway + Docker)

### 22.1 Backend Dockerfile

```dockerfile
FROM python:3.12-slim

WORKDIR /app

# System deps: Playwright + Node.js + ffmpeg + fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates fonts-liberation fonts-noto-color-emoji \
    libnss3 libatk-bridge2.0-0 libdrm2 libxcomposite1 libxdamage1 \
    libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 libcups2 \
    libgtk-3-0 libxshmfence1 curl ffmpeg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Claude CLI global
RUN npm install -g @anthropic-ai/claude-code

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Non-root user (Claude CLI bloqueia --dangerously-skip-permissions como root)
RUN useradd -m appuser && mkdir -p /home/appuser/.claude

# gosu para switch root → appuser no entrypoint
RUN apt-get update && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*

# Playwright browsers como appuser
USER appuser
RUN playwright install chromium
USER root

COPY . .

RUN mkdir -p data/instagram/posts assets/images/brand \
    && chown -R appuser:appuser /app /home/appuser \
    && chmod +x entrypoint.sh

EXPOSE 8000
ENV CLAUDE_CODE_OAUTH_TOKEN=""
ENTRYPOINT ["/app/entrypoint.sh"]
```

`entrypoint.sh`:
```bash
#!/bin/bash
set -e
# Fix volume permissions (Railway monta como root)
chown -R appuser:appuser /app/data /app/assets || true
# Exec uvicorn como appuser via gosu
exec gosu appuser uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
```

### 22.2 Frontend Dockerfile (multi-stage)

```dockerfile
# Build stage
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

ENV PORT=80
ENV VITE_API_URL=""
ENV VITE_VAULT_URL=""
ENV VITE_VAULT_CLIENT_ID=""
ENV VITE_VAULT_REDIRECT_URI=""
EXPOSE 80

# Runtime: gera env-config.js com window.__ENV__ a partir das envs
CMD ["/bin/sh", "-c", "echo \"window.__ENV__={...};\" > /usr/share/nginx/html/env-config.js && envsubst '${PORT}' < /etc/nginx/conf.d/default.conf > tmp && mv tmp /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
```

`nginx.conf`:
```nginx
server {
    listen ${PORT};
    root /usr/share/nginx/html;
    index index.html;

    location / { try_files $uri $uri/ /index.html; }   # SPA routing

    location ~* \.(js|css|woff2?|jpg|jpeg|png|svg|webp)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### 22.3 docker-compose.yml (dev local)

```yaml
services:
  backend:
    build: ./backend
    ports: ["8000:8000"]
    env_file: .env
    volumes:
      - ./backend:/app
      - ~/.claude:/root/.claude    # acesso ao Claude CLI do host
    depends_on: [db]
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

  frontend:
    build: ./frontend
    ports: ["5173:5173"]
    volumes:
      - ./frontend:/app
      - /app/node_modules
    command: npm run dev -- --host 0.0.0.0

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: devclub_agents
      POSTGRES_USER: devclub
      POSTGRES_PASSWORD: devclub_secret
    ports: ["5432:5432"]
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

### 22.4 Railway

3 serviços por ambiente:

1. **backend** — Dockerfile, healthcheck `/api/health`, Postgres addon como dependência (DATABASE_URL injetado).
2. **frontend** — Dockerfile, healthcheck `GET /`. Env vars `VITE_*` setadas no Railway dashboard (não no .env do código).
3. **postgres** — addon Railway (gerenciado).

`backend/railway.toml`:
```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
healthcheckPath = "/api/health"
```

`frontend/railway.toml`:
```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
healthcheckPath = "/"
healthcheckTimeout = 30
```

### 22.5 Runtime env injection (frontend)

O frontend é uma SPA estática. Mas precisa de URLs dinâmicas (`VITE_API_URL`, `VITE_VAULT_*`). Solução: o entrypoint do nginx gera `/usr/share/nginx/html/env-config.js` a cada start:

```js
window.__ENV__ = {
  VITE_API_URL: '${VITE_API_URL}',
  VITE_VAULT_URL: '${VITE_VAULT_URL}',
  ...
};
```

`index.html` carrega esse script ANTES de `main.tsx`. `lib/env.ts`:
```ts
export const env = {
  VITE_API_URL: window.__ENV__?.VITE_API_URL || import.meta.env.VITE_API_URL,
  ...
};
```

Isso permite trocar o backend URL sem rebuild — basta restart do container com env diferente.

---

## 23. Como Rodar Localmente (Setup Completo)

### 23.1 Pré-requisitos

- **Python 3.12** (instalado via `pyenv` ou homebrew)
- **Node.js 20** (`nvm install 20`)
- **Claude Code CLI** (`npm install -g @anthropic-ai/claude-code`) com login feito (`claude login`)
- **ffmpeg** (`brew install ffmpeg` — para video transcription)
- **Git** + **Docker** (opcional para Postgres local)

### 23.2 Clone e setup

```bash
git clone <repo>
cd agentesclub

# 1. Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
playwright install chromium

cd ..
cp .env.example .env
# editar .env com chaves mínimas

# 2. Frontend
cd frontend
npm install
cd ..
```

### 23.3 Variáveis mínimas (.env)

```bash
DATABASE_URL=sqlite+aiosqlite:///./devclub_agents.db
CLAUDE_CLI_PATH=claude
API_PORT=8000
API_SECRET_KEY=local-dev-key
AUTH_ENABLED=False
VITE_API_URL=http://localhost:8000
```

### 23.4 Iniciar

Dois terminais:

```bash
# Terminal 1 — Backend
cd backend
source venv/bin/activate
uvicorn app.main:app --reload
# logs: "DevClub Agent Hub ready" — banco criado, agentes seedados, scheduler ativo
```

```bash
# Terminal 2 — Frontend
cd frontend
npm run dev
# abre em http://localhost:5173
# proxy /api → http://localhost:8000 já configurado em vite.config.ts
```

Ou tudo via docker-compose:
```bash
docker-compose up
```

### 23.5 Teste end-to-end

1. Abrir `http://localhost:5173`
2. Selecionar agente "CEO Advisor" na sidebar
3. Mandar: "Qual deve ser a prioridade #1 do DevClub este mês?"
4. Ver resposta streaming (SSE)
5. Em Settings → Memories: ver memórias seedadas (se houver)
6. Em Settings → Crons: criar um cron de teste `*/5 * * * *` (a cada 5 min) com prompt "Olá"
7. Aguardar 5 min — ver nova conversa criada com source `API`

### 23.6 Testar pipeline Instagram

1. Ir em "InstaCreator" agente
2. Clicar em Pipeline (Kanban view)
3. Quick Actions → "Criar carrossel"
4. Escolher tipo no chat (1 — Varos)
5. Aprovar copy → modal Pre-Generate → escolher visual_style → Aprovar
6. Aguardar geração de slides (status DESIGN_REVIEW)
7. Aprovar design → caption → final → READY
8. Clicar Schedule ou Publish

### 23.7 Acompanhar logs

```bash
tail -f backend/logs/*.log    # se loguru gravar em arquivo
# ou stdout do uvicorn no terminal
```

Filtrar erros: `grep ERROR` no output do uvicorn.

---

## 24. Testes

### 24.1 Framework

`pytest` + `pytest-asyncio`. Configurado em `pytest.ini` (ou `pyproject.toml`).

### 24.2 conftest.py

`backend/tests/conftest.py`:
- Fixture `db` — async session conectado a SQLite in-memory.
- Fixture `client` — `httpx.AsyncClient(transport=ASGITransport(app=app))`.
- Mocks de provider — `MockProvider` que retorna respostas pré-definidas (nunca chama Claude real).

### 24.3 Testes existentes

| Arquivo | Cobertura |
|---|---|
| `test_agents.py` | Atributos do BaseAgent, registry (5 agentes registrados), criação no DB |
| `test_api.py` | `/api/health`, list/get agents, criar conversa, listar memórias |
| `test_providers.py` | `get_provider("claude_cli")` retorna instância correta, `health_check()`, build_prompt |

### 24.4 Rodar

```bash
cd backend
source venv/bin/activate
pytest                       # tudo
pytest tests/test_agents.py  # só agentes
pytest -v -s                 # verbose + show prints
pytest --cov=app             # cobertura (pytest-cov, opcional)
```

### 24.5 Regra: nunca chamar Claude real

Testes que envolvam LLM devem mockar `BaseLLMProvider`. Exemplo:

```python
class StubProvider(BaseLLMProvider):
    async def chat(self, messages, system_prompt=""):
        return LLMResponse(content="resposta mock", model="stub")
    async def stream(self, messages, system_prompt=""):
        for chunk in ["resp", "osta", " mock"]:
            yield chunk
    async def health_check(self): return True
```

---

## 25. Hooks e Skills do Claude Code (.claude/)

### 25.1 settings.json

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "file=\"$CLAUDE_FILE_PATH\"; case \"$file\" in *.py) cd backend && python -m py_compile \"$file\" 2>&1 || true ;; *.tsx|*.ts) cd frontend && npx tsc --noEmit 2>&1 | head -20 || true ;; esac",
        "timeout": 15
      }]
    }]
  }
}
```

Hook automático: a cada Write/Edit em `.py` → `python -m py_compile`. Em `.ts/.tsx` → `tsc --noEmit` (top 20 erros).

### 25.2 .claude/agents/

Perfis especializados de agentes Claude para tasks específicas:

- **backend-architect** — FastAPI, SQLAlchemy async, Pydantic. Modelo Sonnet 4.
- **telegram-specialist** — aiogram 3.x, message routing por thread_id, split de chunks.
- **frontend-builder** — React 18, TypeScript strict, Tailwind, shadcn/ui, TanStack Query. SSE via fetch + ReadableStream. Componentes <150 linhas.

### 25.3 .claude/rules/

- **python.md** — async/await em I/O, type hints, docstrings, loguru (não print), asyncio.sleep (não time.sleep), import order isort.
- **react.md** — functional components, shadcn/ui (não HTML cru), TanStack Query, cn(), interface PascalCase, sem inline styles, handlers `handleX`.

### 25.4 .claude/commands/

- **test-agent** — testa agente end-to-end (find no registry, send message, verify response, check conversation, report tokens/timing).
- **status** — health check de todos os serviços (backend, frontend, db, telegram bot, agentes registrados).
- **deploy-check** — pre-deploy: pytest + tsc + npm build + .env vars + migrations + docker-compose válido.

### 25.5 .claude/skills/

- **new-agent** — automatiza criação de agente: cria pasta com 3 arquivos, registra em agent_registry, opcionalmente seed + telegram topic.
- **new-provider** — cria classe BaseLLMProvider, implementa chat/stream/health_check, registra no PROVIDER_REGISTRY, atualiza UI.

### 25.6 .mcp.json (MCP servers)

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres",
               "postgresql://devclub:devclub_secret@localhost:5432/devclub_agents"]
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "./"]
    }
  }
}
```

Usado quando se roda `claude --mcp-config .mcp.json` localmente — dá acesso direto ao Postgres + filesystem ao Claude para debugging.

---

## 26. Roadmap / Funcionalidades Planejadas

Especificações em arquivos `.md` na raiz:

### 26.1 `project_educational_carousel.md`

Novo template de carrossel para conteúdo técnico/didático. Visual style: backgrounds coloridos sólidos (azul, verde, vermelho, laranja, navy), títulos enormes (70-90px), cards com bordas arredondadas + bg semi-transparente, emojis como ícones, grid layouts. 6 tipos de slide: Capa, Texto Puro, Grid de Cards, Lista com Cards, Infográfico, CTA. `visual_style: "educational"`.

Status: spec, não implementado.

### 26.2 `project_instagram_dashboard.md`

Dashboard de analytics Instagram em tempo real. Métricas: likes/comments/saves/shares/reach/impressions por post, follower growth, melhores posts (mês/ano), engagement rate, account-level metrics. Usa Instagram Graph API com IG User ID `17841443731910041` e permissão `instagram_manage_insights`. Frontend: nova tab no InstagramWorkspace.

Status: parcial — `AnalyticsDashboard` component existe mas com dados básicos.

### 26.3 `project_slide_review_agent.md`

Slide review automático antes de gerar próximo slide. Workflow: gera slide N → envia PNG para review agent (Claude vision) → checa qualidade/relevância/watermarks → aprova ou rejeita com feedback → se rejeitado, re-search/re-render. Motivação: muitos slides têm imagens irrelevantes ou com watermark; review manual é tedioso.

Status: spec, não implementado. Implementação prevista em `instagram.py:generate_slides()` middleware.

### 26.4 ICP TI na Europa

`ti na europa/` contém:
- 5 PDFs de sessões estratégicas
- ICP definido (DOCX)
- Tom de voz Guilherme (DOCX)
- Transcrições de depoimentos
- Landing page

Material para futuro agente especializado em lead generation para profissionais de TI no exterior.

---

## 27. Apêndices

### Apêndice A — Exemplo completo de `slides_config` JSON

Para um Carrossel Varos sobre "História do Daniel Ek (Spotify)":

```json
[
  {
    "is_cover": true,
    "title": "Ele ouviu NÃO 100 vezes.",
    "subtitle": "Hoje vale US$ 80 BILHÕES.",
    "image": {
      "search_query": "Daniel Ek Spotify CEO portrait photo",
      "url": "https://images.unsplash.com/...",
      "credit": "Photo by John Doe / Unsplash"
    },
    "visual_style": "tweet_thread"
  },
  {
    "title": "23 anos. Sueco. Sem dinheiro.",
    "body": "Ele tinha uma ideia: streaming de música legal.",
    "image": { "search_query": "Stockholm Sweden cityscape young entrepreneur" },
    "visual_style": "tweet_thread"
  },
  {
    "title": "As gravadoras DETESTARAM.",
    "body": "100 reuniões. 100 NÃO. Cada uma. Mais grosseira que a anterior.",
    "image": { "search_query": "record labels vinyl records music industry executives" },
    "visual_style": "tweet_thread"
  },
  {
    "title": "Mas ele não desistiu.",
    "body": "Ofereceu equity. Streaming GRATUITO. Compartilhou os lucros.",
    "image": { "search_query": "businessman handshake deal contract signing office" },
    "visual_style": "tweet_thread"
  },
  {
    "title": "2008 — Spotify nasceu.",
    "body": "100 milhões de usuários em 5 anos. Hoje? **3 BILHÕES** alcançados.",
    "image": { "search_query": "Spotify app interface music streaming smartphone" },
    "visual_style": "tweet_thread"
  },
  {
    "is_cta": true,
    "title": "Você está ouvindo NÃO?",
    "body": "Bom. Você está no caminho certo.",
    "subtitle": "Comenta EU QUERO se você também é programador iniciando.",
    "image": null,
    "visual_style": "tweet_thread"
  }
]
```

### Apêndice B — Exemplo de cron schedules (5-field)

```
0 9 * * *           todo dia às 09:00 SP
0 6 * * 1           toda segunda às 06:00 SP
*/30 * * * *        a cada 30 minutos
0 */3 * * *         a cada 3 horas (00:00, 03:00, 06:00, ...)
0 0 1 * *           todo dia 1º do mês à meia-noite
0 17 * * 5          toda sexta às 17:00 SP
*/5 9-17 * * 1-5    a cada 5 min, 9h-17h, dias úteis
```

Timezone fixo `America/Sao_Paulo`. APScheduler converte internamente.

### Apêndice C — Memórias seedadas por agente

Para reprodução exata, ver `backend/app/core/seed.py`. Estrutura:

```python
await _seed_memory(
    agent_id=agent.id,
    content="Quando o usuário pedir análise estratégica, sempre comece pela recomendação.",
    memory_type=MemoryType.PATTERN,
    source=MemorySource.MANUAL,
    priority=8,
    category="format",
    search_text="analise estrategica recomendacao"
)
```

Hoje o seed foca em criar agentes + crons. Memórias são acumuladas via uso real.

### Apêndice D — Diagramas de transição de status

#### D.1 Instagram Post

Forward path:
```
DRAFT → COPY_REVIEW → COPY_APPROVED → DESIGN_REVIEW → DESIGN_APPROVED →
CAPTION_REVIEW → CAPTION_APPROVED → FINAL_REVIEW → READY →
{ SCHEDULED → NOTIFIED → PUBLISHING → PUBLISHED }
                                  ↓
                            PUBLISH_FAILED
```

Backward (reject) volta uma etapa, registra `rejection_feedback` e incrementa `revision_count`. Em qualquer ponto pode ir para `REJECTED` (kill switch).

#### D.2 YouTube Project

```
DRAFT → TRANSCRIBING → TRANSCRIBED → IDEATION → IDEATION_REVIEW →
GENERATING_THUMBS → THUMBS_REVIEW → FINAL_REVIEW → READY →
{ SCHEDULED → PUBLISHING → PUBLISHED }
                        ↓
                  PUBLISH_FAILED
```

`FAILED` (sistema) e `REJECTED` (humano) são terminais alternativos.

### Apêndice E — Glossário

| Termo | Definição |
|---|---|
| **Agente** | Entidade com Soul + System Prompt + Provider configurado. 5 hoje: ceo-advisor, youtube-growth, instagram-content, copymaster, ad-creative. |
| **Soul** | Identidade do agente (quem ele É). Texto livre, normalmente em PT, define personalidade, valores, limites. |
| **System Prompt** | Instruções técnicas do agente (o que ele FAZ, como, com quais tools). |
| **Brand Context** | Bloco injetado no prompt com dados do player ativo (handle, métricas, ICP, voz). |
| **Player** | Identidade de marca/criador. Multi-tenancy. Hoje: devclub, ti-na-europa. |
| **Memory** | Lição aprendida. 4 tipos × 5 sources × prioridade 1-10. Injetadas no prompt em `<learned_memories>`. |
| **Cron** | Job APScheduler 5-field cron + timezone SP. Executa prompt configurado e salva como Conversation. |
| **Pipeline** | Fluxo de produção com status (Instagram: 15, YouTube: 15) com aprovação humana etapa-a-etapa. |
| **Tool Invocation** | Cada Bash/curl executado pelo Claude CLI durante streaming. Logado para auditoria. |
| **Quick Flow** | Geração automática em batch (N posts via SSE) sem interação humana. |
| **Lego Story** | Construção iterativa de história via chat que materializa em InstagramPost. |
| **Manus** | Serviço externo de scheduling/publishing Instagram (alternativa à Graph API direta). |
| **Studio Automator** | Playwright automation de studio.youtube.com (A/B test, end screen, pinned comment). |
| **Brand Faces** | Library de fotos do criador para conditioning de geração de thumbnails. |
| **Vault** | Servidor OAuth interno Rodolfo Mori. AUTH_ENABLED toggle. |
| **X-Player-Id** | Header de tenancy. Default `devclub`. |
| **X-Internal-Key** | Header secreto para chamadas internas dos agentes ao backend. |
| **ContentSupervisor** | Orquestrador da geração automática de carrosséis (`generate_daily_posts`). |
| **slides_config** | JSON do carrossel: lista de slides com title/body/image/visual_style/is_cover/is_cta. |
| **visual_style** | tweet_thread (Varos branco), dark (preto+IA), acid_text (puro texto), tweet_single (single image). |

---

> **Última atualização**: 2026-04-26
> **Mantido em**: `/Users/rodolfomori/Dev/vault-dev/agentesclub/RESUMO-TECNICO.md`
> **Reproduzido a partir de**: leitura dos arquivos de código-fonte do repo (não de documentação prévia, que estava desatualizada).
