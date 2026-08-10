import { useState } from "react";
import {
  Archive,
  CheckCircle2,
  Download,
  HardDrive,
  Play,
  RotateCcw,
  Cloud,
  Save,
  ShieldAlert,
  Trash,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, SectionTitle } from "../components/ui/card";
import { PageHeader, StatCard, TableShell, Td, Th, Tr } from "../components/ui/page";
import { Button } from "../components/ui/button";
import { Badge, StatusBadge } from "../components/ui/badge";
import { EmptyState, ErrorNote, LoadingBlock, Spinner } from "../components/ui/feedback";
import { Modal, Tabs } from "../components/ui/modal";
import { Field, Input, Select, Switch } from "../components/ui/field";
import { titleCase } from "../lib/labels";
import {
  useBackupDownload,
  useBackupStatus,
  useCleanupPreview,
  useRestoreBackup,
  useRunBackup,
  useRunCleanup,
  useSaveBackupSchedule,
  useStorageBreakdown,
  useTestDrive,
} from "../queries/insights";
import { useMe } from "../queries/session";

type Tab = "settings" | "backups" | "retention" | "storage";

function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export default function BackupPage() {
  const status = useBackupStatus();
  const storage = useStorageBreakdown();
  const preview = useCleanupPreview();
  const runBackup = useRunBackup();
  const runCleanup = useRunCleanup();
  const restore = useRestoreBackup();
  const download = useBackupDownload();
  const me = useMe();

  const [tab, setTab] = useState<Tab>("settings");
  const saveSchedule = useSaveBackupSchedule();
  const testDrive = useTestDrive();
  const [scheduleForm, setScheduleForm] = useState<{
    autoBackupEnabled: boolean;
    backupFrequency: "daily" | "weekly" | "monthly";
    backupTime: string;
    backupProvider: "tigris" | "gdrive";
    backupRetainCopies: number;
    backupAlertEmail: string;
    dailyRetentionDays: number;
    weeklyRetentionDays: number;
    gdriveFolderId: string;
    gdriveClientId: string;
    gdriveClientSecret: string;
    gdriveRefreshToken: string;
  } | null>(null);

  /* Hydrate the form once the saved settings arrive. */
  const settings = status.data?.settings;
  if (settings && !scheduleForm) {
    setScheduleForm({
      autoBackupEnabled: settings.autoBackupEnabled,
      backupFrequency: settings.backupFrequency as "daily" | "weekly" | "monthly",
      backupTime: settings.backupTime,
      backupProvider: settings.backupProvider as "tigris" | "gdrive",
      backupRetainCopies: settings.backupRetainCopies,
      backupAlertEmail: settings.backupAlertEmail,
      dailyRetentionDays: settings.dailyRetentionDays,
      weeklyRetentionDays: settings.weeklyRetentionDays,
      gdriveFolderId: settings.gdriveFolderId,
      gdriveClientId: settings.gdriveClientId,
      gdriveClientSecret: settings.gdriveClientSecret,
      gdriveRefreshToken: settings.gdriveRefreshToken,
    });
  }
  const [error, setError] = useState<string | null>(null);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const isSuperAdmin = me.data && "user" in me.data && me.data.user.role === "super_admin";

  async function backupNow(tier: "daily" | "weekly" | "monthly" | "manual") {
    setError(null);
    setNote(null);
    try {
      const result = await runBackup.mutateAsync({ tier });
      setNote(
        `Backup ${result.fileName} created — ${result.recordCount} records, ${bytes(result.sizeBytes)}, ${
          result.durationSeconds
        }s. Pruned ${result.pruned} old artifacts.`,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Backup & recovery"
        subtitle="AES-256-GCM encrypted, gzipped snapshots with SHA-256 checksums, tiered retention, and the data-retention cleanup rules that anonymize stale PII while preserving placements."
        actions={
          isSuperAdmin ? (
            <>
              <Button variant="outline" onClick={() => backupNow("daily")} disabled={runBackup.isPending}>
                Daily snapshot
              </Button>
              <Button onClick={() => backupNow("manual")} disabled={runBackup.isPending} className="glow-primary">
                {runBackup.isPending ? <Spinner /> : <Play className="size-4" />} Back up now
              </Button>
            </>
          ) : undefined
        }
      />

      {error && <ErrorNote message={error} className="mb-4" />}
      {note && (
        <Card className="mb-4 flex items-center gap-3 border-success/25 p-3.5">
          <CheckCircle2 className="size-4 text-success" />
          <p className="text-[13px] text-success">{note}</p>
        </Card>
      )}

      {status.isLoading && <LoadingBlock rows={3} />}

      {status.data && (
        <>
          <div className="rise rise-2 mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Backup health"
              value={status.data.healthy ? "Healthy" : "Attention"}
              hint={
                status.data.consecutiveFailures > 0
                  ? `${status.data.consecutiveFailures} consecutive failures`
                  : "No consecutive failures"
              }
              icon={status.data.healthy ? CheckCircle2 : ShieldAlert}
              tone={status.data.healthy ? "success" : "danger"}
            />
            <StatCard
              label="Successful backups"
              value={status.data.totalBackups}
              hint={
                status.data.lastBackup
                  ? `last ${new Date(status.data.lastBackup.createdAt).toLocaleString()}`
                  : "none yet"
              }
              icon={Archive}
              tone="primary"
            />
            <StatCard
              label="Storage used"
              value={bytes(status.data.storageUsedBytes)}
              hint="Encrypted artifacts in object storage"
              icon={HardDrive}
              tone="info"
            />
            <StatCard
              label="Next scheduled"
              value={new Date(status.data.nextBackupAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
              hint={`Nightly at ${status.data.settings.backupTime} · daily kept ${status.data.settings.dailyRetentionDays}d`}
              icon={Archive}
              tone="warning"
            />
          </div>

          {!isSuperAdmin && (
            <Card className="mb-4 flex items-center gap-3 p-4">
              <ShieldAlert className="size-4 text-warning" />
              <p className="text-[13px] text-muted-foreground">
                You can review backup health and retention, but only a super admin can run backups, restores or
                cleanup.
              </p>
            </Card>
          )}

          <Tabs
            className="rise rise-2 mb-4 w-fit"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "settings", label: "Backup settings" },
              { value: "backups", label: "Backup history", count: status.data.history.length },
              { value: "retention", label: "Retention rules", count: preview.data?.length },
              { value: "storage", label: "Storage" },
            ]}
          />

          {tab === "settings" && scheduleForm && (
            <div className="rise rise-3 space-y-4">
              <Card className="p-5">
                <SectionTitle
                  title="Automatic backups"
                  hint="The server runs an encrypted snapshot at the scheduled time and prunes old artifacts automatically."
                  right={
                    <Badge tone={status.data.schedule.autoBackupEnabled ? "success" : "muted"}>
                      {status.data.schedule.autoBackupEnabled ? "Scheduled" : "Off"}
                    </Badge>
                  }
                />

                <div className="space-y-4">
                  <Switch
                    checked={scheduleForm.autoBackupEnabled}
                    onChange={(v) => setScheduleForm({ ...scheduleForm, autoBackupEnabled: v })}
                    label="Back up the database automatically on a schedule"
                  />

                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Frequency">
                      <Select
                        value={scheduleForm.backupFrequency}
                        onChange={(e) =>
                          setScheduleForm({
                            ...scheduleForm,
                            backupFrequency: e.target.value as "daily" | "weekly" | "monthly",
                          })
                        }
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly (Sundays)</option>
                        <option value="monthly">Monthly (1st)</option>
                      </Select>
                    </Field>
                    <Field label="Time (24h)" hint="Server local time">
                      <Input
                        type="time"
                        value={scheduleForm.backupTime}
                        onChange={(e) => setScheduleForm({ ...scheduleForm, backupTime: e.target.value })}
                      />
                    </Field>
                    <Field label="Copies to retain">
                      <Input
                        type="number"
                        min={1}
                        max={365}
                        value={scheduleForm.backupRetainCopies}
                        onChange={(e) =>
                          setScheduleForm({ ...scheduleForm, backupRetainCopies: Number(e.target.value) })
                        }
                      />
                    </Field>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Daily retention (days)">
                      <Input
                        type="number"
                        min={1}
                        max={365}
                        value={scheduleForm.dailyRetentionDays}
                        onChange={(e) =>
                          setScheduleForm({ ...scheduleForm, dailyRetentionDays: Number(e.target.value) })
                        }
                      />
                    </Field>
                    <Field label="Weekly retention (days)">
                      <Input
                        type="number"
                        min={1}
                        max={730}
                        value={scheduleForm.weeklyRetentionDays}
                        onChange={(e) =>
                          setScheduleForm({ ...scheduleForm, weeklyRetentionDays: Number(e.target.value) })
                        }
                      />
                    </Field>
                    <Field label="Failure alert email">
                      <Input
                        type="email"
                        placeholder="ops@agency.com"
                        value={scheduleForm.backupAlertEmail}
                        onChange={(e) =>
                          setScheduleForm({ ...scheduleForm, backupAlertEmail: e.target.value })
                        }
                      />
                    </Field>
                  </div>

                  <div className="rounded-lg border border-border bg-white/[0.02] p-3.5 text-[12px] text-muted-foreground">
                    Next run:{" "}
                    <span className="num text-foreground">
                      {status.data.schedule.nextRunAt
                        ? new Date(status.data.schedule.nextRunAt).toLocaleString()
                        : "not scheduled"}
                    </span>
                    {status.data.schedule.lastRunAt && (
                      <>
                        {" · "}last run{" "}
                        <span className="num text-foreground">
                          {new Date(status.data.schedule.lastRunAt).toLocaleString()}
                        </span>{" "}
                        ({titleCase(status.data.schedule.lastStatus ?? "unknown")})
                      </>
                    )}
                    {status.data.schedule.lastError && (
                      <span className="mt-1 block text-destructive">{status.data.schedule.lastError}</span>
                    )}
                  </div>
                </div>
              </Card>

              <Card className="p-5">
                <SectionTitle
                  title="Destination"
                  hint="Encrypted artifacts always land in object storage. Google Drive adds an off-platform mirror."
                  right={
                    <Badge tone={status.data.schedule.driveConnected ? "success" : "muted"}>
                      <Cloud className="size-3" />
                      {status.data.schedule.driveConnected ? "Drive connected" : "Drive not connected"}
                    </Badge>
                  }
                />

                <div className="space-y-4">
                  <Field label="Backup destination">
                    <Select
                      value={scheduleForm.backupProvider}
                      onChange={(e) =>
                        setScheduleForm({
                          ...scheduleForm,
                          backupProvider: e.target.value as "tigris" | "gdrive",
                        })
                      }
                    >
                      <option value="tigris">Object storage only</option>
                      <option value="gdrive">Object storage + Google Drive mirror</option>
                    </Select>
                  </Field>

                  {scheduleForm.backupProvider === "gdrive" && (
                    <div className="space-y-4 rounded-lg border border-border bg-white/[0.02] p-4">
                      <p className="text-[12px] leading-relaxed text-muted-foreground">
                        Create an OAuth client in Google Cloud, authorise the Drive scope once, and paste the
                        refresh token here. Secrets are stored server-side and never returned to the browser.
                      </p>
                      <Field label="Client ID">
                        <Input
                          value={scheduleForm.gdriveClientId}
                          onChange={(e) => setScheduleForm({ ...scheduleForm, gdriveClientId: e.target.value })}
                          placeholder="xxxxx.apps.googleusercontent.com"
                        />
                      </Field>
                      <Field label="Client secret">
                        <Input
                          type="password"
                          value={scheduleForm.gdriveClientSecret}
                          onChange={(e) =>
                            setScheduleForm({ ...scheduleForm, gdriveClientSecret: e.target.value })
                          }
                          placeholder="GOCSPX-…"
                        />
                      </Field>
                      <Field label="Refresh token">
                        <Input
                          type="password"
                          value={scheduleForm.gdriveRefreshToken}
                          onChange={(e) =>
                            setScheduleForm({ ...scheduleForm, gdriveRefreshToken: e.target.value })
                          }
                          placeholder="1//0g…"
                        />
                      </Field>
                      <Field label="Destination folder ID" hint="Optional — leave blank for My Drive root">
                        <Input
                          value={scheduleForm.gdriveFolderId}
                          onChange={(e) => setScheduleForm({ ...scheduleForm, gdriveFolderId: e.target.value })}
                          placeholder="1AbCdEf…"
                        />
                      </Field>
                      {isSuperAdmin && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={testDrive.isPending}
                          onClick={() => testDrive.mutate({})}
                        >
                          {testDrive.isPending ? <Spinner /> : <Cloud className="size-3.5" />}
                          Test connection
                        </Button>
                      )}
                      {testDrive.data && (
                        <p className={testDrive.data.ok ? "text-[12px] text-success" : "text-[12px] text-destructive"}>
                          {testDrive.data.ok
                            ? `Connected as ${testDrive.data.account ?? "Google account"}${
                                testDrive.data.folderId ? ` · folder ${testDrive.data.folderId}` : ""
                              }`
                            : testDrive.data.error}
                        </p>
                      )}
                    </div>
                  )}

                  {isSuperAdmin ? (
                    <Button
                      disabled={saveSchedule.isPending}
                      onClick={() => saveSchedule.mutate(scheduleForm)}
                    >
                      {saveSchedule.isPending ? <Spinner /> : <Save className="size-4" />}
                      Save backup settings
                    </Button>
                  ) : (
                    <p className="text-[12px] text-muted-foreground">
                      Only a super admin can change backup settings.
                    </p>
                  )}
                  {saveSchedule.isSuccess && (
                    <p className="text-[12px] text-success">
                      Saved. Next run{" "}
                      {saveSchedule.data.nextRunAt
                        ? new Date(saveSchedule.data.nextRunAt).toLocaleString()
                        : "not scheduled"}
                      .
                    </p>
                  )}
                </div>
              </Card>
            </div>
          )}

          {tab === "backups" && (
            <div className="rise rise-3">
              {status.data.history.length === 0 ? (
                <EmptyState
                  icon={Archive}
                  title="No backups yet"
                  body="Run a manual snapshot to verify the pipeline end to end — encryption, checksum and upload."
                  action={
                    isSuperAdmin ? (
                      <Button onClick={() => backupNow("manual")} disabled={runBackup.isPending}>
                        {runBackup.isPending ? <Spinner /> : <Play className="size-4" />} Back up now
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <TableShell>
                  <thead>
                    <tr>
                      <Th className="w-44">When</Th>
                      <Th>Artifact</Th>
                      <Th className="w-24">Tier</Th>
                      <Th className="w-28">Size</Th>
                      <Th className="w-24">Records</Th>
                      <Th className="w-28">Status</Th>
                      <Th className="w-44" />
                    </tr>
                  </thead>
                  <tbody>
                    {status.data.history.map((row) => (
                      <Tr key={row.id}>
                        <Td className="num text-[11.5px] text-muted-foreground">
                          {new Date(row.createdAt).toLocaleString()}
                        </Td>
                        <Td>
                          <p className="num max-w-[240px] truncate text-[12px]">{row.fileName}</p>
                          {row.checksum && (
                            <p className="num truncate text-[10px] text-muted-foreground/70">
                              sha256 {row.checksum.slice(0, 16)}…
                            </p>
                          )}
                          {row.errorMessage && (
                            <p className="text-[11px] text-destructive">{row.errorMessage}</p>
                          )}
                        </Td>
                        <Td>
                          <Badge tone="muted">{row.backupType}</Badge>
                        </Td>
                        <Td className="num text-[12px]">{bytes(row.fileSizeBytes)}</Td>
                        <Td className="num text-[12px]">{row.recordCount}</Td>
                        <Td>
                          <StatusBadge status={row.status} />
                        </Td>
                        <Td>
                          {isSuperAdmin && row.status === "success" && (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={async () => {
                                  const result = await download.mutateAsync({ id: row.id });
                                  window.open(result.url, "_blank", "noopener");
                                }}
                                disabled={download.isPending}
                                className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] transition-colors hover:border-border-hover"
                              >
                                <Download className="size-3" /> Download
                              </button>
                              <button
                                type="button"
                                onClick={() => setRestoreId(row.id)}
                                className="flex items-center gap-1 rounded-md border border-warning/35 bg-warning/10 px-2 py-1 text-[11px] text-warning transition-colors hover:bg-warning/15"
                              >
                                <RotateCcw className="size-3" /> Restore
                              </button>
                            </div>
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </TableShell>
              )}
            </div>
          )}

          {tab === "retention" && (
            <div className="rise rise-3 space-y-4">
              <SectionTitle
                title="Data retention & cleanup"
                hint="Preview is read-only. Hired candidates and placement records are never touched."
                right={
                  isSuperAdmin ? (
                    <Button
                      variant="outline"
                      onClick={() => runCleanup.mutate({})}
                      disabled={runCleanup.isPending}
                    >
                      {runCleanup.isPending ? <Spinner /> : <Trash className="size-3.5" />} Run cleanup
                    </Button>
                  ) : undefined
                }
              />
              {preview.isLoading && <LoadingBlock rows={4} />}
              <div className="grid gap-3 lg:grid-cols-2">
                {(preview.data ?? []).map((rule) => (
                  <Card key={rule.rule} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-display text-[14px] font-semibold capitalize">
                          {titleCase(rule.rule)}
                        </p>
                        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{rule.detail}</p>
                      </div>
                      <span
                        className={
                          rule.affected > 0
                            ? "num shrink-0 rounded-lg border border-warning/35 bg-warning/10 px-2.5 py-1 font-display text-[16px] font-bold text-warning"
                            : "num shrink-0 rounded-lg border border-border px-2.5 py-1 font-display text-[16px] font-bold text-muted-foreground"
                        }
                      >
                        {rule.affected}
                      </span>
                    </div>
                  </Card>
                ))}
              </div>

              {status.data.cleanup.length > 0 && (
                <>
                  <SectionTitle title="Cleanup log" className="pt-2" />
                  <TableShell>
                    <thead>
                      <tr>
                        <Th className="w-44">When</Th>
                        <Th className="w-52">Rule</Th>
                        <Th className="w-24">Affected</Th>
                        <Th>Detail</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {status.data.cleanup.map((row) => (
                        <Tr key={row.id}>
                          <Td className="num text-[11.5px] text-muted-foreground">
                            {new Date(row.runAt).toLocaleString()}
                          </Td>
                          <Td className="text-[12.5px]">{titleCase(row.rule)}</Td>
                          <Td className="num text-[12.5px]">{row.affectedCount}</Td>
                          <Td className="text-[12px] text-muted-foreground">{row.details}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </TableShell>
                </>
              )}
            </div>
          )}

          {tab === "storage" && (
            <div className="rise rise-3 grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Candidate data</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5 text-[12.5px]">
                  {storage.isLoading && <Spinner />}
                  {storage.data &&
                    Object.entries(storage.data).map(([key, value]) => (
                      <div
                        key={key}
                        className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-2 last:border-0 last:pb-0"
                      >
                        <span className="capitalize text-muted-foreground">
                          {key.replace(/([A-Z])/g, " $1").toLowerCase()}
                        </span>
                        <span className="num font-semibold">{String(value)}</span>
                      </div>
                    ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>How backups work</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
                  <p>
                    Each snapshot serialises every table to JSON, gzips it, encrypts it with AES-256-GCM and uploads
                    the artifact to object storage alongside a SHA-256 checksum.
                  </p>
                  <p>
                    Daily artifacts are pruned after {status.data.settings.dailyRetentionDays} days and weekly ones
                    after {status.data.settings.weeklyRetentionDays} days. Monthly and manual artifacts are kept.
                  </p>
                  <p>
                    Restores verify the checksum before writing, and run inside a single pass so a partial artifact
                    can never overwrite live data.
                  </p>
                  <p className="text-warning">
                    Placements are stored denormalized, so the Placed register survives even after candidate PII is
                    anonymized by retention rules.
                  </p>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      <Modal
        open={Boolean(restoreId)}
        onClose={() => setRestoreId(null)}
        title="Restore from this backup?"
        description="Rows in the artifact overwrite live rows with the same id. Anything created after the snapshot is left untouched. This cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRestoreId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!restoreId) return;
                setError(null);
                try {
                  const result = await restore.mutateAsync({ id: restoreId });
                  setNote(`Restored ${result.restored} records from ${result.fileName}.`);
                } catch (e) {
                  setError((e as Error).message);
                }
                setRestoreId(null);
              }}
              disabled={restore.isPending}
            >
              {restore.isPending && <Spinner />} Restore now
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-muted-foreground">
          Run a fresh manual backup first if you want a rollback point.
        </p>
      </Modal>
    </>
  );
}
