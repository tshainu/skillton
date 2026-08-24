import { useState } from "react";
import { Link } from "wouter";
import {
  Briefcase,
  Building2,
  ChevronDown,
  Link2,
  Mail,
  Phone,
  Plus,
  Trash2,
  Trophy,
} from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import { PageHeader } from "../components/ui/page";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Field, Input, Select, Textarea } from "../components/ui/field";
import { EmptyState, ErrorNote, LoadingBlock, Spinner } from "../components/ui/feedback";
import { Modal } from "../components/ui/modal";
import { useConfirm, useToast } from "../components/ui/toast";
import {
  useClient,
  useClients,
  useCreateClient,
  useDeleteClient,
  useLinkClientsFromJobs,
  useUpdateClient,
} from "../queries/clients";

interface FormState {
  id?: string;
  companyName: string;
  industry: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  cultureNotes: string;
  /* --------------------------------- sourcing, culture and commercials */
  website: string;
  companySize: string;
  headquarters: string;
  locations: string;
  accountManager: string;
  contactRole: string;
  sourceChannel: string;
  relationshipStatus: string;
  contractType: string;
  feeStructure: string;
  paymentTerms: string;
  slaDays: string;
  workModel: string;
  techStack: string;
  benefits: string;
  interviewProcess: string;
  dealBreakers: string;
  idealCandidateProfile: string;
  notes: string;
}

const EMPTY: FormState = {
  companyName: "",
  industry: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  cultureNotes: "",
  website: "",
  companySize: "",
  headquarters: "",
  locations: "",
  accountManager: "",
  contactRole: "",
  sourceChannel: "direct",
  relationshipStatus: "active",
  contractType: "",
  feeStructure: "",
  paymentTerms: "",
  slaDays: "",
  workModel: "",
  techStack: "",
  benefits: "",
  interviewProcess: "",
  dealBreakers: "",
  idealCandidateProfile: "",
  notes: "",
};

/** Comma-separated input -> string[]. */
function list(value: string): string[] | undefined {
  const items = value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

export default function ClientsPage() {
  const confirm = useConfirm();
  const toast = useToast();
  const clients = useClients();
  const create = useCreateClient();
  const update = useUpdateClient();
  const remove = useDeleteClient();
  const linkFromJobs = useLinkClientsFromJobs();

  const [detailId, setDetailId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const editing = Boolean(form.id);
  const pending = create.isPending || update.isPending;

  function edit(client: FormState) {
    setForm(client);
    setError(null);
    setOpen(true);
  }

  async function submit() {
    setError(null);
    const payload = {
      companyName: form.companyName.trim(),
      industry: form.industry || undefined,
      contactName: form.contactName || undefined,
      contactEmail: form.contactEmail || undefined,
      contactPhone: form.contactPhone || undefined,
      cultureNotes: form.cultureNotes || undefined,
      website: form.website || undefined,
      companySize: form.companySize || undefined,
      headquarters: form.headquarters || undefined,
      locations: list(form.locations),
      accountManager: form.accountManager || undefined,
      contactRole: form.contactRole || undefined,
      sourceChannel: (form.sourceChannel || undefined) as never,
      relationshipStatus: (form.relationshipStatus || undefined) as never,
      contractType: form.contractType || undefined,
      feeStructure: form.feeStructure || undefined,
      paymentTerms: form.paymentTerms || undefined,
      slaDays: form.slaDays ? Number(form.slaDays) : undefined,
      workModel: (form.workModel || undefined) as never,
      techStack: list(form.techStack),
      benefits: list(form.benefits),
      interviewProcess: form.interviewProcess || undefined,
      dealBreakers: form.dealBreakers || undefined,
      idealCandidateProfile: form.idealCandidateProfile || undefined,
      notes: form.notes || undefined,
    };
    if (!payload.companyName) return setError("Company name is required");
    try {
      if (form.id) await update.mutateAsync({ id: form.id, ...payload });
      else await create.mutateAsync(payload);
      setOpen(false);
      setForm(EMPTY);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Sourcing"
        title="Clients"
        subtitle="The companies you hire for. Culture notes and preferences feed the AI match explanations and interview prompts."
        actions={
          <>
            {/* Every JD already names its client, in the title or the document.
                Deriving beats asking a recruiter to retype what is on file. */}
            <Button
              variant="ghost"
              disabled={linkFromJobs.isPending}
              onClick={() =>
                linkFromJobs.mutate(
                  {},
                  {
                    onSuccess: (r) =>
                      toast({
                        tone: r.linked || r.created ? "success" : "info",
                        title: r.created
                          ? `${r.created} client${r.created === 1 ? "" : "s"} created`
                          : r.linked
                            ? `${r.linked} job${r.linked === 1 ? "" : "s"} linked`
                            : "Nothing new to link",
                        description: r.unresolved.length
                          ? `${r.unresolved.length} JD${r.unresolved.length === 1 ? "" : "s"} name no client — set those by hand.`
                          : `Scanned ${r.scanned} job description${r.scanned === 1 ? "" : "s"}.`,
                      }),
                    onError: (error) =>
                      toast({ tone: "error", title: "Link failed", description: error.message }),
                  },
                )
              }
            >
              <Link2 className="size-4" />
              {linkFromJobs.isPending ? "Scanning JDs…" : "Derive from JDs"}
            </Button>
            <Button
              onClick={() => {
                setForm(EMPTY);
                setOpen(true);
              }}
              className="glow-primary"
            >
              <Plus className="size-4" /> New client
            </Button>
          </>
        }
      />

      {clients.isLoading && <LoadingBlock rows={3} />}

      {clients.data?.length === 0 && (
        <EmptyState
          icon={Building2}
          title="No clients yet"
          body="Add the company you're hiring for, then attach job descriptions to it."
          action={
            <Button
              onClick={() => {
                setForm(EMPTY);
                setOpen(true);
              }}
            >
              <Plus className="size-4" /> Add your first client
            </Button>
          }
        />
      )}

      <div className="rise rise-2 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(clients.data ?? []).map((client) => (
          <Card key={client.id} hover className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate font-display text-[15px] font-semibold">{client.companyName}</h3>
                {client.industry && (
                  <Badge tone="muted" className="mt-1.5">
                    {client.industry}
                  </Badge>
                )}
              </div>
              <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-white/[0.03]">
                <Building2 className="size-4 text-primary" />
              </span>
            </div>

            <div className="mt-4 space-y-1.5 text-[12.5px] text-muted-foreground">
              {client.contactName && <p className="truncate">{client.contactName}</p>}
              {client.contactEmail && (
                <p className="flex items-center gap-1.5 truncate">
                  <Mail className="size-3.5 shrink-0" /> {client.contactEmail}
                </p>
              )}
              {client.contactPhone && (
                <p className="flex items-center gap-1.5 truncate">
                  <Phone className="size-3.5 shrink-0" /> {client.contactPhone}
                </p>
              )}
            </div>

            {client.cultureNotes && (
              <p className="mt-3 line-clamp-2 text-[12px] italic leading-relaxed text-muted-foreground/80">
                “{client.cultureNotes}”
              </p>
            )}

            <div className="mt-4 flex items-center gap-3 border-t border-border pt-3 text-[12px]">
              <span className="flex items-center gap-1.5">
                <Briefcase className="size-3.5 text-info" />
                <span className="num font-semibold">{client.openJobs}</span>
                <span className="text-muted-foreground">open</span>
              </span>
              <span className="flex items-center gap-1.5">
                <Trophy className="size-3.5 text-success" />
                <span className="num font-semibold">{client.placements}</span>
                <span className="text-muted-foreground">placed</span>
              </span>
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setDetailId(client.id)}
                  className="rounded-md border border-border px-2 py-1 text-[11px] transition-colors hover:border-border-hover"
                >
                  Jobs
                </button>
                <button
                  type="button"
                  onClick={() =>
                    edit({
                      id: client.id,
                      companyName: client.companyName,
                      industry: client.industry ?? "",
                      contactName: client.contactName ?? "",
                      contactEmail: client.contactEmail ?? "",
                      contactPhone: client.contactPhone ?? "",
                      cultureNotes: client.cultureNotes ?? "",
                      website: client.website ?? "",
                      companySize: client.companySize ?? "",
                      headquarters: client.headquarters ?? "",
                      locations: (client.locations ?? []).join(", "),
                      accountManager: client.accountManager ?? "",
                      contactRole: client.contactRole ?? "",
                      sourceChannel: client.sourceChannel ?? "direct",
                      relationshipStatus: client.relationshipStatus ?? "active",
                      contractType: client.contractType ?? "",
                      feeStructure: client.feeStructure ?? "",
                      paymentTerms: client.paymentTerms ?? "",
                      slaDays: client.slaDays != null ? String(client.slaDays) : "",
                      workModel: client.workModel ?? "",
                      techStack: (client.techStack ?? []).join(", "),
                      benefits: (client.benefits ?? []).join(", "),
                      interviewProcess: client.interviewProcess ?? "",
                      dealBreakers: client.dealBreakers ?? "",
                      idealCandidateProfile: client.idealCandidateProfile ?? "",
                      notes: client.notes ?? "",
                    })
                  }
                  className="rounded-md border border-border px-2 py-1 text-[11px] transition-colors hover:border-border-hover"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Delete ${client.companyName}?`,
                      description: "Job descriptions stay but lose the link to this client.",
                      confirmLabel: "Delete client",
                      tone: "danger",
                    });
                    if (!ok) return;
                    remove.mutate(
                      { id: client.id },
                      {
                        onSuccess: () => toast({ tone: "success", title: "Client deleted" }),
                        onError: (error) =>
                          toast({ tone: "error", title: "Delete failed", description: error.message }),
                      },
                    );
                  }}
                  className="grid size-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <ClientJobsModal id={detailId} onClose={() => setDetailId(null)} />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        width="max-w-3xl"
        title={editing ? "Edit client" : "New client"}
        description="Culture, commercials and hiring preferences all feed the AI when it explains fit and drafts interview focus areas."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending && <Spinner />}
              {editing ? "Save changes" : "Create client"}
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          {error && <ErrorNote message={error} />}
          <Field label="Company name">
            <Input
              value={form.companyName}
              onChange={(e) => setForm({ ...form, companyName: e.target.value })}
              placeholder="Northwind Fintech"
            />
          </Field>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Industry">
              <Input
                value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
                placeholder="Financial Services"
              />
            </Field>
            <Field label="Contact name">
              <Input
                value={form.contactName}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                placeholder="Priya Raman"
              />
            </Field>
            <Field label="Contact email">
              <Input
                type="email"
                value={form.contactEmail}
                onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                placeholder="priya@northwind.io"
              />
            </Field>
            <Field label="Contact phone">
              <Input
                value={form.contactPhone}
                onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                placeholder="+94 11 234 5678"
              />
            </Field>
          </div>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Contact role">
              <Input
                value={form.contactRole}
                onChange={(e) => setForm({ ...form, contactRole: e.target.value })}
                placeholder="VP Engineering"
              />
            </Field>
            <Field label="Website">
              <Input
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                placeholder="https://northwind.io"
              />
            </Field>
          </div>

          <p className="pt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            Company profile
          </p>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Company size">
              <Input
                value={form.companySize}
                onChange={(e) => setForm({ ...form, companySize: e.target.value })}
                placeholder="250–500"
              />
            </Field>
            <Field label="Headquarters">
              <Input
                value={form.headquarters}
                onChange={(e) => setForm({ ...form, headquarters: e.target.value })}
                placeholder="Singapore"
              />
            </Field>
            <Field label="Hiring locations" hint="Comma separated">
              <Input
                value={form.locations}
                onChange={(e) => setForm({ ...form, locations: e.target.value })}
                placeholder="Colombo, Singapore, Remote (APAC)"
              />
            </Field>
            <Field label="Work model">
              <Select value={form.workModel} onChange={(e) => setForm({ ...form, workModel: e.target.value })}>
                <option value="">Not specified</option>
                <option value="onsite">Onsite</option>
                <option value="hybrid">Hybrid</option>
                <option value="remote">Remote</option>
              </Select>
            </Field>
            <Field label="Tech stack" hint="Comma separated">
              <Input
                value={form.techStack}
                onChange={(e) => setForm({ ...form, techStack: e.target.value })}
                placeholder="Node.js, TypeScript, AWS"
              />
            </Field>
            <Field label="Benefits" hint="Comma separated">
              <Input
                value={form.benefits}
                onChange={(e) => setForm({ ...form, benefits: e.target.value })}
                placeholder="Full remote, Private medical, Learning budget"
              />
            </Field>
          </div>

          <p className="pt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            Relationship & commercials
          </p>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Account manager">
              <Input
                value={form.accountManager}
                onChange={(e) => setForm({ ...form, accountManager: e.target.value })}
                placeholder="Priyanka de Silva"
              />
            </Field>
            <Field label="Source channel">
              <Select
                value={form.sourceChannel}
                onChange={(e) => setForm({ ...form, sourceChannel: e.target.value })}
              >
                <option value="direct">Direct</option>
                <option value="referral">Referral</option>
                <option value="inbound">Inbound</option>
                <option value="linkedin">LinkedIn</option>
                <option value="event">Event</option>
                <option value="partner">Partner</option>
              </Select>
            </Field>
            <Field label="Relationship status">
              <Select
                value={form.relationshipStatus}
                onChange={(e) => setForm({ ...form, relationshipStatus: e.target.value })}
              >
                <option value="active">Active</option>
                <option value="prospect">Prospect</option>
                <option value="dormant">Dormant</option>
                <option value="churned">Churned</option>
              </Select>
            </Field>
            <Field label="Contract type">
              <Input
                value={form.contractType}
                onChange={(e) => setForm({ ...form, contractType: e.target.value })}
                placeholder="Contingency / Retained"
              />
            </Field>
            <Field label="Fee structure">
              <Input
                value={form.feeStructure}
                onChange={(e) => setForm({ ...form, feeStructure: e.target.value })}
                placeholder="18% of first-year CTC"
              />
            </Field>
            <Field label="Payment terms">
              <Input
                value={form.paymentTerms}
                onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
                placeholder="Net 30"
              />
            </Field>
            <Field label="SLA (days to shortlist)">
              <Input
                type="number"
                min={0}
                max={365}
                value={form.slaDays}
                onChange={(e) => setForm({ ...form, slaDays: e.target.value })}
                placeholder="14"
              />
            </Field>
          </div>

          <p className="pt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            Hiring preferences
          </p>
          <Field label="Culture & hiring notes">
            <Textarea
              value={form.cultureNotes}
              onChange={(e) => setForm({ ...form, cultureNotes: e.target.value })}
              placeholder="Fast-moving, remote-first, values ownership over process. Three interview rounds max."
            />
          </Field>
          <Field label="Interview process">
            <Textarea
              value={form.interviewProcess}
              onChange={(e) => setForm({ ...form, interviewProcess: e.target.value })}
              placeholder="HR screen → technical (2 rounds) → system design → founder chat"
            />
          </Field>
          <Field label="Ideal candidate profile">
            <Textarea
              value={form.idealCandidateProfile}
              onChange={(e) => setForm({ ...form, idealCandidateProfile: e.target.value })}
              placeholder="Product-minded backend engineers from high-throughput payments systems."
            />
          </Field>
          <Field label="Deal breakers">
            <Textarea
              value={form.dealBreakers}
              onChange={(e) => setForm({ ...form, dealBreakers: e.target.value })}
              placeholder="No candidates requiring visa sponsorship in the first year."
            />
          </Field>
          <Field label="Internal notes">
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Decisions are fast — expect feedback within 48 hours of each round."
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}

/**
 * The job descriptions belonging to one client, open work first.
 *
 * Closed and filled roles are collapsed rather than dropped: an account manager
 * still needs the history, but it must not compete for attention with the roles
 * actually being worked on.
 */
function ClientJobsModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const detail = useClient(id ?? "");
  const [showClosed, setShowClosed] = useState(false);
  const open = Boolean(id);
  const data = detail.data;
  const openJobs = data?.openJobs ?? [];
  const closedJobs = data?.closedJobs ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title={data?.client.companyName ?? "Client"}
      description="Job descriptions attached to this client."
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {detail.isLoading && <LoadingBlock rows={3} />}
      {detail.error && <ErrorNote message={detail.error.message} />}

      {data && (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Open roles — {openJobs.length}
            </p>
            {openJobs.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">
                Nothing open for this client right now.
              </p>
            ) : (
              <div className="space-y-1.5">
                {openJobs.map((job) => (
                  <Link
                    key={job.id}
                    to={`/jobs/${job.id}`}
                    onClick={onClose}
                    className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2 text-[12px] transition-colors hover:border-border-hover"
                  >
                    <Briefcase className="size-3.5 shrink-0 text-info" />
                    <span className="truncate">{job.title}</span>
                    <Badge className="ml-auto shrink-0">{job.status.replace(/_/g, " ")}</Badge>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {closedJobs.length > 0 && (
            <div className="border-t border-border pt-3">
              <button
                type="button"
                onClick={() => setShowClosed((v) => !v)}
                className="flex w-full items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronDown
                  className={`size-3.5 transition-transform ${showClosed ? "" : "-rotate-90"}`}
                />
                Closed and filled — {closedJobs.length}
              </button>
              {showClosed && (
                <div className="mt-2 space-y-1.5">
                  {closedJobs.map((job) => (
                    <Link
                      key={job.id}
                      to={`/jobs/${job.id}`}
                      onClick={onClose}
                      className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2 text-[12px] text-muted-foreground transition-colors hover:border-border-hover"
                    >
                      <Briefcase className="size-3.5 shrink-0" />
                      <span className="truncate">{job.title}</span>
                      <Badge className="ml-auto shrink-0">{job.status.replace(/_/g, " ")}</Badge>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
