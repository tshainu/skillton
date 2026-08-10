# Skillton — Design

AI Recruitment Intelligence Platform for recruitment agencies. Ships on **web** (desktop-first, tablet supported). Visual direction: **premium black + orange enterprise dashboard** — dark, dense, glassmorphic cards, sharp orange accents used only for CTAs, active states and key data highlights. Core job: upload a JD and a stack of CVs, and the platform tells you who to interview and why.

## Brand & Colors

Tokens live as CSS variables in `packages/web/src/web/styles.css`. The app is **dark-only** (no light mode toggle) per the PRD.

| Token | Hex | Use |
|-------|-----|-----|
| primary (orange) | `#FF6B2B` | CTAs, active nav, key metrics, chart accent 1 |
| primary-hover | `#FF8550` | Hover state |
| primary-light | `#FF9E74` | Subtle accent text |
| primary-dark | `#E55A1C` | Pressed state |
| background | `#0D0D0D` | Page background (dominant) |
| card | `#1A1A1A` | Cards / surfaces (with 6% white glass overlay + blur) |
| border | `#262626` | Hairlines |
| border-hover | `#333333` | Hover hairlines |
| foreground | `#FFFFFF` | Primary text |
| muted-foreground | `#A3A3A3` | Secondary text |
| success | `#10B981` | Selected / hired / passing scores |
| danger | `#EF4444` | Rejected / blacklisted / failures |
| warning | `#F59E0B` | Hold / expiring scores |
| info | `#3B82F6` | Tech interview / neutral status |

**Rule:** orange is never a page background and never body text. Black dominates, white is primary text. No metallic or yellow undertones — this is black and orange, not black and gold.

## Typography

- **Display**: `Sora` (600/700) — page titles, KPI numbers, section headings.
- **Body/UI**: `Poppins` (400/500/600) — everything else.
- **Numeric/mono**: `JetBrains Mono` — scores, IDs, transcript timestamps.
- Loaded from Google Fonts in `styles.css`. Generous line height (1.6 body), tight tracking on display.

## Status Tag System (from PRD)

| Tag | Color | Meaning |
|-----|-------|---------|
| No tag | — | HR Selected → moves to AI interview queue |
| Yellow | warning | HR Hold — kept for future consideration |
| Red | danger | HR Rejected — restorable by admin |
| Blue | info | Technical interview completed |
| Green | success | Hired / Placed |
| Slate strike | muted | Score expired (60 days) |

## Pages

All under `packages/web/src/web/pages/`, routed in `app.tsx`. Every authenticated page renders inside `components/layout/app-shell.tsx` (fixed sidebar + top command bar).

- **Landing / Sign in** (`index.tsx`) — product pitch + Google / email sign-in.
- **Dashboard** (`dashboard.tsx`) — executive KPIs, recruitment funnel, hiring trends, AI vs tech interview analytics, activity feed.
- **Clients** (`clients.tsx`) — client companies, industries, contacts, culture notes, active jobs.
- **Jobs** (`jobs.tsx`, `job-detail.tsx`) — JD list + JD View of matches (top candidates ranked).
- **Candidates** (`candidates.tsx`, `candidate-detail.tsx`) — resume library, bulk upload, Candidate View of best-matching JDs, timeline, full report.
- **Matching** (`matching.tsx`) — run/refresh matches, threshold control, expiry state.
- **HR Screening** (`screening.tsx`) — configurable screening form, Selected / Hold / Rejected.
- **AI Interview** (`ai-interviews.tsx`, `ai-interview-room.tsx`) — invite queue + candidate voice interview room (OpenAI Realtime), report with radar chart.
- **Tech Interview** (`tech-interviews.tsx`) — templated evaluation form with weighted sections → primary score.
- **Placed** (`placed.tsx`) — everyone hired: candidate, client, role, salary, placement date, recruiter credit, time-to-hire.
- **Copilot** (`copilot.tsx`) — natural-language recruiter assistant with DB tools.
- **Settings** (`settings.tsx`) — screening questions, tech templates, thresholds, expiry window, tags, blacklist reasons, roles.
- **Backup & Recovery** (`backup.tsx`) — super admin: backup tiers, history, retention cleanup, restore.

## Key Flows

1. **Match**: Create client → create JD (upload document) → bulk upload CVs (PDF/DOCX/ZIP) → AI parses each CV → embeddings + GPT scoring against the JD document → ranked shortlist with strengths, missing skills and an AI explanation.
2. **Score expiry (60 days)**: every match stores `expiresAt = matchedAt + 60d`. Past that, the numeric score is hidden everywhere and the row is excluded from all matching/ranking/search results, replaced by "Score expired — re-run match" with a one-click re-run.
3. **Interview**: HR screening → AI voice interview (qualitative only) → technical interview (scored) → Final = match×0.20 + tech×0.80 → client review → offer.
4. **Placement**: marking a candidate hired creates a placement record (permanent retention) that surfaces on the Placed page.

## Architecture

- **API**: oRPC procedures in `packages/web/src/api/routes/`, one file per feature; typed client in `src/web/lib/api.ts`; hooks in `src/web/queries/`.
- **DB**: Drizzle + Turso (SQLite). Embeddings stored as JSON float arrays; cosine similarity computed in the matching service (replaces pgvector on this stack).
- **AI**: Runable AI gateway for parsing/matching/copilot; OpenAI directly for `text-embedding-3-small` and the Realtime voice interview.
- **Files**: CVs/JDs uploaded straight to Tigris via presigned URLs.
