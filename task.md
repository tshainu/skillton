# Skillton — Update Spec Build Log (round 3)

## Done
- [x] Models: gpt-5.6-terra (parse+reason), gpt-realtime-2.1 (voice), text-embedding-3-small
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

## Round: HTTPS on the VPS (nginx + Let's Encrypt)

Live at **https://skillton.69-169-97-195.sslip.io** with a real trusted cert.

- No domain was available and no CA certifies a bare IP, so the host is
  `<app>.69-169-97-195.sslip.io` — sslip.io resolves it back to the IP, keeps the
  IP visible, and Let's Encrypt certifies it. No purchase, no browser warning.
- nginx was already installed (three PHP apps on 8050/8080/8082). Added new
  snippets + vhosts alongside; touched no existing config.
- One cert, nine SANs, one for every app on the box. Each app keeps its old
  HTTP port working; HTTPS was added in front, not swapped in.
- Port 8888 is now closed externally via an iptables rule in
  `skillton-firewall.service` (loopback stays open for nginx). `__server.ts`
  takes no bind address and is a template file, so the firewall was the way.
- Server `.env` `WEBSITE_URL` → the HTTPS URL, so invite emails and interview
  links are generated as https.
- Configs versioned in `ops/nginx/`; full detail in `DEPLOY.md`.
- **The camera/mic blocker is gone**: headless Chrome on the live URL reports
  `isSecureContext=true` and `getUserMedia` returns audio+video tracks. Live
  interviews can now be run from the VPS.

## Round: reasoning model luna -> terra

- `PARSE_MODEL` and `REASON_MODEL` in `api/agent/gateway.ts` both moved from
  `openai/gpt-5.6-luna` to `openai/gpt-5.6-terra`. Luna padded thin interview
  evidence into confident scores, which is the one thing grading must not do.
- **The id is `terra`, not `tera`.** `openai/gpt-5.6-tera` and eight other
  spellings all return `Model '...' not found` from the gateway. Probed live
  before committing.
- Verified live against the gateway, not just typechecked:
  - `generateObject` with a nested/enum/array schema — works, 4.6s vs luna 7.6s.
  - `aiInterviews.regrade` end to end — 200 in 12s, real report written.
    terra scored `aii_2i4unboy380jw8tz` 30 vs luna 28.3 and dropped
    responseConsistency 2 -> 1, catching that the CV claims AI/ML while the
    candidate only discussed sales. Sharper on contradictions.
  - Copilot streaming with tool calls — `tool-input-available` ->
    `tool-output-available` -> `finishReason: stop`, no stream errors.
  - `parseCv` 3.4s and `parseJd` 2.6s, both clean structured output.
- Deployed; live smoke-tested over HTTPS.
- Stale `luna` mentions left in `plan-v2.md` on purpose — historical record.

## Round: flat scores, interview caps, no interruptions
- Grading: per-dimension orthogonal definitions + ANTI-HALO rule, each dimension now returns `{score, evidence}`; code-level spread check (`MIN_DIMENSION_SPREAD = 2`) forces one re-score when the model flattens. Stored via `toStoredAssessment()` (scores + `notes`).
- New `assessment-bars.tsx` (`assessmentRows`, `AssessmentBars`, band colours). All 4 render sites in `ai-interviews.tsx` (result card, report bars, radar, printable table) go through it — `notes` can never render as a 7th dimension.
- Caps enforced server-side: `interviewQuestions()` slices the set to `MAX_QUESTIONS = 4` in `api/index.ts` before prompt build; the same sliced list feeds `questions`/`questionCount` so coverage auto-end matches. `MAX_FOLLOW_UPS = 2` is a whole-interview budget in the prompt.
- Prompt: QUESTION SCOPE absolute, FOLLOW-UP BUDGET, "NEVER SUGGEST/PROMPT/SUPPLY AN ANSWER", "DO NOT INTERRUPT" with non-terminal pause signals.
- Room: pacing marks, silence nudge and proctoring `warn()` no longer fire while the candidate is speaking (`warn` retries up to 30s, then relies on the banner).
- Verified: typecheck / conventions / build pass; regrade of aii_2i4unboy380jw8tz went 3-flat -> 4/3/2/6/2/2 with evidence per dimension; Playwright Results tab + full report modal, zero console errors.

## Round: models -> GPT-5.6 Sol + text-embedding-3-large
- `PARSE_MODEL` / `REASON_MODEL` = `openai/gpt-5.6-sol` (verified against the gateway before shipping: 2.6s round trip. `openai/gpt-5.6-Sol` and `openai/gpt-5-6-sol` also resolve; `-soll` does not).
- Embeddings: `text-embedding-3-large`, 3072 dims (was `3-small`, 1536). Introduced an `EMBED_MODEL` constant — the model name was hardcoded a second time in the fetch body, so the header comment and the actual request could drift apart.
- DIMENSION HAZARD, documented in embeddings.ts: `cosine()` returns 0 for vectors of different length, so stale 1536-dim vectors silently match nothing and match scores collapse to the keyword-only component. Re-embedded all 13 existing rows (6 candidates, 7 job descriptions) 1536 -> 3072.
- `3-large` costs ~3x latency on embed (1765ms vs 551ms); irrelevant, embedding happens on upload not per request.
- OUTSTANDING: 42 rows in `cv_jd_matches` still hold similarity computed from the old vectors. Rerunning them means 42 LLM explain calls, so it is left as an explicit decision.
- Verified: typecheck / check-conventions / build all pass.

## Round: training the AI interviewer (interruptions, indirect prompting, casual limit, 99% from set)
All four changes are prompt engineering in `api/lib/interview-prompt.ts` — no schema, no route, no UI change.
- **99% FROM THE LIST** (new block): enumerates the *only* five utterances allowed outside the numbered set — opening audio check, a plainer re-ask of a listed question, up to `MAX_FOLLOW_UPS` follow-ups, a one-sentence factual process reply, closing words. Framed as a closed whitelist rather than "stay on topic", because an open instruction leaves the model room to justify anything.
- **INDIRECT PROMPTING** (replaced the old one-line "no hinting" bullet): bans yes/no and either/or narrowing, embedding the answer in the question, assuming detail ("presumably you had monitoring"), naming the technology/tool/metric first, reading the CV back so they need only agree, questions containing their own answer, and approval signalled by tone, "hmm", or silence length. This was the real leak — the model obeyed "never supply an answer" while still handing it over sideways.
- **IF THE CANDIDATE INTERRUPTS OR GOES OFF-TOPIC**: an interruption is never a new topic. Re-ask the owed question in the same words; if they answered a different question, ask the real one again once. Answer only short factual process questions, one sentence; deflect salary/score/verdict to the recruitment team. Apologise at most once, never restart or re-introduce, one short bridge ("Sure. Back to my question:") is the ceiling.
- **CASUAL WARMTH — ALLOWED, BUT KNOW THE LIMIT**: permits a <=3-word acknowledgement, the first name now and then, a plain connector, warm tone — always before the question, never instead of it. Bans evaluating the answer, opinions, anecdotes, jokes, weather/day/nerves talk, explaining why a question matters. Hard test: strip the turn to the question and at most four extra words may survive.
- Silence nudge hardened: "plainer" now explicitly means SHORTER AND SIMPLER, never easier — no examples, hints, options or technology names, and never shrunk into a yes/no. The nudge was the last remaining sanctioned route to indirect prompting.
- Checked against the existing `PATIENCE — DO NOT INTERRUPT` block for contradiction: they are complementary, not in tension. Patience = never talk over the candidate; the new block = do not get derailed when the candidate talks over you.
- Verified: typecheck / check-conventions / build all pass; Playwright signed in and loaded dashboard, ai-interviews, candidates with zero console and zero page errors.
- NOT verifiable from the sandbox: the four behaviours in a live call. Needs one real interview at the live URL.

## Round: interviews cutting out mid-session + AI voice missing from the recording

### "max" model — not available, left on sol
`openai/gpt-5.6-max` does not exist on the gateway. Probed through the app's own gateway code (not curl — the AI SDK gateway is not an OpenAI-compatible `/chat/completions` endpoint, so a raw curl 404s on every id including working ones and proves nothing). All rejected with "Model '...' not found": `openai/gpt-5.6-max`, `gpt-5.6-max`, `openai/gpt-5.6-Max`, `-pro`, `-ultra`, `-maxi`, `-nova`, `-astra`, `-vega`, `-orion`, `openai/gpt-5.7-sol`. `openai/gpt-5.6-sol` answered in 2.0s in the same script, so the gateway was healthy throughout. PARSE_MODEL / REASON_MODEL unchanged.

### Why interviews stopped part-way — five independent causes, all fixed
1. **Coverage false positives forced the call closed.** `noteCoverage()` scored EVERY question against EVERY interviewer utterance at a 0.6 word-overlap ratio, in any order. A follow-up or a re-ask sharing words with questions further down the list ticked them off as "asked" without them ever being asked; the set then looked fully covered mid-interview and the room forced the closing. Now only the NEXT unasked question can be credited, only from an utterance actually containing `?`, and only one per utterance.
2. **The room closed on a candidate who was still thinking.** The coverage close only required silence for `COVERAGE_SETTLE_MS` (7s) — a candidate taking eight seconds over the final question got hung up on. Now also requires `lastSpeechAt > coveredAt`: the candidate must have actually spoken after the last question was asked.
3. **Losing window focus terminated the interview.** `window.blur` armed the same clock as a real tab-away, and 60s on it terminated the sitting with `left_screen_terminated`. Blur fires on a second monitor, an OS notification, or clicking the address bar — with the interview still on screen in front of the candidate. The terminating clock is now a separate `hiddenStartedAt`, armed only by `document.hidden`. Blur still earns the time penalty.
4. **A dropped WebRTC connection was completely unhandled.** No `onconnectionstatechange`, no `channel.onclose` — the browser tore the call down, the interviewer went silent, and the candidate sat in a dead room until a timer killed it. Added `recoverConnection()`: up to `MAX_RECONNECT_TRIES = 4` automatic reconnects that replace ONLY the peer connection and data channel, leaving camera, microphone, recording and clock running, and replay the transcript so the interviewer resumes instead of restarting. `disconnected` waits 4s for ICE to self-heal first. Exhausting the attempts closes the interview properly and keeps the transcript instead of stranding the candidate.
5. **A dim room terminated the interview.** The dark-frame check (`luma < 9`) shared the fatal path with a genuinely dead camera, so bad lighting or a backlit candidate got `camera_off_terminated` after 30s. `outage()` now returns `{reason, fatal}`; only a missing, ended, disabled or muted track can terminate. Darkness warns and is logged as a proctoring event.

### AI voice missing from the video evidence
`startRecording()` was handed the raw camera+mic stream, which by definition cannot contain the interviewer — its voice arrives on a separate WebRTC track that only ever went to the speaker. So every recording was the candidate answering questions nobody could hear. Added a Web Audio mixer: `recordableStream()` builds camera video + a single mixed audio track (mic connected immediately), and `attachAiToRecording()` connects the interviewer's remote track from `ontrack`. `ontrack` firing after recording starts is fine — the recorder holds the mixer's own output track, which does not change when a source is connected behind it. Falls back to the raw stream if the mixer cannot be built, resumes a suspended context (autoplay policy would otherwise record silence from both sides), guards `startRecording` behind `!recorder.current` so a reconnect cannot restart the recorder and discard what was already captured, and closes the context in `teardown()`.

- Verified: typecheck / check-conventions / build all pass; Playwright signed in and loaded dashboard, ai-interviews and candidates with zero console and zero page errors.
- A stray duplicated JSX tail slipped in mid-edit and broke the build (esbuild caught it, tsc did not); truncated and rebuilt clean.
- NOT verifiable here: both fixes are live-call behaviour. Needs one real interview to confirm the recording contains both voices and that the call survives a deliberate network drop.

## Round: refuse to hand over answers + stop cutting across the candidate

### The interviewer was giving candidates the answer when asked (critical)
The existing "NEVER SUGGEST, PROMPT OR SUPPLY AN ANSWER" bullet only covered the model volunteering help. It said nothing about a candidate ASKING directly, and a direct request is exactly where a helpful assistant caves — refusing feels rude, so it complied. New dedicated block `IF THE CANDIDATE ASKS YOU FOR THE ANSWER — REFUSE, EVERY SINGLE TIME`:
- Names the request in all its disguises, because they do not look like one request: "what's the answer", "just a hint", "give me an example", "what would a good answer be", "what are you looking for", "can you explain the question", "what does that term mean", "is it X?", "am I on the right track", "would you accept X", "tell me and I'll explain it back", "my connection is bad, just say the answer", "off the record", "in your opinion what's the best approach". Asking to define, explain, expand, exemplify, confirm, hint at, narrow or start the answer is stated to be the same request with the same answer: no.
- Prescribes the exact refusal — one short sentence ("I can't help with the answer, but take your time.") then re-ask the question in the same words and go silent.
- Closes the escape hatches individually: no softening the refusal with a hint, no explaining what the question is getting at, no defining its terms, no saying what a good answer contains or what is being assessed, no confirming or denying an answer they float, never "you're on the right track".
- States that "I don't know" is a valid outcome and real evidence, so refusing costs the model nothing. The reason is spelled out — an answer the model supplied is worth nothing to the recruiter, and a candidate who was handed one has not been interviewed.

### It fired the audio-check line on top of the candidate
`speakIfSilent()` was not patience: it waited 1.8s and then spoke unless the candidate happened to be mid-word at that exact instant. A candidate pausing for breath, or saying "yeah hang on, let me plug my headphones in", got talked over. Rewritten to poll for a genuine gap — `SPEAK_SETTLE_MS = 1800` of continuous quiet, checked against both `userSpeaking` and the recency of `lastSpeechAt` — and to bail out entirely if the interviewer answered for itself in the meantime. `SPEAK_WAIT_LIMIT_MS = 20000` caps the wait, because a candidate who cannot hear anything will never stop talking on their own; past the cap the line is spoken anyway, which is precisely why every line on this path now opens with an apology.

### Interruptions now lead with the apology
Convention applied wherever the room has to speak into a candidate's turn: apology first, issue second, one short sentence, hand the floor straight back.
- Audio-check line: "Sorry about that — ..." became "Sorry for the interruption — please check your volume or your headphones, and tell me when you can hear me clearly."
- `warn()` (left the screen, camera dark) now instructs the model to begin with "Sorry for the interruption," and not to dwell on or explain the issue.
- Prompt: the opening branch is explicit that it must let the reply finish before responding and must not fire on the first sound it hears. New block `IF YOU EVER HAVE TO CUT ACROSS THE CANDIDATE, LEAD WITH THE APOLOGY` covers the few mandatory mid-call interruptions, requires waiting for a real gap even then, and puts the apology before the issue.

- Verified: typecheck / check-conventions / build all pass; Playwright loaded dashboard, ai-interviews and candidates with zero console and zero page errors.
- NOT verifiable here: all of it is live-call behaviour. Needs a real interview where the candidate asks outright for the answer and refuses to take no for an answer.

## Round: warm-up before the interview proper

The interview used to jump from the audio check straight into question one. Now
two easy questions sit in between, so the candidate is already talking by the
time a scored question lands.

- `api/lib/interview-prompt.ts` — the "they can hear you" branch no longer says
  "Okay, let's start the interview"; it hands over to a new `WARM-UP — EXACTLY
  TWO EASY QUESTIONS, THEN THE INTERVIEW` block. Warm-up questions are not from
  the numbered set, spend no follow-up budget, are not scored, and get no more
  than a three-word acknowledgement. Question two is loosely tied to the job
  title when one is known. Capped at about a minute, because it comes out of the
  interview clock.
- `web/pages/ai-interview-room.tsx` — `openingStage` gains `warm_up_how` and
  `warm_up_work`. The room speaks both lines verbatim (`warmUpHowLine()`,
  `warmUpWorkLine()`) and `handleWarmUpReply()` advances on the candidate's
  reply, because "make small talk" left to the model becomes a third and fourth
  question plus a discussion of the answers.
- The silence nudge mid warm-up repeats the warm-up question instead of talking
  about a question set that has not been opened yet.
- `noteCoverage()` now returns early unless the stage is `interviewing`. The
  greeting, the audio check and both warm-up lines all end in "?" and would
  otherwise have ticked real questions off the set.

Shipped as `026fbe8`; deployed and confirmed on the VPS.

## Round: app-owned completion, answer-completion state machine, warm acknowledgements

Against the 17-section spec in `pasted-1_g6Do0J.txt`.

**§1, §13 — the interview can no longer end itself.** `end_interview` used to set
`completionRequested` directly, so the model closed the call whenever it felt
done; the only guard was a 60-second floor. All requests now go through the one
authoritative `requestCompletion(source)`, which refuses while any question in
the set is unasked and immediately pushes the interviewer back onto the next
question verbatim. Refusals are logged to `proctorEvents` under the new
`premature_close_blocked` kind — the bug is intermittent, so it has to leave a
trace. Only three things get past the gate: a covered set, a candidate who
explicitly asks to stop (`STOP_SIGNALS`), or a room-forced close (time cap /
coverage).

**§3, §4, §11, §12 — answer completion is a state, not a guess.** New
`AnswerState` (`waiting_for_answer` → `candidate_speaking` →
`possible_answer_end` → `waiting_for_continuation` → `answer_complete`) with
`beginAnswerCycle()`, `assessAnswer()`, `completeAnswer()` and
`answerCompleteness()`. An utterance ending on a connector, preposition or
filler (`TRAILING_WORDS`), or under four words with no terminal punctuation, is
treated as mid-thought: the answer is held open for `CONTINUATION_WAIT_MS`, then
gets exactly one gentle "Take your time — would you like to carry on?" at
`CONTINUATION_CHECK_IN_MS`, and only then closes as `continuation_timeout`.
Explicit `DONE_SIGNALS` close it immediately as
`explicit_candidate_completion`.

**§7 — no re-asking a question they are already answering.** The silence nudge
now returns early while the state is `candidate_speaking` or
`waiting_for_continuation`; that path is owned by the continuation watchdog.
Prompt gained `NEVER RE-ASK A QUESTION THEY ARE ALREADY ANSWERING`.

**§2, §5, §8, §9, §10 — acknowledgements.** `CASUAL WARMTH — ALLOWED, BUT KNOW
THE LIMIT` is replaced by `ACKNOWLEDGE EVERY ANSWER`, requiring one short
varied acknowledgement that names back something the candidate actually said,
fused into the same turn as the next question. This deliberately reverses the
earlier three-word/four-extra-words cap. The guardrails that survive: no verdict
on the answer or the candidate, no saying what was missing, no adding facts,
tools or examples they did not say, no teaching or correcting. Appreciate the
example, never grade the person. Two `BANNED BEHAVIOUR` bullets were narrowed to
match instead of contradicting it.

**§14, §15 — logging.** Every state transition logs to the console as
`[interview:answer]`, every completion decision as `[interview:completion]`, and
each answer files an `AnswerCycle` into `answerLog` with question index, speech
start/stop, possible-end, completed-at, reason, transcript and check-in count.

Not done: `create_response` stays `true` on the Realtime session, so the model's
own semantic VAD still opens each turn — the room supervises rather than driving
every response. Flipping it would make the app fully authoritative per §4 but
rewires every turn in a live product; not worth it unless the supervision proves
insufficient. §16's ten acceptance interviews can only be run by a human.

Shipped as `cb08237`; deployed and confirmed on the VPS.

## Round: the real premature close, found in Kisshokumar Asokumar's transcript

The user reported the interviewer still jumping ahead while the candidate was
answering. Pulled the sitting (`aii_1ff83cd67oim8jl8`, 155s, completed) and the
transcript showed it exactly:

```
[ai] The company wants the network to keep working even if one device fails...
[ai] Thank you, Kisshokumar Asokumar, for your time today. The recruitment team...
[candidate] I want to implement the redundancy.
[candidate] Why are you disturbing me?
```

Three separate faults, all now fixed.

**1. Asked was being treated as answered.** The coverage forced-close gate only
required `Date.now() - lastSpeechAt > COVERAGE_SETTLE_MS`. That condition is
satisfied the instant the last question is asked, because the candidate has by
definition not answered it yet — seven seconds of thinking time and the room
delivered the closing over the top of them. New `answeredRef` tracks which
questions actually received an answer (credited in `completeAnswer`), and the
gate now needs every question answered, the candidate to have spoken AFTER
coverage was reached, and no answer held open mid-thought.

**2. `requestCompletion` had the same hole.** All four questions were asked, so
`remaining === 0` and the model's `end_interview` was accepted while the last
answer was still coming. It now also refuses on `unanswered > 0` or an answer in
flight.

**3. The greeting and the warm-up question were each said twice.** With
`create_response: true` the model answers the candidate's turn on its own, and
the room's scripted line went out on top of it. `speakExactly` now cancels any
in-flight response first, and `speakIfSilent` bails if a whole interviewer turn
was committed while it was waiting (`aiTurnCount`).

Also visible in that transcript and worth the user knowing: the recruiter's set
holds 5 questions but `MAX_QUESTIONS = 4`, so question 5 was never asked and
`topic_coverage` records it as "not asked" with score 0. That is the cap working
as designed, not a bug.

## Round: the lag was three bugs, not slowness (from the Dulip sitting)

Analysed `aii_ivfw3538ykq9f4jx` (137s, 18 turns). The candidate's turnaround was
never the problem — the model answered in 1.2-1.8s every time. Three separate
faults produced the dead air and the broken feel.

**1. A proctor warning hijacked the interviewer and invented a question.** A
1-second tab-away fired the focus-loss warning while the audio check was still
unanswered, and the model said:

> You briefly left the interview screen for 1 second... Alright, let's move
> forward with the next part of the interview. Tell me about a recent project
> you worked on that you're proud of, and what made it successful.

That question is not in the set, and it cost 7 seconds. Cause: `warn()` asked the
model to deliver the message "in your own words" and then "continue the interview
from where you were" — an open invitation to invent. It is now verbatim, with an
explicit ban on adding a question, and it is never spoken at all before
`openingStage === "interviewing"`. The on-screen banner still fires immediately.

**2. Question four was cut off, then asked again five seconds later.** The
previous round made `speakExactly` cancel any in-flight response to stop double
greetings. Cancelling unconditionally truncated the model's own turn mid-sentence
("…if one device or connection fails.") and it had to re-ask. It now cancels only
when the model is genuinely speaking, and queues the scripted line 250ms behind
the cancel so the two do not race.

**3. Every scripted line paid ~3s of dead air before it started.** 900ms initial
delay + 1.8s settle + 400ms polling. Now 350ms + 1.1s + 220ms.

**The closing now has to say the team will be in touch.** The sitting ended on
"Thanks, Dulip. I'll close things out and note next steps for you." — which tells
the candidate nothing. Both room-driven closings (questions done, and time up)
and the prompt's ENDING block now require, in so many words, that our
recruitment team will review the interview and contact them about next steps.

**The wrap-up screen is no longer a bare spinner.** "Wrapping up and preparing
your summary…" became a titled panel: responses are being saved, keep this
window open and it will close automatically, the team will review and contact
you, and contact your HR representative if anything went wrong during the
interview.

**`MAX_QUESTIONS` 4 -> 6.** Last round this was written up as the cap working as
designed. It is not defensible: the recruiters' live sets hold 5 questions, so
question 5 was never asked and the grader then recorded it as "not asked" with
coverage 0 — scoring a candidate on a question they were never given. It also
ended sittings in ~2 minutes against a 10-15 minute window. The cap now clears a
standard five-question set and still guards an oversized one.

## Round: swearing gets one gentle warning, not a hang-up

The candidate's language is now handled by the room rather than left to the
model's judgement, so the response is consistent and always reaches the
recruiter.

`containsProfanity()` matches a short list of unambiguous words on WHOLE WORDS
only — substring matching is how a filter tells a network engineer off for saying
"assessment", which would be far worse than missing a word. "damn" and "hell" are
deliberately not on the list: a candidate muttering while they think has done
nothing that belongs on a report.

On a hit, `noteLanguage()` shows the banner immediately, logs a new
`inappropriate_language` proctor event (added to the `z.enum` in
`api/routes/ai-interviews.ts` — JSON column, no migration), and routes the
spoken line through `warn()` so it waits for a gap instead of landing on top of
the answer it is about. Rate-limited to one warning per 20 seconds: swearing
arrives in a burst inside a single answer, and a warning per word is nagging.

Three escalating lines in `LANGUAGE_WARNINGS`, gentle first ("Let's keep the
language professional, please. Carry on when you're ready."), firmer if it keeps
happening. It never ends the sitting, never costs the candidate time, and never
changes their score — the recruiter sees the event and decides what it was worth.

The prompt gained a matching block so the model behaves the same way if it reacts
first: one calm sentence, then straight back to the question. Explicitly banned —
repeating the word back, lecturing, acting offended, threatening to end the
interview, swearing back, or letting it affect the assessment.

## Round: two seconds and a check-in, instead of a long silence

The dead air came from waiting in silence to find out whether an answer had
finished. The room now asks instead. Both halves of this changed.

**Warm-up (the two intro questions): move on fast.** They are small talk —
nothing is scored, so nothing is lost by moving on. `armWarmUpAdvance()` gives
about two seconds of quiet after each warm-up line and then advances whether or
not the candidate replied (`WARM_UP_PAUSE_MS`). A candidate who says nothing to
"how are you doing today?" now gets the next line instead of a silent room. The
watchdog never speaks over anybody: while either side has the floor it just keeps
waiting, and if the candidate does reply their transcript advances the warm-up
the normal way and the watchdog stands down.

**Interview questions: a short pause, then one check-in, on EVERY answer.** The
old machine waited `CONTINUATION_WAIT_MS` 4s and then up to
`CONTINUATION_CHECK_IN_MS` 9s, and only for answers that trailed off mid-sentence
— a candidate who had plainly finished sat in silence wondering if the line had
dropped. Both constants are gone. Now:

- `ANSWER_PAUSE_MS` 2s of silence after they stop, then ONE check-in.
- The wording depends on how the answer sounded, and rotates so it is not the
  same sentence every question. Trailed off -> `CHECK_IN_UNFINISHED` ("Do you
  need more time?"). Sounded finished -> `CHECK_IN_FINISHED` ("Is there anything
  else you'd like to explain?", "Would you like to add anything else?").
- A short "no" / "that's it" / "I'm done" in reply closes the answer immediately
  (`meansNothingMore`) and the next question follows.
- More talking is simply the rest of the answer.
- Silence for `POST_CHECK_IN_MS` 4s after being asked outright is itself the
  answer, and the interview moves on.
- One check-in per answer, ever. An explicit done-signal in the original answer
  skips it entirely.

`meansNothingMore` only accepts replies of five words or fewer. "No, actually
there is one more thing — we also rebuilt the failover" opens with "no" and is
the exact opposite of nothing more.

The prompt was reconciled with all of this, because the old PATIENCE block
directly contradicted it: "if you are even slightly unsure whether they have
finished, WAIT LONGER" and "when in doubt, silence" are now "if you are unsure,
ASK — do not sit there, and do not jump ahead", with the three check-in
sentences, a once-per-answer cap, and a note that the check-in is not a follow-up
and spends no follow-up budget. The WARM-UP block gained an explicit DO NOT
LINGER paragraph saying the long-pause rules apply to the numbered questions and
not to the two intro ones. "Never talk over them" survives untouched — that was
never the problem.

## Round: unprofessional language now stops the interview

Reverses the round above it, on instruction: "if candidate talk in unprofessional
words instantly stop and warning and repeat the question again. If he speak 2nd
time terminate the interview."

`LANGUAGE_WARNINGS` (three gentle escalating lines, interview continues) is gone.
In its place:

- `LANGUAGE_STRIKE_LIMIT` 2.
- `LANGUAGE_FIRST_WARNING` — a formal warning: keep the language professional,
  this is a formal interview and it is being recorded, a repeat ends it.
- `LANGUAGE_FINAL_LINE` — the closing spoken on the second strike.
- `LANGUAGE_TERMINATION_REASON`, shown on the banner and stored on the interview.
- `LANGUAGE_TERMINATION_GRACE_MS` 9s, so the closing line finishes playing before
  the call is cut.

`noteLanguage()` now sends `response.cancel` the instant profanity is detected —
the interviewer is cut off mid-sentence rather than finishing its thought, which
is the whole point of "instantly stop". Any answer being held open is dropped.

Strike 1: proctor event, 12s banner, and ONE `response.create` that says the
warning verbatim and then re-asks the current question verbatim in the same turn,
so the candidate is never left wondering what they are meant to answer. The
question is handed over word for word — described, it gets paraphrased or, worse,
invented.

Strike 2: proctor event flagged `terminated`, persistent banner, the closing line,
then `end()` with flag `inappropriate_language_terminated`.

The de-dupe window is 3s, not 20s. Swearing arrives as a run of words inside one
utterance; counting each word would terminate on the first offence and the
candidate would never get the second chance the instruction describes. A real
second strike comes in a later turn.

The prompt block was reversed to match — it previously said "it is not your job
to punish it", "never threaten to end the interview" and "do not end the
interview over it", which is now the opposite of what the room does. It still
bans repeating the word back, lecturing, moralising, swearing back, and letting
any of it affect the technical score.

Worth knowing: `PROFANITY` includes mild words (`shit`, `idiot`). A candidate who
mutters "oh shit, I've forgotten the command" out of frustration now gets a formal
warning, and a second slip ends their interview with no human in the loop.

## Round: the evaluation template save button did nothing

Reported as "new evaluation template is not saving". The save path was never
broken — it was the failure path that was invisible.

The old handler parsed the sections textarea by splitting each line on `|` and
keeping only lines that produced three or more parts, then bailed out with a bare
`return` if nothing survived. No error, no toast, no request. Reproduced with
Playwright: the pipe format saved fine and created a row, while
`Technical Knowledge - 40%` — how a recruiter actually types it — fired no RPC
call at all and left the modal sitting there.

Two defects, one symptom:

1. **A single rigid input format.** `parseSectionLine()` now accepts the pipe
   format, tab-separated, and dash/colon separated (`Name - 40 - A, B`,
   `Databases: Indexing, Query plans`). The weight is optional and `%` is
   tolerated; when it is left out, what remains of 100 is split evenly across the
   sections that did not state one, because defaulting to 0 would silently drop
   the section out of the weighted score.
2. **Silent validation.** `submitTemplate()` replaces the bare `return` with a
   specific message in an `ErrorNote` inside the modal — a missing name, a scale
   outside 3-100, or a named section with no parameters each say so. A section
   that names something but lists no parameters now blocks the save rather than
   being dropped: the recruiter meant to score it.

`mutateAsync` is also wrapped now, so a server rejection reaches the user instead
of becoming an unhandled promise rejection that looks identical to "nothing
happened".

Verified against the dev server, four cases: dash format saves, colon format with
no weights saves, pipe format still saves, and parameterless lines are refused
with the reason shown. The four probe templates those tests created were deleted
from `tech_templates` afterwards — the table was empty beforehand.
