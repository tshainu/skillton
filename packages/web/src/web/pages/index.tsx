import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowRight,
  BarChart3,
  Cpu,
  FileStack,
  Mic,
  ShieldCheck,
  Sparkles,
  Trophy,
} from "lucide-react";
import { authClient } from "../lib/auth";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Field, Input } from "../components/ui/field";
import { ErrorNote, Spinner } from "../components/ui/feedback";
import { Badge } from "../components/ui/badge";
import { SpiderWeb } from "../components/ui/spider-web";

const FEATURES = [
  {
    icon: Cpu,
    title: "CV ↔ JD matching engine",
    body: "Semantic embeddings plus skill, experience, education and location scoring produce a ranked shortlist with the reasoning attached.",
  },
  {
    icon: FileStack,
    title: "Bulk CV ingest & AI parsing",
    body: "Drop hundreds of PDFs and DOCX files at once. Skills, experience, education, certifications and contact details are extracted into a searchable talent pool.",
  },
  {
    icon: Mic,
    title: "AI voice interview",
    body: "A real-time voice screener produces a qualitative report: strengths, gaps and the exact topics your technical panel should probe.",
  },
  {
    icon: BarChart3,
    title: "Weighted final score",
    body: "Technical evaluation carries 80% and match 20%. The AI interview stays qualitative — it never inflates a number.",
  },
  {
    icon: Trophy,
    title: "Placement register",
    body: "Every hire becomes a permanent record: client, role, salary, recruiter credit and time-to-hire that survives data retention cleanup.",
  },
  {
    icon: ShieldCheck,
    title: "Backup, retention & audit",
    body: "Encrypted snapshots, tiered retention, PII anonymization and a full audit trail across every recruiter action.",
  },
];

export default function IndexPage() {
  const { data: session, isPending } = authClient.useSession();
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"email" | null>(null);

  useEffect(() => {
    if (session) navigate("/dashboard");
  }, [session, navigate]);

  async function withEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("email");
    const result =
      mode === "signin"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: name || email.split("@")[0]! });
    if (result.error) setError(result.error.message ?? "Something went wrong");
    setBusy(null);
  }

  if (isPending || session) {
    return (
      <div className="app-bg grid min-h-screen place-items-center">
        <Spinner className="size-6 text-primary" />
      </div>
    );
  }

  return (
    <div className="app-bg relative min-h-screen overflow-hidden">
      <SpiderWeb className="opacity-90" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,107,43,0.10),transparent_60%)]" />
      <header className="relative z-10 mx-auto flex max-w-[1280px] items-center justify-between px-5 py-5 sm:px-8">
        <img
          src="/images/skillton-logo.png"
          alt="Skillton — recruit smarter with ai"
          className="h-10 w-auto sm:h-12"
        />
        <Badge tone="primary" className="hidden sm:inline-flex">
          <Sparkles className="size-3" /> AI Recruitment Intelligence
        </Badge>
      </header>

      <main className="relative z-10 mx-auto max-w-[1280px] px-5 pb-24 sm:px-8">
        <div className="grid items-start gap-12 py-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16 lg:py-16">
          {/* Pitch */}
          <div>
            <p className="rise rise-1 mb-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
              For recruitment engine
            </p>
            <h1 className="rise rise-2 font-display text-[38px] font-extrabold leading-[1.05] sm:text-[54px]">
              Stop reading CVs.
              <br />
              <span className="text-primary">Start reading signal.</span>
            </h1>
            <div className="rise rise-3 mt-5 max-w-xl space-y-3.5 text-[15px] leading-relaxed text-muted-foreground">
              <p>
                <span className="font-semibold text-foreground">Skillton AI Recruitment Intelligence</span> is
                the layer that reads what you cannot. Every CV is parsed and scored against the actual JD, and
                every score arrives with its reasoning, its gaps and the exact questions your panel should ask —
                so a junior recruiter submits with the judgement of your best one, and every decision is
                defensible to the client.
              </p>
              <p>
                From there it carries the candidate through HR screening, an AI voice interview and a weighted
                technical evaluation into placement — turning your database from a filing cabinet into a
                compounding asset that surfaces the hidden gems you already paid to source.
              </p>
            </div>

            <div className="rise rise-4 mt-8 flex flex-wrap gap-3">
              <Button
                size="lg"
                className="glow-primary"
                onClick={() => document.getElementById("email-auth")?.focus()}
              >
                Sign in to your workspace
                <ArrowRight className="size-4" />
              </Button>
            </div>

            <div className="rise rise-5 mt-12 grid gap-3 sm:grid-cols-2">
              {FEATURES.map((f) => (
                <Card key={f.title} hover className="p-4">
                  <f.icon className="mb-3 size-4.5 text-primary" />
                  <p className="font-display text-[14px] font-semibold">{f.title}</p>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{f.body}</p>
                </Card>
              ))}
            </div>
          </div>

          {/* Auth card */}
          <Card className="rise rise-3 sticky top-8 p-6">
            <h2 className="font-display text-[19px] font-bold">
              {mode === "signin" ? "Sign in to your workspace" : "Create your agency workspace"}
            </h2>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              {mode === "signin"
                ? "Recruiters, technical interviewers and admins share one pipeline."
                : "The first account provisions the agency and becomes its super admin."}
            </p>

            <form onSubmit={withEmail} className="mt-6 space-y-3.5">
              {mode === "signup" && (
                <Field label="Full name">
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya Raman" />
                </Field>
              )}
              <Field label="Work email">
                <Input
                  id="email-auth"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@agency.com"
                />
              </Field>
              <Field label="Password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
                <Input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </Field>

              {error && <ErrorNote message={error} />}

              <Button type="submit" className="w-full" size="lg" disabled={busy !== null}>
                {busy === "email" ? <Spinner /> : null}
                {mode === "signin" ? "Sign in" : "Create workspace"}
              </Button>
            </form>

            <button
              type="button"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError(null);
              }}
              className="mt-4 w-full text-center text-[12.5px] text-muted-foreground transition-colors hover:text-primary-light"
            >
              {mode === "signin" ? "No workspace yet? Create one" : "Already have an account? Sign in"}
            </button>
          </Card>
        </div>
      </main>
    </div>
  );
}
