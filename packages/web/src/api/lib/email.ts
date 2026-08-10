/**
 * Transactional email. Sent through Resend's HTTP API — no SDK, so the server
 * stays dependency-free — and always fails soft: an interview invite must still
 * be created and its link shown even when the mailbox is not configured yet.
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface SendEmailResult {
  sent: boolean;
  /** Human-readable reason when `sent` is false — surfaced in the UI. */
  reason?: string;
}

/** From address used for every outbound mail. Overridable per deployment. */
function fromAddress(): string {
  return process.env.EMAIL_FROM ?? "Skillton <onboarding@resend.dev>";
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return {
      sent: false,
      reason: "Email is not configured yet — add RESEND_API_KEY in settings to send invitations automatically.",
    };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from: fromAddress(),
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });
    if (!res.ok) return { sent: false, reason: (await res.text()).slice(0, 200) };
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: (error as Error).message };
  }
}

/* ------------------------------------------------------------- templates */

const SHELL = (title: string, body: string) => `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f5;font-family:Helvetica,Arial,sans-serif;color:#18181b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e4e4e7">
        <tr><td style="background:#0d0d0d;padding:20px 26px">
          <span style="color:#ffffff;font-size:17px;font-weight:700;letter-spacing:.02em">Skillton</span>
          <span style="color:#ff6b2b;font-size:17px;font-weight:700"> Intelligence</span>
        </td></tr>
        <tr><td style="padding:28px 26px 8px">
          <h1 style="margin:0 0 14px;font-size:19px;line-height:1.35">${title}</h1>
          ${body}
        </td></tr>
        <tr><td style="padding:18px 26px 26px;border-top:1px solid #f0f0f1">
          <p style="margin:0;font-size:11.5px;line-height:1.6;color:#71717a">
            This message was sent by the Skillton recruitment platform on behalf of the hiring team.
            If you believe you received it in error, please ignore it.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

export interface InterviewInviteEmailInput {
  candidateName: string;
  jobTitle?: string | null;
  link: string;
  minMinutes: number;
  maxMinutes: number;
  expiresAt: Date;
  agencyName?: string | null;
  rescheduled?: boolean;
  /** Slot the recruiter booked. Null means the candidate may sit it any time. */
  scheduledAt?: Date | null;
}

/** The candidate-facing AI interview invitation. */
export function interviewInviteEmail(input: InterviewInviteEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const role = input.jobTitle ? ` for the ${input.jobTitle} role` : "";
  const expiry = input.expiresAt.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const slot = input.scheduledAt
    ? input.scheduledAt.toLocaleString(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  const subject = input.rescheduled
    ? `Your rescheduled interview${role ? `:${role}` : ""} — new link inside`
    : `Your interview invitation${role ? `:${role}` : ""}`;

  const bullets = [
    ...(slot ? [`Your interview is scheduled for <strong>${slot}</strong>.`] : []),
    `Takes about ${input.minMinutes}–${input.maxMinutes} minutes.`,
    "Conducted by our AI screening interviewer — you answer out loud, like a normal call.",
    "You will need a working <strong>camera and microphone</strong>, and a quiet room.",
    "Use a laptop or desktop with Chrome or Edge for the best experience.",
    "Stay on the interview page for the whole session — leaving it ends the interview.",
    `Please complete it by <strong>${expiry}</strong>, after which the link expires.`,
  ];

  const html = SHELL(
    `Hello ${input.candidateName},`,
    `
    <p style="margin:0 0 14px;font-size:14px;line-height:1.65">
      Thank you for your interest${role}. ${
        input.rescheduled
          ? `Your interview has been rescheduled${slot ? ` to <strong>${slot}</strong>` : ""}, and this is your new interview link — any earlier link is no longer valid.`
          : slot
            ? `We would like to invite you to your first-round interview, scheduled for <strong>${slot}</strong>.`
            : "We would like to invite you to your first-round interview, which you can take at any time that suits you."
      }
    </p>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.65">Here is what to expect:</p>
    <ul style="margin:0 0 22px;padding-left:20px;font-size:13.5px;line-height:1.75;color:#3f3f46">
      ${bullets.map((b) => `<li>${b}</li>`).join("")}
    </ul>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px">
      <tr><td style="background:#ff6b2b;border-radius:10px">
        <a href="${input.link}" style="display:inline-block;padding:13px 24px;font-size:14.5px;font-weight:700;color:#ffffff;text-decoration:none">Start my interview</a>
      </td></tr>
    </table>
    <p style="margin:0 0 18px;font-size:12.5px;line-height:1.6;color:#71717a">
      If the button does not work, copy this link into your browser:<br />
      <a href="${input.link}" style="color:#c2410c;word-break:break-all">${input.link}</a>
    </p>
    <p style="margin:0 0 6px;font-size:14px;line-height:1.65">
      We wish you the very best of luck.
    </p>
    <p style="margin:0;font-size:14px;line-height:1.65">
      Kind regards,<br /><strong>${input.agencyName ?? "The recruitment team"}</strong>
    </p>`,
  );

  const text = [
    `Hello ${input.candidateName},`,
    "",
    `Thank you for your interest${role}. ${
      input.rescheduled
        ? `Your interview has been rescheduled${slot ? ` to ${slot}` : ""}. This is your new interview link; any earlier link is no longer valid.`
        : slot
          ? `We would like to invite you to your first-round interview, scheduled for ${slot}.`
          : "We would like to invite you to your first-round interview, which you can take at any time that suits you."
    }`,
    "",
    "What to expect:",
    ...bullets.map((b) => `- ${b.replace(/<[^>]+>/g, "")}`),
    "",
    `Start your interview: ${input.link}`,
    "",
    "We wish you the very best of luck.",
    "",
    "Kind regards,",
    input.agencyName ?? "The recruitment team",
  ].join("\n");

  return { subject, html, text };
}
