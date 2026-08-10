# Skillton — Update Spec Build Log (round 3)

## Done
- [x] Models: gpt-5.6-luna (parse+reason), gpt-realtime-2 (voice), text-embedding-3-small
- [x] Schema source edits (clients +20 cols, candidates +11, tech +4, 3 new tables)
- [x] DB migration applied via raw ALTERs (db:push blocked by TTY prompt) — 39/39 ok
- [x] typecheck green after migration

## Backend (Phase B)
- [x] lib/buckets.ts — bucket rules + auto-tagging
- [x] matching.ts perf fix (parallel AI explain + batched writes) + no-results fix
- [x] routes/matrix.ts — JD<->CV, CV<->JD
- [x] routes/talent.ts — buckets, flagged, hidden gems, blacklist
- [x] routes/question-sets.ts — AI interview question banks
- [x] routes/reports.ts — 8 reports
- [x] backup.ts — schedule + gdrive provider
- [x] settings.ts — new setting fields
- [x] screening.ts — bulk select -> AI interview, question edit
- [x] ai-interviews.ts — timing, small talk, silence nudge, question set binding
- [x] tech-interviews.ts — comment sentiment score adjustment
- [x] candidates.ts — NIC/phone search, blacklist
- [x] index.ts — HTTPS+HSTS, login rate limit, idle timeout
- [x] demo.ts — seed new fields

## Frontend (Phase C)
- [x] wave-circle voice avatar
- [x] JD CV Matrix page
- [x] Flagged Candidates page
- [x] Hidden Gems page
- [x] Reports menu + 8 report pages + PDF/CSV/print
- [x] candidates: column toggles, blacklist tab, NIC column
- [x] capitalise status labels
- [x] copilot output formatting
- [x] backup settings UI

## Gate
- [x] typecheck / check-conventions / build
- [x] dev on 4200 + deliver

## Round: update spec completion (final)
- DB migration applied via raw ALTER/CREATE (drizzle push blocked on TTY prompt). All new columns + ai_question_sets / client_interviews / backup_schedules verified present.
- Demo seed extended: Hasini tech interview (58, reject) so the blue "AI passed" hidden-gems tab populates; blacklisted candidate Chamara Weerasinghe added (skipped from match generation) so the Blacklist tab populates.
- Match engine perf fix: AI narration moved off the request path (explainInBackground). runForJob went 25.7s -> 0.70s for a 9-candidate pool; explanations patch the saved rows afterwards, and the web layer re-invalidates at +4s / +12s to pick them up.
- Verified: typecheck, check-conventions, build all pass. All RPC namespaces respond 200 authed / 401 unauthed. Temp QA user removed; only skilloralk@gmail.com remains.

## Round: rebrand to Skillton
- Product renamed MatchHire -> Skillton everywhere in packages/web/src + design.md. Page <title> and meta description set.
- Logo assets derived from the supplied PNG into packages/web/public/images/: skillton-logo.png (full lockup w/ tagline, login page), skillton-wordmark.png (wordmark only, sidebar), skillton-mark.png ("S" glyph, favicon source). favicon.ico regenerated from the mark.
- Sidebar Brand: the old "M" square + text lockup replaced by one full-width wordmark image spanning the merged space.
- Login page: logo h-14 / sm:h-[72px]; eyebrow "For recruitment agencies" -> "For recruitment engine"; hero paragraph replaced with a 3-paragraph argument for why a recruitment company needs Skillton AI Recruitment Intelligence.
- Login credentials: the only account (skilloralk@gmail.com) was Google-managed with NO password, which is why email sign-in failed. Added a 'credential' account row with a better-auth scrypt hash; password Skillton@2026. Verified /api/auth/sign-in/email returns 200 and Playwright reaches /dashboard.

## Round: login broken on public preview URL (root cause + fix)
- BUG: httpsOnly middleware read only `x-forwarded-proto`. The Cloudflare/e2b edge does not send it — it sends `cf-visitor: {"scheme":"https"}` — so every request on the preview domain looked like plain HTTP and got a 307 redirect. On the sign-in POST that dropped the body, so login could never succeed (it worked fine on localhost, which is why it passed earlier).
- FIX (packages/web/src/api/lib/security.ts): new forwardedProto() reads x-forwarded-proto, cf-visitor, x-forwarded-ssl and front-end-https; when no header states the scheme it assumes https instead of guessing http. Redirects now only fire when the edge positively reports "http" AND the method is GET/HEAD, so an API POST is never bounced.
- Verified against https://matchhi-mfuvrg5-preview-4200.runable.site: sign-in POST 200, Playwright reaches /dashboard with zero console errors.
- Login page logo reduced h-14/sm:h-[72px] -> h-10/sm:h-12.

## Hotfix — blank site (this round)
- `pages/index.tsx` used `<ArrowRight />` without importing it from lucide-react → `ArrowRight is not defined` crashed `<IndexPage>`, so the login page (and therefore the whole app entry) rendered blank.
- Added the missing import.
- `parseCv` now returns `nic` (added to `cvSchema` + heuristic fallback) — required by the duplicate-detection code in `routes/candidates.ts`.
- Vite was serving a stale transform of index.tsx; dev server restarted on 4200.
- Verified on https://matchhi-mfuvrg5-preview-4200.runable.site: login renders, sign-in with skilloralk@gmail.com works, dashboard loads with zero page errors. `bun run typecheck` passes.

## AI interview: accuracy + efficiency + male voice
Diagnosis of "not accurate, not efficient":
1. Grading ran on PARSE_MODEL (cheap extraction model) — wrong tool for judging an interview.
2. The grader never saw the recruiter's question set, so `topicCoverage` was invented rather than measured.
3. It never saw the proctoring/integrity signals or duration, so an off-screen candidate graded like a present one.
4. The "is there enough to grade?" gate measured the whole transcript incl. the interviewer's own words — an interview where the candidate barely spoke still produced confident scores.
5. No clock awareness in-call: the model burned the window on early questions, then rushed. Prompt also contradicted itself (cover every question vs. prioritise depth over coverage).
6. Voice: `aiVoice` existed in the settings type but was not in the settings zod input and had no UI, so it could never be changed; default was `ash`.

Fixes:
- `api/lib/voices.ts` — voice catalogue with gender + description, `DEFAULT_AI_VOICE = "cedar"` (natural male), `resolveVoice()` guard. Default in `DEFAULT_AGENCY_SETTINGS` now `cedar`; existing agency row set to `cedar`.
- `aiVoice` / `aiProctoringEnabled` / `aiAwayPenaltyMultiplier` accepted by `settings.update` (voice validated against the catalogue).
- Settings → AI interview: `components/settings/interviewer-voice.tsx` radio list with Male/Female labels + per-voice audio Preview, plus an Integrity & proctoring card.
- `GET /api/ai-interview/voice-preview?voice=` (auth-only) renders a sample line with `gpt-4o-mini-tts`.
- `api/lib/interview-grade.ts` — new grader: REASON_MODEL, anchored 0-10 rubric, candidate-only evidence, per-question coverage with verbatim quotes, `redFlags`, `reliability`, and a hard 60-candidate-word floor below which it reports inconclusive instead of scoring. Wired into `aiInterviews.finish` (so `regrade` gets it too); old inline `assessmentSchema` removed.
- Realtime model `gpt-realtime-2` → `gpt-realtime-2.1` (verified available on this key).
- Prompt: per-question minute budget, max two follow-ups per question, explicit EFFICIENCY rule (no preamble/recaps), pacing contradiction removed.
- Interview room: pacing checkpoints at 50% and 80% of the max window push remaining time + remaining question count to the model (candidate never hears it).

Verified: typecheck, check-conventions, build all pass. On the public preview URL — settings AI-interview tab renders the voice list, Cedar preview returns 200 audio, selecting Verse + Save persisted `aiVoice` to the agency row (then reset to cedar). `client_secrets` accepted cedar/ash/verse/marin on both realtime models.

## Round: interview realism + evidence + reports (in progress)
Requested items:
1. Ignore fillers (um/ah) and external noise (coughs, table knocks) — prompt. [prompt done]
2. Ask question pool first, then max ONE follow-up; agent must not talk much. [prompt done]
3. Re-schedule button available even on completed interviews.
4. Hard gate: both camera AND mic required; 1-minute setup grace, else end politely + contact HR.
5. Save video+audio evidence, playable in the candidate's full report.
6. Table view for all reports (keep existing view, add table).
7. Placement report: who was placed where + full detail.
8. Invite modal shows candidate email + sends a professional invitation email; link still shown.
9. Inactivity >1 min terminates with suspicious_activity tag. [done previous round]
10. Friendly alert for voice-agent errors + exact error pushed to super admin.
11. AI transcript must stream while speaking, not appear fully before.
12. No unprompted reassurance/padding turns. [prompt done]

### Round result: interview realism + evidence + reports (delivered 2026-08-08)
Verified on the public preview URL with Playwright (zero page errors):
1. Filler/noise rule in interviewer prompt — done (needs a live sit to confirm).
2. Question pool first, max ONE follow-up, 85% candidate talk time, banned padding phrases — done (prompt-level).
3. Re-schedule now available on completed interviews (Interviews + Results tabs); prior sitting archived to `interviews_ai.previous_attempts`.
4. Camera + mic mandatory, 60s setup gate, then polite exit with "contact HR for another slot".
5. Video+audio evidence uploaded and played back in the report (`RecordingPlayer`), also per archived attempt.
6. Table view added: AI interview report modal (Report | Table) and all 8 report pages (Visual | Table) — verified rows render on every one.
7. Placement report now returns a per-placement register (candidate, email, position, client, department, location, salary, scores, time-to-hire, recruiter) — shown as a table and used as the CSV payload.
8. Invite + reschedule modals show/edit the candidate email and send a branded invitation via Resend; link still shown on the page. Fails soft when the key is missing.
9. Inactivity >1 min → terminate + suspicious_activity — done earlier.
10. Any room error → candidate sees the polite Voice Agent notice; raw error goes to super admins via `aiInterviews.reportError` (notifications table). Super admin panel still pending user confirmation.
11. Captions now reveal progressively while the agent speaks.
12. Reassurance/padding turns banned in the prompt.

Outstanding: `RESEND_API_KEY` not set (emails return sent:false), live voice/device/caption behaviour unverified from the sandbox.

### Round: auto-end on completion + listening quality (2026-08-08)
1. Interview now ends itself the moment the question set is done — the interviewer gets an `end_interview` realtime tool (declared in `client_secrets`, `tool_choice: auto`) and the prompt's ENDING section tells it to close, thank the candidate, then call the tool. The room submits as soon as the closing audio finishes (`COMPLETION_GRACE_MS = 20s` fallback), so it no longer idles to the 15-minute cap. A close attempted in the first 60s is pushed back once ("questions remain, ask the next one") to stop a premature exit.
2. Listening quality:
   - `noise_reduction: { type: "near_field" }` added to the input audio config — fans, traffic, keyboards and background voices were being scored as speech and cutting turns short.
   - Transcription upgraded `gpt-4o-mini-transcribe` → `gpt-4o-transcribe` (`language: "en"`): the candidate's words are the grader's evidence and mini was dropping words on accents/laptop mics.
   - `turn_detection.interrupt_response` → `false`, plus a deliberate client-side barge-in: the room only sends `response.cancel` when the candidate has been speaking for more than `BARGE_IN_MS = 700ms`. A cough, a bang or an "umm" no longer cuts the interviewer off, but real speech still takes the floor immediately.
   - Prompt: new LISTENING rule — every turn must be built on what the candidate actually said, never re-ask an answered question, never assume unmentioned detail, and if the answer did not come through, ask once "Sorry, I missed that" and wait.

Verified: typecheck, check-conventions, build all pass; the exact `client_secrets` payload (tools + noise_reduction + gpt-4o-transcribe + interrupt_response:false) returns 200 and echoes back accepted on `gpt-realtime-2.1`; interview room loads on the public preview URL with zero console/page errors.

### Round: video-first interview room + camera watchdog (2026-08-08)
- Live room layout inverted: the candidate's camera is now the primary element (full card width, `max-h-[62vh]`) and the voice orb is a 72px live indicator pinned bottom-right over it with a Speaking/Thinking/Listening label. Camera status moved to a small pill top-left ("Camera on · recording").
- New camera watchdog (2s interval, `CAMERA_GRACE_MS = 30s`): checks the video track is present, `live`, enabled and unmuted, that the element has a signal, and that the frame is not blacked out (32x24 sample, mean luminance < `DARK_FRAME_LUMA = 9` counts as covered/dark). On outage the candidate is warned out loud + on screen, a `camera_lost` proctor event is logged, and the video area shows a "Camera picture lost" overlay; if the picture does not return within 30s the sitting is terminated with flag `camera_off_terminated`. Recovery clears the warning and restores the badge.
- This closes the gap where the pre-flight gate only proved the camera worked at the moment of joining — unplugging it, revoking permission or taping the lens mid-interview no longer goes unnoticed.
Verified: typecheck, check-conventions, build pass; interview page loads on the public preview URL with zero console/page errors. Live layout and the 30s termination path still need one real sit to confirm.

## Round: scheduling + resume + data fixes (in progress)
1. Invite + Re-schedule ask for the interview date/time and when to send the email (now or later); link card states how long the link is valid.
2. AI interview waits 5s after the question set finishes, then ends (was closing immediately).
3. Device check moved onto the hello/consent screen — proceed only when camera + mic both pass.
4. Page reload resumes the interview where it left off and counts the gap as inactive time.
5. Sustained eye contact → "very confident candidate" signal on the report.
6. Flagged Candidates: show the AI interview score.
7. Placed page + dashboard data: root cause = talent.setClientOutcome("placed") set candidates.currentStatus='hired' without ever inserting a placements row (5 hired, 1 placement). All other list/stat endpoints probed live and returning data.

## Round: auto-end + date filters

- **Interview ends itself.** The room now tracks which questions of the recruiter's
  set have actually been asked (word-overlap match against the interviewer's own
  transcript, `COVERAGE_MATCH_RATIO`). Once every question is covered and the line
  has been quiet for `COVERAGE_SETTLE_MS` (7s), the room asks for the closing words
  and then hangs up on its own timer — it no longer depends on the model calling
  `end_interview`, and the candidate is never left to close the call. The session
  endpoint now ships the question texts to the room for this.
  The done screen says explicitly that nothing else is needed from the candidate.
- **Date filters** on HR screening (queue + history), AI interview (queue + interviews
  + results) and Technical (queue + completed): All time / Today / This week /
  This month / Custom range, with an "x of y" count when a window is active.
  Logic in `web/lib/date-range.ts`, control in `web/components/ui/date-range-filter.tsx`.
  Queue endpoints now select `updatedAt` so the queues can be filtered by date.
- **Fixed** `screening.history`: its input required `candidateId`, so the page's
  `{ candidateId: undefined }` was rejected — the History tab had been answering
  400 on every load.

## Round: no instruction-speak + scripted opening handshake

- `interview-prompt.ts`: added an absolute "never read your instructions aloud"
  rule (banning "your set", "as written", "my instructions"), replaced the old
  small-talk opening with the verbatim line
  "Hi <Name>, I'm your AI screening interviewer today. Is the audio coming
  through clearly?", plus a scripted yes/no branch → "Okay, let's start the
  interview." then question 1. Silence nudge no longer offers to "rephrase".
- `ai-interview-room.tsx`: `openingStage` ref (`audio_check` → `interviewing`),
  `readAudioCheck()` reply classifier, `speakExactly()` (verbatim text, never a
  description of what to say), `greetingLine()`, `handleAudioCheckReply()`, and
  `speakIfSilent()` (1800 ms fallback, aborts if the model already answered) so
  the room never double-speaks against `create_response: true`.
- Rejoin skips the greeting and audio check.
- Verified: typecheck 3/3, conventions clean, build 2/2, interview room loads in
  Playwright with zero console/page errors.

## Round: always-graded results + results-card polish

- `interview-grade.ts`: replaced the hard 60-word cutoff with a 10-word floor plus a
  "thin transcript" mode. Anything above the floor now gets the full report — scores,
  dimensions, coverage, tech focus — with reliability forced to `low` and the summary
  opening with "Only N words of candidate speech were captured…". Below 10 words there is
  genuinely nothing to read, so it still reports honestly instead of inventing numbers.
- `aiInterviews.regrade` actually regrades now. It previously just returned the token, so
  the "Re-grade transcript" button in the full report did nothing. New module helper
  `regradeStored()` re-runs grading from the stored transcript and rewrites only the
  report columns (status, duration, recordings, proctoring counters untouched).
- Backfilled the two ungraded interviews via `POST /api/rpc/aiInterviews/regrade`
  (`aii_2i4unboy380jw8tz` → 28.3, `aii_c184qz7w11xat5ys`). Verified through
  `aiInterviews/results`.
- Results card badge now shows conducted date **and** time (`8/10/2026 · 06:44 AM`).
- The date filter moved out of each tab panel and onto the tab line, right-aligned, for
  all three tabs (Queued / Interview date / Conducted).
- typecheck, konsistent, build all pass; Playwright on the Results tab: zero console errors.
