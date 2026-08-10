import { useState } from "react";
import { Ban, Plus, Save, ShieldCheck, Trash2, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, SectionTitle } from "../components/ui/card";
import { PageHeader, TableShell, Td, Th, Tr } from "../components/ui/page";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Field, Input, Select, Switch } from "../components/ui/field";
import { ErrorNote, LoadingBlock, Spinner } from "../components/ui/feedback";
import { Tabs } from "../components/ui/modal";
import { ROLE_LABELS } from "../lib/auth";
import { QuestionSetsSettings } from "../components/settings/question-sets";
import { InterviewerVoiceCard } from "../components/settings/interviewer-voice";
import {
  useAddBlacklistReason,
  useRemoveBlacklistReason,
  useSettings,
  useUpdateSettings,
} from "../queries/insights";
import { useAuditLog, useMe, useSetActive, useSetRole, useTeamMembers } from "../queries/session";

type Tab = "scoring" | "interview" | "security" | "team" | "tags" | "audit";

const ROLES = ["super_admin", "agency_admin", "recruiter", "tech_interviewer", "client", "candidate"];

export default function SettingsPage() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const team = useTeamMembers();
  const setRole = useSetRole();
  const setActive = useSetActive();
  const addReason = useAddBlacklistReason();
  const removeReason = useRemoveBlacklistReason();
  const audit = useAuditLog(80);
  const me = useMe();

  const [tab, setTab] = useState<Tab>("scoring");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, number | boolean | string>>({});

  const isAdmin = me.data && "user" in me.data && ["super_admin", "agency_admin"].includes(me.data.user.role);
  const values = settings.data?.values;

  function field<T extends number | boolean | string>(key: string, current: T): T {
    return (draft[key] as T) ?? current;
  }

  async function save() {
    setError(null);
    try {
      await update.mutateAsync(draft as never);
      setDraft({});
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        subtitle="Scoring weights, the score-expiry window, team roles, blacklist reasons and the audit trail."
        actions={
          Object.keys(draft).length > 0 ? (
            <Button onClick={save} disabled={update.isPending} className="glow-primary">
              {update.isPending ? <Spinner /> : <Save className="size-4" />} Save changes
            </Button>
          ) : undefined
        }
      />

      {settings.isLoading && <LoadingBlock rows={4} />}
      {error && <ErrorNote message={error} className="mb-4" />}

      <Tabs
        className="rise rise-2 mb-4 w-fit"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "scoring", label: "Scoring & matching" },
          { value: "interview", label: "AI interview" },
          { value: "security", label: "Security & buckets" },
          { value: "team", label: "Team & roles", count: team.data?.length },
          { value: "tags", label: "Blacklist reasons", count: settings.data?.blacklistReasons.length },
          { value: "audit", label: "Audit trail" },
        ]}
      />

      {tab === "scoring" && values && (
        <div className="rise rise-3 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Matching & expiry</CardTitle>
                <p className="text-[12px] text-muted-foreground">
                  Expiry controls how long a match score stays valid before it is hidden and excluded.
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-3.5">
              <Field label="Agency name">
                <Input
                  disabled={!isAdmin}
                  defaultValue={settings.data?.agency?.name ?? ""}
                  onChange={(e) => setDraft({ ...draft, agencyName: e.target.value })}
                />
              </Field>
              <Field label="Shortlist threshold" hint="Auto-shortlist candidates at or above this match score.">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  disabled={!isAdmin}
                  value={field("shortlistThreshold", values.shortlistThreshold)}
                  onChange={(e) => setDraft({ ...draft, shortlistThreshold: Number(e.target.value) })}
                />
              </Field>
              <Field
                label="Score expiry (days)"
                hint={`Default ${settings.data?.defaults.scoreExpiryDays}. Past this window the score is withheld everywhere and the row is excluded from matching, ranking and search — the candidate stays visible with a one-click re-run.`}
              >
                <Input
                  type="number"
                  min={1}
                  max={730}
                  disabled={!isAdmin}
                  value={field("scoreExpiryDays", values.scoreExpiryDays)}
                  onChange={(e) => setDraft({ ...draft, scoreExpiryDays: Number(e.target.value) })}
                />
              </Field>
              <Switch
                checked={Boolean(field("aiInterviewEnabled", values.aiInterviewEnabled))}
                onChange={(v) => isAdmin && setDraft({ ...draft, aiInterviewEnabled: v })}
                label="AI voice interview stage enabled"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Final score weights</CardTitle>
                <p className="text-[12px] text-muted-foreground">
                  The technical interview is the primary signal. Weights always sum to 1.
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-3.5">
              <Field label="Match weight">
                <Input
                  type="number"
                  step={0.05}
                  min={0}
                  max={1}
                  disabled={!isAdmin}
                  value={field("matchWeight", values.matchWeight)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      matchWeight: Number(e.target.value),
                      techWeight: Math.round((1 - Number(e.target.value)) * 100) / 100,
                    })
                  }
                />
              </Field>
              <Field label="Technical weight">
                <Input
                  type="number"
                  step={0.05}
                  min={0}
                  max={1}
                  disabled={!isAdmin}
                  value={field("techWeight", values.techWeight)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      techWeight: Number(e.target.value),
                      matchWeight: Math.round((1 - Number(e.target.value)) * 100) / 100,
                    })
                  }
                />
              </Field>
              <div className="rounded-lg border border-border bg-white/[0.02] p-3.5">
                <p className="num text-[12.5px]">
                  final = match × {field("matchWeight", values.matchWeight)} + technical ×{" "}
                  {field("techWeight", values.techWeight)}
                </p>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                  The AI voice interview contributes qualitative signal only and is deliberately excluded from this
                  formula.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Backup & retention</CardTitle>
                <p className="text-[12px] text-muted-foreground">Used by the nightly backup and cleanup routines.</p>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3.5 sm:grid-cols-2">
              <Field label="Nightly backup time">
                <Input
                  type="time"
                  disabled={!isAdmin}
                  value={String(field("backupTime", values.backupTime))}
                  onChange={(e) => setDraft({ ...draft, backupTime: e.target.value })}
                />
              </Field>
              <Field label="Failure alert email">
                <Input
                  type="email"
                  disabled={!isAdmin}
                  value={String(field("backupAlertEmail", values.backupAlertEmail))}
                  onChange={(e) => setDraft({ ...draft, backupAlertEmail: e.target.value })}
                  placeholder="ops@agency.com"
                />
              </Field>
              <Field label="Daily backup retention (days)">
                <Input
                  type="number"
                  min={1}
                  max={365}
                  disabled={!isAdmin}
                  value={field("dailyRetentionDays", values.dailyRetentionDays)}
                  onChange={(e) => setDraft({ ...draft, dailyRetentionDays: Number(e.target.value) })}
                />
              </Field>
              <Field label="Weekly backup retention (days)">
                <Input
                  type="number"
                  min={1}
                  max={730}
                  disabled={!isAdmin}
                  value={field("weeklyRetentionDays", values.weeklyRetentionDays)}
                  onChange={(e) => setDraft({ ...draft, weeklyRetentionDays: Number(e.target.value) })}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Workspace</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-[12.5px]">
              <Row label="Agency" value={settings.data?.agency?.name ?? "—"} />
              <Row label="Slug" value={settings.data?.agency?.slug ?? "—"} />
              <Row label="Plan" value={settings.data?.agency?.subscriptionTier ?? "—"} />
              <Row
                label="Your role"
                value={
                  me.data && "user" in me.data ? (ROLE_LABELS[me.data.user.role] ?? me.data.user.role) : "—"
                }
              />
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "interview" && values && (
        <div className="rise rise-3 space-y-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Interview behaviour</CardTitle>
                <p className="text-[12px] text-muted-foreground">
                  Length, opening small talk and how quickly the interviewer steps in when a candidate goes quiet.
                </p>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3.5 sm:grid-cols-2">
              <Field label="Minimum length (minutes)">
                <Input
                  type="number"
                  min={3}
                  max={60}
                  disabled={!isAdmin}
                  value={field("aiInterviewMinMinutes", values.aiInterviewMinMinutes)}
                  onChange={(e) => setDraft({ ...draft, aiInterviewMinMinutes: Number(e.target.value) })}
                />
              </Field>
              <Field label="Maximum length (minutes)" hint="The interviewer wraps up automatically at this point.">
                <Input
                  type="number"
                  min={5}
                  max={90}
                  disabled={!isAdmin}
                  value={field("aiInterviewMaxMinutes", values.aiInterviewMaxMinutes)}
                  onChange={(e) => setDraft({ ...draft, aiInterviewMaxMinutes: Number(e.target.value) })}
                />
              </Field>
              <Field
                label="Silence nudge (seconds)"
                hint="After this much silence the interviewer checks in, then moves on."
              >
                <Input
                  type="number"
                  min={3}
                  max={60}
                  disabled={!isAdmin}
                  value={field("aiSilenceNudgeSeconds", values.aiSilenceNudgeSeconds)}
                  onChange={(e) => setDraft({ ...draft, aiSilenceNudgeSeconds: Number(e.target.value) })}
                />
              </Field>
              <div className="flex items-end">
                <Switch
                  checked={field("aiSmallTalkEnabled", values.aiSmallTalkEnabled)}
                  onChange={(v) => isAdmin && setDraft({ ...draft, aiSmallTalkEnabled: v })}
                  label="Open with friendly small talk before the first question"
                />
              </div>
            </CardContent>
          </Card>

          <InterviewerVoiceCard
            canEdit={Boolean(isAdmin)}
            value={field("aiVoice", values.aiVoice)}
            onChange={(voice) => setDraft({ ...draft, aiVoice: voice })}
          />

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Integrity &amp; proctoring</CardTitle>
                <p className="text-[12px] text-muted-foreground">
                  Camera recording, off-screen detection and the time penalty applied when a candidate leaves the
                  interview page.
                </p>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3.5 sm:grid-cols-2">
              <div className="flex items-end">
                <Switch
                  checked={field("aiProctoringEnabled", values.aiProctoringEnabled)}
                  onChange={(v) => isAdmin && setDraft({ ...draft, aiProctoringEnabled: v })}
                  label="Record camera and watch for integrity signals"
                />
              </div>
              <Field
                label="Off-screen penalty multiplier"
                hint="Seconds deducted from the interview clock per second spent away from the page."
              >
                <Input
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  disabled={!isAdmin}
                  value={field("aiAwayPenaltyMultiplier", values.aiAwayPenaltyMultiplier)}
                  onChange={(e) => setDraft({ ...draft, aiAwayPenaltyMultiplier: Number(e.target.value) })}
                />
              </Field>
            </CardContent>
          </Card>

          <QuestionSetsSettings canEdit={Boolean(isAdmin)} />
        </div>
      )}

      {tab === "security" && values && (
        <div className="rise rise-3 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Session security</CardTitle>
                <p className="text-[12px] text-muted-foreground">
                  Idle sessions are signed out server-side. Passwords are hashed with scrypt, sign-in is rate
                  limited per IP and per account, and HTTPS is enforced with HSTS on every non-local host.
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-3.5">
              <Field
                label="Auto sign-out after inactivity (minutes)"
                hint="Set to 0 to disable the idle timeout."
              >
                <Input
                  type="number"
                  min={0}
                  max={480}
                  disabled={!isAdmin}
                  value={field("sessionIdleMinutes", values.sessionIdleMinutes)}
                  onChange={(e) => setDraft({ ...draft, sessionIdleMinutes: Number(e.target.value) })}
                />
              </Field>
              <div className="rounded-lg border border-border bg-white/[0.02] p-3.5 text-[12px] leading-relaxed text-muted-foreground">
                Data is encrypted at rest by the managed database, and every backup artifact is separately
                encrypted with AES-256-GCM and checksummed before it leaves the server.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Bucket thresholds</CardTitle>
                <p className="text-[12px] text-muted-foreground">
                  When candidates are tagged automatically as hidden gems, and when repeated client rejections
                  remove them from the active system.
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-3.5">
              <Field
                label="Blue tag — minimum match at AI interview"
                hint="AI interview passed at or above this match score, then failed the technical round."
              >
                <Input
                  type="number"
                  min={0}
                  max={100}
                  disabled={!isAdmin}
                  value={field("blueTagMinAiMatch", values.blueTagMinAiMatch)}
                  onChange={(e) => setDraft({ ...draft, blueTagMinAiMatch: Number(e.target.value) })}
                />
              </Field>
              <Field
                label="Purple tag — minimum technical score"
                hint="Technical passed at or above this score, then rejected at the client interview."
              >
                <Input
                  type="number"
                  min={0}
                  max={100}
                  disabled={!isAdmin}
                  value={field("purpleTagMinTechScore", values.purpleTagMinTechScore)}
                  onChange={(e) => setDraft({ ...draft, purpleTagMinTechScore: Number(e.target.value) })}
                />
              </Field>
              <Field
                label="Client interview fail limit"
                hint="At this many failed client interviews the candidate is removed from the active pool."
              >
                <Input
                  type="number"
                  min={1}
                  max={10}
                  disabled={!isAdmin}
                  value={field("clientFailLimit", values.clientFailLimit)}
                  onChange={(e) => setDraft({ ...draft, clientFailLimit: Number(e.target.value) })}
                />
              </Field>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "team" && (
        <div className="rise rise-3">
          <SectionTitle
            title="Team & role-based access"
            hint="Admins manage everything; recruiters run sourcing and screening; technical interviewers see the evaluation queue only."
          />
          {team.isLoading && <LoadingBlock rows={3} />}
          {(team.data?.length ?? 0) > 0 && (
            <TableShell>
              <thead>
                <tr>
                  <Th>Member</Th>
                  <Th className="w-52">Role</Th>
                  <Th className="w-32">Status</Th>
                  <Th className="w-36">Joined</Th>
                </tr>
              </thead>
              <tbody>
                {(team.data ?? []).map((member) => (
                  <Tr key={member.id}>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <span className="grid size-8 place-items-center rounded-lg bg-primary/15 text-[12px] font-semibold text-primary-light">
                          {member.name.charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{member.name}</p>
                          <p className="truncate text-[11.5px] text-muted-foreground">{member.email}</p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <Select
                        disabled={!isAdmin}
                        value={member.role ?? "recruiter"}
                        onChange={(e) => setRole.mutate({ userId: member.id, role: e.target.value })}
                        className="h-8 text-[12px]"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                    </Td>
                    <Td>
                      <button
                        type="button"
                        disabled={!isAdmin}
                        onClick={() => setActive.mutate({ userId: member.id, isActive: !member.isActive })}
                      >
                        <Badge tone={member.isActive ? "success" : "danger"}>
                          {member.isActive ? "active" : "deactivated"}
                        </Badge>
                      </button>
                    </Td>
                    <Td className="num text-[11.5px] text-muted-foreground">
                      {new Date(member.createdAt).toLocaleDateString()}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
          )}
          <Card className="mt-4 flex items-center gap-3 p-4">
            <Users className="size-4 text-primary" />
            <p className="text-[12.5px] text-muted-foreground">
              New sign-ups join this workspace automatically as recruiters — promote them here.
            </p>
          </Card>
        </div>
      )}

      {tab === "tags" && (
        <div className="rise rise-3 max-w-2xl">
          <SectionTitle
            title="Blacklist reasons"
            hint="Selectable when a recruiter blacklists a candidate. Blacklisted candidates stay in the database with a red tag and can be restored by an admin."
          />
          <Card className="mb-4 flex items-end gap-2 p-3.5">
            <Field label="New reason" className="flex-1">
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Falsified experience"
                disabled={!isAdmin}
              />
            </Field>
            <Button
              onClick={async () => {
                if (!reason.trim()) return;
                await addReason.mutateAsync({ label: reason.trim() });
                setReason("");
              }}
              disabled={!isAdmin || addReason.isPending}
            >
              {addReason.isPending ? <Spinner /> : <Plus className="size-4" />} Add
            </Button>
          </Card>
          <div className="space-y-2">
            {(settings.data?.blacklistReasons ?? []).map((r) => (
              <Card key={r.id} className="flex items-center gap-3 p-3.5">
                <Ban className="size-4 text-destructive" />
                <p className="flex-1 text-[13px]">{r.label}</p>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => removeReason.mutate({ id: r.id })}
                    className="grid size-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {tab === "audit" && (
        <div className="rise rise-3">
          <SectionTitle title="Audit trail" hint="Every mutating action, who performed it and when." />
          {audit.isLoading && <LoadingBlock rows={5} />}
          {audit.isError && (
            <Card className="flex items-center gap-3 p-4">
              <ShieldCheck className="size-4 text-muted-foreground" />
              <p className="text-[13px] text-muted-foreground">Only admins can read the audit trail.</p>
            </Card>
          )}
          {(audit.data?.length ?? 0) > 0 && (
            <TableShell>
              <thead>
                <tr>
                  <Th className="w-52">When</Th>
                  <Th className="w-40">Who</Th>
                  <Th>Action</Th>
                  <Th className="w-48">Entity</Th>
                </tr>
              </thead>
              <tbody>
                {(audit.data ?? []).map((row) => (
                  <Tr key={row.id}>
                    <Td className="num text-[11.5px] text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString()}
                    </Td>
                    <Td className="text-[12.5px]">{row.userName ?? "system"}</Td>
                    <Td>
                      <Badge tone="muted">{row.action}</Badge>
                    </Td>
                    <Td className="num text-[11px] text-muted-foreground">
                      {row.entityType ? `${row.entityType}${row.entityId ? ` · ${row.entityId.slice(0, 12)}` : ""}` : "—"}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </div>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-2 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium capitalize">{value}</span>
    </div>
  );
}
