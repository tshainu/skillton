# Batch C — Skills taxonomy proposal

Probed from the live database: **606 distinct skill strings** (199 from JD
requirements, 188 candidate skills, 154 candidate technologies, 29
certifications, plus overlaps).

## What the data actually looks like

The extractor is not producing tags, it is producing sentences. Real examples:

- `Ability to work remotely during Australian Eastern business hours`
- `Appropriate escalation of advanced server, firewall, network, infrastructure, and application issues`
- `Level 1.5, Level 2, service-desk, or internal IT support experience`
- `Windows Server 2012 R2, 2016 and 2019 administration and troubleshooting`

So a fixed exclusion list cannot work on its own — every new CV or JD invents
new strings. The classification has to be a function, not a list.

## Proposed three classes, not two

| Class | Meaning | Shown on Candidates / CV-JD / JD skills? | Counts toward matching? |
|---|---|---|---|
| **core** | A technology, platform, protocol, or a technical activity on one — `Cisco Meraki`, `Hyper-V`, `PowerShell scripting`, `DNS administration` | Yes | Yes |
| **soft** | Behavioural or communication traits — `Teamwork`, `Written communication`, `Time management` | No (collapsed into a muted "+N soft skills" chip that opens the existing modal) | No |
| **context** | Not a skill at all: seniority, years, employment logistics, or a restatement of the role — `Level 2 troubleshooting experience`, `MSP experience supporting multiple customer environments`, `Ability to work remotely during Australian Eastern business hours` | No | No |

`context` is the class your list did not mention but the data demands. Folding it
into `soft` would label "5 years MSP experience" a soft skill, which reads wrong
on screen and corrupts any future soft-skill reporting.

## The 32 unambiguous soft skills currently in your database

Every one of these is a real string in the live data today:

Analytical thinking · Attention to detail · Autonomous work during
evening/overnight shifts · Client stakeholder communication · Communication ·
Customer service via phone, email, and remote tools · Independent work ·
Judgment on when to escalate versus continue troubleshooting · Mentoring ·
Multitasking · Problem solving · Professional spoken and written English
communication · Professional written English communication · Quick learning ·
Remote and autonomous working · Stakeholder communication and outage planning ·
Stakeholder support · Student project mentoring · Supporting and mentoring less
experienced help-desk team members · Team collaboration · Teamwork · Time
management · Time management and prioritisation · Verbal communication · Written
communication · Ability to contribute to ongoing service improvements · Ability
to independently learn and implement new technologies · Ability to learn
customer-specific applications and processes · Ability to work across different
customer systems, configurations and priorities · Ability to work independently
without step-by-step supervision · Ability to work remotely during Australian
Eastern business hours · Explaining technical concepts clearly to non-technical
users

Note the last six are arguably `context`, not `soft` — they are employment terms
phrased as abilities. My proposal classes them as `context`.

## Deliberate judgement calls to confirm

These sit on the line and I want your ruling rather than my guess:

1. **Documentation.** `Technical documentation and ticket management`,
   `Knowledge-base documentation`, `Shift handover documentation`, `IT
   documentation creation and maintenance`. Your original note listed
   "Documentation" as a soft skill. But in an MSP, documentation quality is a
   billable technical competency and your JDs require it explicitly.
   **My recommendation: `core`.** Hiding it hides a real requirement.
2. **Root-cause analysis / troubleshooting.** `Root-cause analysis`,
   `Troubleshooting and root-cause analysis`, `Diagnostic data collection and
   analysis`. Adjacent to "Analytical thinking" but performed on infrastructure.
   **My recommendation: `core`.**
3. **Ticket handling.** `Ticket queue management`, `Ticket categorisation,
   tagging, escalation, and documentation`, `Escalated-ticket ownership and
   resolution`. Process skill, not technology, but it is the actual job.
   **My recommendation: `core`.**
4. **Customer service / English.** `Customer service via phone, email, and remote
   tools`, `Professional written English communication`.
   **My recommendation: `soft`** — genuinely behavioural. But for a
   customer-facing MSP role, English is arguably a hard filter. If you want it
   scored, say so and it becomes `core`.

## How it will be built

One module, `packages/web/src/api/lib/skill-class.ts`, used by every surface:

1. **Curated overrides** — an explicit map for the strings above and for anything
   you correct later. Instant, free, deterministic.
2. **Pattern rules** — `/\b(ability to|willingness to|years of|level \d)\b/` →
   `context`; a soft-trait keyword set → `soft`; a technology lexicon built from
   the `technologies` column → `core`. Catches the long tail without an LLM call.
3. **LLM fallback, cached** — only for strings the first two miss. Result written
   to a new `skill_classes` table keyed by the normalised string, so each unique
   skill is classified once for the lifetime of the system. No per-render calls,
   no per-match calls.
4. **Default when uncertain: `core`.** A misfiled technology that stays visible is
   a cosmetic annoyance; a technology wrongly hidden loses a real match. Fail
   toward showing.

Applied to: the Candidates skill chips, CV-JD Match matched/missing skills, the
JD required/nice skill lists, and the matching engine's skill scoring — the same
function in all four, so the classes cannot drift apart.

An admin screen to reclassify a skill by hand is deliberately **not** in this
batch. Say if you want it and it becomes its own small piece of work.
