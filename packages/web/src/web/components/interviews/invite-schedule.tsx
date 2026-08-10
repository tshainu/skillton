import { CalendarClock, Clock, Link2 } from "lucide-react";
import { Input, Switch } from "../ui/field";

/** `datetime-local` value for a date, in the browser's own timezone. */
export function toLocalInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

/** Tomorrow at 10:00 — the slot recruiters book most often. */
export function defaultSlot() {
  const date = new Date(Date.now() + 86_400_000);
  date.setHours(10, 0, 0, 0);
  return toLocalInput(date);
}

/** An hour from now: soon enough to be useful, late enough to change your mind. */
export function defaultSend() {
  return toLocalInput(new Date(Date.now() + 3_600_000));
}

/**
 * The link has to outlive the slot it was booked for, so the expiry the server
 * will apply is the later of "now + valid days" and "the day after the slot".
 * Shown here so the recruiter knows exactly what the candidate gets.
 */
export function expiryPreview(slot: string, validDays: number) {
  const slotMs = slot ? new Date(slot).getTime() : 0;
  const days = Number.isFinite(validDays) && validDays > 0 ? validDays : 7;
  return new Date(Math.max(Date.now() + days * 86_400_000, (slotMs || 0) + 86_400_000));
}

interface Props {
  slotAt: string;
  onSlotAt: (value: string) => void;
  sendWhen: "now" | "later";
  onSendWhen: (value: "now" | "later") => void;
  sendAt: string;
  onSendAt: (value: string) => void;
  validDays: number;
  sendMail: boolean;
  onSendMail: (value: boolean) => void;
  /** Wording differs slightly for a re-schedule. */
  rescheduling?: boolean;
}

/**
 * Interview slot + when the invitation is emailed + what the candidate's link is
 * actually good for. All three were previously invisible: the recruiter booked a
 * time in their head, the mail went out immediately, and nobody could say when
 * the link died.
 */
export function InviteSchedule({
  slotAt,
  onSlotAt,
  sendWhen,
  onSendWhen,
  sendAt,
  onSendAt,
  validDays,
  sendMail,
  onSendMail,
  rescheduling,
}: Props) {
  const expiry = expiryPreview(slotAt, validDays);
  const sendLater = sendWhen === "later";

  return (
    <div className="mb-4 space-y-3.5 rounded-xl border border-border bg-white/[0.02] p-3.5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="min-w-0">
          <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <CalendarClock className="size-3.5 text-primary" />
            {rescheduling ? "New interview date & time" : "Interview date & time"}
          </span>
          <Input type="datetime-local" value={slotAt} onChange={(e) => onSlotAt(e.target.value)} />
          <span className="mt-1 block text-[11px] text-muted-foreground">
            Printed in the invitation email. The candidate can join at that time from the same link.
          </span>
        </label>

        <label className="min-w-0">
          <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Clock className="size-3.5 text-primary" />
            Send the email
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onSendWhen("now")}
              className={`h-9 flex-1 rounded-md border px-3 text-[12.5px] transition-colors ${
                sendLater ? "border-border text-muted-foreground hover:border-border-hover" : "border-primary bg-primary/10 text-foreground"
              }`}
            >
              Now
            </button>
            <button
              type="button"
              onClick={() => onSendWhen("later")}
              className={`h-9 flex-1 rounded-md border px-3 text-[12.5px] transition-colors ${
                sendLater ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:border-border-hover"
              }`}
            >
              Later
            </button>
          </div>
          {sendLater && (
            <Input
              type="datetime-local"
              className="mt-2"
              value={sendAt}
              onChange={(e) => onSendAt(e.target.value)}
            />
          )}
          <span className="mt-1 block text-[11px] text-muted-foreground">
            {sendLater
              ? "The invitation is held and released automatically at this time."
              : "The invitation goes out as soon as you confirm."}
          </span>
        </label>
      </div>

      <p className="flex items-start gap-2 rounded-lg border border-border bg-black/20 px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
        <Link2 className="mt-0.5 size-3.5 shrink-0 text-primary" />
        <span>
          The interview link stays valid for <strong className="text-foreground">{validDays} days</strong> — until{" "}
          <strong className="text-foreground">
            {expiry.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          </strong>
          . It never expires before the day after the booked slot, and it stops working the moment the interview is
          submitted.
        </span>
      </p>

      <Switch
        checked={sendMail}
        onChange={onSendMail}
        label={
          rescheduling
            ? "Email the new link to the candidate (the link is shown here either way)"
            : "Email the invitation to the candidate (the link is shown here either way)"
        }
      />
    </div>
  );
}
