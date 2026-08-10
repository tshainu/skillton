# Skillton v2 — update spec build plan

Decisions confirmed with user:
- FINAL = match×0.20 + tech×0.80 (no /2 — the /2 would cap everyone at 50).
- Reports: 8 now (Executive, Pipeline, JD Performance, Recruiter Performance,
  Client Performance, Placement, Candidate Analytics, AI Matching Analytics).
- Google Drive: full settings UI + scheduler now, Drive wired as a pluggable
  provider; Tigris keeps working until creds are supplied.
- Security: rate limiting, session timeout, input validation audit, HTTPS/HSTS,
  encryption-at-rest documented.
- Models verified live against the user's key: gpt-5.6-luna (chat/parse),
  gpt-realtime-2 (voice), text-embedding-3-small 1536 dims (embeddings).

## Phase A — foundation
- [x] Models swapped to gpt-5.6-luna / gpt-realtime-2
- [x] Schema: candidate nic + source + bucket + bucketReason + clientFailCount
      + isBlacklisted; client sourcing depth; aiQuestionSets; clientInterviews;
      settings additions (backup, session, interview timing)
- [x] Security: rate limit, session timeout, HSTS/HTTPS, headers

## Phase B — backend
- [x] Backup settings + scheduler + Google Drive provider
- [x] HR screening bulk select -> AI interview; question edit
- [x] AI question sets per job title (settings tab)
- [x] AI interview: timing, greeting, silence nudge, completion tagging
- [x] Tech interview comment sentiment -> score adjustment
- [x] NIC/phone search everywhere
- [x] Buckets, flagged candidates, hidden gems, blacklist
- [x] JD<->CV matrix routes
- [x] Reports routes (8)
- [x] Match engine performance

## Phase C — frontend
- [x] Animated voice avatar (wave circle)
- [x] JD CV Matrix page
- [x] Flagged Candidates page
- [x] Hidden Gems page
- [x] Reports pages + PDF/CSV/print export
- [x] Candidates: column toggles, blacklist tab, NIC
- [x] Status labels capitalised
- [x] Copilot output formatting
