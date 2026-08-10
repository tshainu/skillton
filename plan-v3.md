# Update round 3 — build plan

28 items from `update_2_sqGjTS.txt`. Order is dependency-driven.

## Phase 1 — schema + shared libs
- [ ] `candidates.cid` — human candidate id (CID-00001), unique per agency, searchable everywhere
- [ ] `job_descriptions`: `salary_currency`, `salary_min`, `salary_max` (keep `salary_range` as display cache)
- [ ] `interviews_ai` proctoring: `video_url`/`audio_url` exist; add `focus_loss_count`, `away_seconds`,
      `fraud_flags` (json), `proctor_events` (json), `time_penalty_seconds`, `question_set_id`
- [ ] `interviews_technical`: `edited_at`, `edited_by` (edit after finish)
- [ ] `candidates`: `duplicate_fields` (json) — which fields collided
- [ ] settings: `aiVoice`, `aiProctoringEnabled`, `defaultCurrency`
- [ ] `lib/currency.ts` — parse + format (LKR 450,000.00 / USD 12,000.00)
- [ ] `lib/cid.ts` — allocate next CID per agency
- [ ] raw-SQL migration script (db:push blocks on TTY prompt)

## Phase 2 — UI foundations
- [ ] `Modal` → render through `createPortal` + internal scroll (fixes question-set modal sticking to
      its trigger row and the edit-AI-question modal not scrolling)
- [ ] Toast + `useConfirm` dialog; replace all 4 `alert()`/`confirm()` sites
- [ ] Sidebar wordmark 30% smaller
- [ ] Login: canvas spider-web background; remove Google sign-in
- [ ] AI interview room: Skillton logo

## Phase 3 — workflow correctness
- [ ] `matrix.sendToScreening` must set `currentStatus = 'hr_screening'` (it only set the stage, so the
      candidate never matched the queue filter) and must NOT insert a fake `interviews_hr` row
- [ ] `screening.queue` must drop `ai_interview_pending` (that is why screened candidates stayed)
- [ ] Dedupe HR questions: communication / salary / notice / relocate are first-class columns, so remove
      them from the seeded dynamic list
- [ ] Redesign HR screening modal: slider ratings, radio yes/no, sectioned
- [ ] Flagged page: placed/rejected must leave the list; invalidate the grid
- [ ] Dashboard hiring-trend + KPI refresh; placed page refresh; matrix real status

## Phase 4 — AI interview
- [ ] Male voice (`ash`), `semantic_vad` instead of 700 ms server VAD
- [ ] Rewrite prompt: kill the premature "No problem, let's move on"; restore depth/adaptive probing
- [ ] Question-set mapping UI (JD ↔ question set) + strict use of mapped questions
- [ ] Camera on during interview; record A/V; upload as evidence on finish
- [ ] Tab-away / minimise / background → deduct time, warn immediately
- [ ] Face + fraud signals: looking away, reading, headphones → warn

## Phase 5 — remaining
- [ ] Duplicate CV: show colliding fields (phone/NIC/email), accept-or-reject, bulk list
- [ ] Edit technical interview after completion
- [ ] Candidates table: per-column visibility toggle + asc/desc sort + CID column
- [ ] Google Drive settings actually persist and verify
- [ ] Currency formatting carried through JD → matching → placements → reports

## Verify
`bun run typecheck` + `internal:check-conventions` + `build`, dev on 4200, Playwright smoke on the
public preview URL (localhost hides proxy-only bugs — see the httpsOnly regression).
