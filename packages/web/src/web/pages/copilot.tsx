import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowUp, Loader2, Sparkles, Wrench } from "lucide-react";
import { Card } from "../components/ui/card";
import { PageHeader } from "../components/ui/page";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { ErrorNote } from "../components/ui/feedback";
import { RichText } from "../components/ui/rich-text";
import { authHeaders } from "../lib/api";

const SUGGESTIONS = [
  "Who are my three strongest candidates for the Senior Backend Engineer role, and why?",
  "Which match scores have expired and need re-running?",
  "Compare the top two candidates in the technical queue.",
  "What skills is my talent pool missing for our open SRE role?",
  "Summarise pipeline health and where I'm losing candidates.",
  "How many placements this month, and what was the average time to hire?",
];

const TOOL_LABELS: Record<string, string> = {
  searchCandidates: "Searching candidates",
  listJobs: "Listing job descriptions",
  topMatchesForJob: "Reading the ranked shortlist",
  candidateProfile: "Opening candidate profile",
  pipelineStats: "Checking pipeline stats",
  placementHistory: "Reading placement history",
  skillGapAnalysis: "Analysing skill gaps",
};

export default function CopilotPage() {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/agent/messages",
      headers: () => authHeaders(),
    }),
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const busy = status === "streaming" || status === "submitted";

  function send(text: string) {
    const value = text.trim();
    if (!value || busy) return;
    setInput("");
    void sendMessage({ text: value });
  }

  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="AI Recruiter Copilot"
        subtitle="Ask about your candidates, roles, pipeline and placements in plain language. The copilot queries your live workspace — it never invents data, and it respects score expiry."
        actions={
          <Badge tone="primary">
            <Sparkles className="size-3" /> Reads your workspace
          </Badge>
        }
      />

      <div className="rise rise-2 grid gap-4 lg:grid-cols-[1fr_300px]">
        <Card className="flex min-h-[62vh] flex-col overflow-hidden p-0">
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-5">
            {messages.length === 0 && (
              <div className="grid h-full place-items-center py-10 text-center">
                <div>
                  <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl border border-primary/30 bg-primary/10">
                    <Sparkles className="size-5 text-primary" />
                  </span>
                  <p className="font-display text-[17px] font-semibold">Ask me anything about your pipeline</p>
                  <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-muted-foreground">
                    I can rank candidates for a role, explain why someone scored the way they did, surface expired
                    scores, compare shortlists and report on placements.
                  </p>
                </div>
              </div>
            )}

            {messages.map((message) => (
              <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    message.role === "user"
                      ? "max-w-[85%] rounded-2xl rounded-tr-sm border border-primary/30 bg-primary/12 px-4 py-2.5"
                      : "max-w-[92%] rounded-2xl rounded-tl-sm border border-border bg-white/[0.035] px-4 py-3"
                  }
                >
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {message.role === "user" ? "You" : "Copilot"}
                  </p>
                  <div className="space-y-2">
                    {message.parts.map((part, i) => {
                      if (part.type === "text") {
                        /* Copilot answers in markdown — render it properly.
                           The user's own message stays plain. */
                        return message.role === "assistant" ? (
                          <RichText key={i} text={part.text} />
                        ) : (
                          <p key={i} className="whitespace-pre-wrap text-[13.5px] leading-relaxed">
                            {part.text}
                          </p>
                        );
                      }
                      if (part.type.startsWith("tool-")) {
                        const name = part.type.replace("tool-", "");
                        return (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white/[0.03] px-2 py-1 text-[11.5px] text-muted-foreground"
                          >
                            <Wrench className="size-3 text-primary" />
                            {TOOL_LABELS[name] ?? name}
                          </span>
                        );
                      }
                      return null;
                    })}
                  </div>
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin text-primary" />
                Working through your workspace…
              </div>
            )}

            {error && <ErrorNote message={error.message} />}
          </div>

          <div className="border-t border-border p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                rows={2}
                placeholder="Ask about candidates, roles, expired scores, placements…"
                className="max-h-32 min-h-[44px] flex-1 resize-y rounded-lg border border-border bg-[#141414] px-3 py-2.5 text-[13.5px] outline-none transition-colors placeholder:text-[#6b6b6b] focus:border-primary/60"
              />
              <Button onClick={() => send(input)} disabled={busy || !input.trim()} size="icon-lg">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
              </Button>
            </div>
            <p className="mt-1.5 px-1 text-[11px] text-muted-foreground/70">
              Enter to send · Shift + Enter for a new line
            </p>
          </div>
        </Card>

        <div className="space-y-3">
          <Card className="p-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Try asking
            </p>
            <div className="space-y-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  disabled={busy}
                  className="w-full rounded-lg border border-border bg-white/[0.02] px-3 py-2 text-left text-[12.5px] leading-snug text-foreground/85 transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Ground rules
            </p>
            <ul className="space-y-2 text-[12px] leading-relaxed text-muted-foreground">
              <li className="flex gap-2">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
                Expired match scores are reported as expired, never as numbers.
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
                The AI voice interview is qualitative — it is never used in a ranking.
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
                Final score = match × 0.20 + technical × 0.80.
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
                Scoped to your agency only — no other workspace is visible.
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
