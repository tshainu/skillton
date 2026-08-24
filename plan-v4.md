# Skillton — Improvements Plan (v4)

Source: `Skillton_Improvements_7aKXvk.txt`, 24 Aug 2026.
45 discrete items + 3 substantial new builds. This plan groups them by *nature of
work*, because that determines what can safely ship together.

Nothing below is implemented yet. Sequencing needs your call.

---

## What the audit already found

Before estimating, I checked the claims that say "not working". Three of them are
not bugs — the feature was never built:

| Claim | Reality |
|---|---|
| Bulk upload JDs drag & drop not working | No `onDrop` / `onDragOver` handler exists anywhere in the codebase. Never built. |
| Bulk upload CVs drag & drop not working | Same. The file input works; the drop zone is decorative. |
| Dark and light theme | No theme system at all. `design.md` specifies dark-only and every page uses hardcoded colours. |
| Funnel cards not clickable | Correct — rendered as static bars, no handler. |
| Candidate status filtering not working | A `Select` exists and sets state. Needs reproduction to find where the filter is dropped. |
| Hidden Gems "nothing works" | Page (166 lines) and `talent.hiddenGems` route both exist and look complete. Needs reproduction — likely empty data, not broken code. |
| AI-selected not reaching Technical | `techInterviews.queue` reads `currentStatus in ('tech_interview_pending','ai_interview_completed')` and the AI route does set `tech_interview_pending`. The wiring exists, so this is a conditional path failing, not a missing link. |

**Implication:** "not working" and "not built" need different estimates, and the
three reproduction items need me to drive the live app before I can size them.

---

## Batch A — Cosmetic and copy (low risk, fast)

Pure UI. No schema, no logic. Can all ship in one commit.

1. Rename menu "Candidate" → "Candidates".
2. Remove NIC from: Candidates, JD-CV Match, Flagged Candidates, CV-JD Match.
3. Remove Location from CV-JD Match.
4. Remove Live Matches from Job Descriptions.
5. Blacklisted Candidates — remove bulk upload, listing only.
6. Technical — default Selection Reasoning to "Technical depth is reasonable".
7. Buckets listed with their colour (Candidates).
8. Matching engine — add a "separate skills with commas" label.
9. CV-JD Match — fix the search dropdown sitting behind the candidate name card
   (z-index / portal on the existing `popover.tsx`).

## Batch B — Broken behaviour (needs reproduction first)

Each needs me to drive the live app and find the actual cause. I will not guess.

10. Candidate status filtering.
11. Hidden Gems — establish what "nothing works" means concretely.
12. "Send to HR Screening" button on the candidate card under a JD.
13. AI Interview selected candidates not reaching the Technical section.
14. Additional skills `+4` chip does not expand → open in a modal.
15. CV-JD Match — Client field not populated.

## Batch C — Skills taxonomy (one shared change, many surfaces)

A single piece of work that several items depend on. Build it once, apply
everywhere, or it will drift.

16. Classify skills as **core technical** vs **soft**. Exclude soft skills
    (Time Management, Written English, Documentation…) from skill matching and
    from the skills shown on: Candidates, CV-JD Match, JD matched/missing skills.
17. Matching engine search must find candidates by any skill ("Cisco" returns
    every candidate with Cisco), and support comma-separated multi-skill search.

**Note:** item 17 is flagged "very important" in your list. It is also the item
most likely to be an embeddings problem rather than a UI one — the handover
records 42 `cv_jd_matches` rows holding similarity computed from stale 1536-dim
vectors against the current 3072-dim model, which silently match nothing. That
needs checking before I touch the search UI.

## Batch D — Workflow and lifecycle

Schema-touching. Higher risk, needs care with existing rows.

18. Clients — auto-fill client name (and other fields where derivable) from the
    JD instead of manual entry. Your own note says JD structure varies; this is
    an LLM extraction task with a confidence fallback to manual.
19. Clients — show associated JDs, split open vs closed.
20. Clients — hide JDs for closed/hired positions.
21. Job Descriptions — list view with fuller detail.
22. Job Descriptions — expired scores become a "> 6 months" label, click to
    expand detail.
23. Job Descriptions — allow HR to re-upload a new CV when a score expires.
24. Flagged — Tag column becomes the JD the candidate was selected for.
25. Flagged — rejected-at-client candidates become reschedulable against a
    different client/JD, carrying the rejection count forward.
26. Technical — Reschedule button on the tech result card, choosing the target JD,
    pushing the candidate back to Flagged with the new JD tag.
27. Rejection threshold **3 → 5**, then remove from system.
28. Technical — created templates must be editable (currently create-only; the
    API already accepts an `id` for update, the UI never sends one).
29. Technical — award marks to the heading skill only, not sub-components.
30. Technical — add a Note section after Recommendation.
31. Dashboard — funnel cards clickable, opening detail.
32. Dashboard — Live Matches: explain the "39", and restrict to candidates
    scoring > 65 for each role.
33. JD-CV Match — limit Top Matches to 10 with Load More.

## Batch E — New sections

34. HR Screening — additional questions (Shift, Remote/On-site, EPF/ETF, …).
35. HR Screening — three-bucket grid view.
36. New menu item: Raised Troubleshooting Ticket. Needs its own table, list,
    detail, and status flow — this is a small module, not a menu entry.

## Batch F — Transferable Skills Analysis (the big one)

The largest item in the document and the one with the widest blast radius.

Requires:
- A skill-equivalence capability (Azure ↔ AWS, Cisco ↔ Fortinet ↔ Palo Alto,
  Veeam ↔ Avamar, VMware ↔ Hyper-V, Intune ↔ Workspace ONE, CrowdStrike ↔
  Defender for Endpoint, Splunk ↔ Sentinel, Jira ↔ ServiceNow).
- A four-way classification replacing today's binary matched/missing:
  **Direct Match / Transferable Skill / Partial Match / Skill Gap**, each with a
  written justification.
- Schema changes to store the classification and reasoning per skill.
- Propagation to every surface that shows skills: JD analysis, CV analysis,
  candidate scoring, skill matrices, interview assessments, recommendations,
  final fit evaluation.
- Re-running matches for existing rows so old data is not left in the old shape.

**Design question that must be settled first:** curated equivalence table, LLM
judgement per pair, or LLM with a curated table as ground truth. My
recommendation is the third — a curated table for the pairs you listed (fast,
deterministic, free) with the LLM handling everything not in the table, and the
result cached. A pure-LLM approach re-litigates "is Azure like AWS" on every
match and will be slow, costly, and inconsistent between runs.

## Batch G — Dark and Light theme

Cross-cutting UI work. There is no theme layer today: colours are hardcoded
across ~22 pages and the component library, and `design.md` commits to dark only.

Doing this properly means promoting every colour to a CSS variable, adding a
theme toggle with persistence, and re-checking contrast on the orange accent in
light mode — orange `#FF6B2B` on white fails contrast for small text and will
need a darker variant. Worth doing once, properly; painful to retrofit twice.

---

## Suggested sequence

1. **Batch B** — find out what is genuinely broken. Bugs before features.
2. **Batch A** — cheap wins, ships same day.
3. **Batch C** — skills taxonomy + search, since your list marks search critical.
4. **Batch D** — workflow, in two or three commits.
5. **Batch E** — new sections.
6. **Batch F** — transferable skills, on its own, with its own verification pass.
7. **Batch G** — theme, last, so it is applied to the final set of screens.

Rationale: F and G both touch everything. Running either before the rest means
doing that work twice.

---

## Open questions

- Priority order — accept the sequence above, or lead with something specific?
- Transferable skills: curated table + LLM fallback, as recommended?
- Light theme: confirm you want it, given `design.md` currently commits to
  dark-only as a deliberate brand decision.
- Soft-skill exclusion list: give me the definitive list, or shall I propose one
  from the skills currently in your database?
- Dashboard "Live Matches (39)": tell me what you expect it to count and I will
  reconcile it against what it counts today.
