import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  Keyboard,
  Mic,
  MicOff,
  PhoneOff,
  Radio,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Video,
  VideoOff,
} from "lucide-react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { ErrorNote, Spinner } from "../components/ui/feedback";
import { Input, Switch } from "../components/ui/field";
import { VoiceOrb, type OrbState } from "../components/ui/voice-orb";
import {
  useAppendTranscript,
  useFinishInterview,
  useInterviewByToken,
  useInterviewConsent,
  useInterviewDeviceFailure,
  useInterviewHeartbeat,
  useProctorEvent,
  useReportInterviewError,
  useResumeInterview,
  useStartInterview,
} from "../queries/interviews";

type Phase = "consent" | "setup" | "connecting" | "live" | "finishing" | "done" | "declined";
interface Turn {
  role: "ai" | "candidate";
  text: string;
  at: number;
}

const FALLBACK_QUESTIONS = [
  "Hi, thanks for making the time. To start — tell me about the work you're proudest of in the last year.",
  "What was the hardest trade-off you had to make on that work, and how did you decide?",
  "How did you measure whether it actually worked?",
  "Tell me about a time something you shipped broke. What did you do?",
  "What are you looking for in your next role, and why now?",
  "What's your notice period and earliest realistic start date?",
  "Last one — what should we know about you that isn't on your CV?",
];

/** Seconds the interviewer gets to deliver its closing once time is up. */
const CLOSING_GRACE_MS = 25_000;
/**
 * Once the interviewer has signalled that the interview is complete, the room
 * waits only long enough for the closing words to finish playing before it
 * submits — never for the rest of the interview window.
 */
const COMPLETION_GRACE_MS = 20_000;
/**
 * Deliberate hold between the interviewer's last spoken word and the call being
 * torn down. Ending on the same tick cuts the goodbye off in the candidate's ear
 * and gives them no moment to say thank you, which reads as the system hanging
 * up on them.
 */
const END_HOLD_MS = 5_000;
/**
 * Silence after the last question in the set has been asked and answered before
 * the room closes the interview itself. The interviewer is supposed to call
 * `end_interview`; when it forgets, the candidate must not be left holding an
 * open call, so coverage of the set is tracked here and the closing is forced.
 */
const COVERAGE_SETTLE_MS = 7_000;
/**
 * Share of a question's significant words that must appear in what the
 * interviewer said for that question to count as asked. Deliberately loose — the
 * model rephrases, and a missed match only delays the automatic close.
 */
const COVERAGE_MATCH_RATIO = 0.6;
/**
 * Consecutive proctoring frames showing direct eye contact before the sitting is
 * credited as a confident presence. One frame is a coincidence of timing.
 */
const EYE_CONTACT_FRAMES = 3;
/** How often the room tells the server it is still alive (drives resume pricing). */
const HEARTBEAT_MS = 20_000;
/**
 * A burst of sound shorter than this is treated as noise (a cough, a bang, a
 * filler) rather than the candidate taking the floor, so it never cuts the
 * interviewer off mid-question.
 */
const BARGE_IN_MS = 700;
/**
 * The interview is only valid evidence while the recruiter can actually see the
 * candidate, so a dead, disabled or physically covered camera is treated exactly
 * like leaving the screen: the candidate is told at once and gets this long to
 * restore the picture before the sitting is terminated.
 */
const CAMERA_GRACE_MS = 30_000;
/** Mean luminance (0-255) below which the camera counts as covered or blacked out. */
const DARK_FRAME_LUMA = 9;
/** Continuous time off the interview screen that terminates the interview. */
const INACTIVITY_LIMIT_MS = 60_000;
/** Total candidate silence after which an abandoned session is closed out. */
const ABANDONED_LIMIT_MS = 4 * 60_000;
/** Grace the candidate gets to fix a missing camera or microphone. */
const DEVICE_SETUP_SECONDS = 60;
/**
 * Shown to the candidate for any interview-room failure. The real provider error
 * (expired key, no credits, network) is never useful to them and must not leak,
 * so it is sent to the super admin instead.
 */
const VOICE_FAILURE_NOTICE =
  "We are currently experiencing an issue with the voice interviewer. Please contact Skillton Intelligence, or your recruitment contact, so they can arrange your interview. Nothing you have done has caused this.";

/** Words too common to prove that a particular question was the one asked. */
const COVERAGE_STOP_WORDS = new Set([
  "about", "after", "also", "and", "any", "are", "been", "before", "but", "can", "could", "did", "does", "doing",
  "done", "for", "from", "get", "give", "had", "has", "have", "how", "into", "its", "just", "like", "make", "many",
  "may", "me", "more", "most", "much", "must", "not", "now", "one", "our", "out", "over", "own", "part", "put",
  "said", "same", "say", "see", "should", "since", "some", "such", "take", "tell", "than", "that", "the", "their",
  "them", "then", "there", "these", "they", "this", "those", "through", "time", "under", "use", "very", "want",
  "was", "way", "were", "what", "when", "where", "which", "while", "who", "why", "will", "with", "would", "you",
  "your", "yours",
]);

function coverageWords(text: string) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !COVERAGE_STOP_WORDS.has(word)),
  );
}

/**
 * Whether `spoken` looks like the interviewer asking `question`. The model
 * rephrases freely, so this compares significant words rather than strings — a
 * missed match only means the room waits for the model's own close instead.
 */
function looksLikeQuestion(question: string, spoken: string) {
  const wanted = coverageWords(question);
  if (wanted.size === 0) return false;
  const said = coverageWords(spoken);
  let hits = 0;
  for (const word of wanted) if (said.has(word)) hits += 1;
  return hits / wanted.size >= COVERAGE_MATCH_RATIO;
}

export default function AiInterviewRoomPage() {
  const { token = "" } = useParams<{ token: string }>();
  const interview = useInterviewByToken(token);
  const consentMutation = useInterviewConsent();
  const start = useStartInterview();
  const append = useAppendTranscript();
  const finish = useFinishInterview();
  const proctor = useProctorEvent();
  const deviceFailure = useInterviewDeviceFailure();
  const reportError = useReportInterviewError();
  const heartbeat = useInterviewHeartbeat();
  const resumeInterview = useResumeInterview();
  /* The heartbeat timer must not restart every time the mutation's own state
     changes, so it reaches `mutate` through a ref instead of a dependency. */
  const heartbeatRef = useRef(heartbeat.mutate);
  heartbeatRef.current = heartbeat.mutate;

  const [phase, setPhase] = useState<Phase>("consent");
  const [consent, setConsent] = useState(false);
  const [identity, setIdentity] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceMode, setVoiceMode] = useState(true);
  const [voiceFailed, setVoiceFailed] = useState(false);
  const [muted, setMuted] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [fallbackIndex, setFallbackIndex] = useState(0);
  const [completedSummary, setCompletedSummary] = useState<string | null>(null);
  const [aiStream, setAiStream] = useState<MediaStream | null>(null);
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [limits, setLimits] = useState({
    minMinutes: 10,
    maxMinutes: 15,
    silenceNudgeSeconds: 10,
    proctoringEnabled: true,
    awayPenaltyMultiplier: 2,
    questionCount: 0,
    questions: [] as string[],
  });
  const [cameraReady, setCameraReady] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [penaltySeconds, setPenaltySeconds] = useState(0);
  const [terminationNotice, setTerminationNotice] = useState<string | null>(null);
  const [focusLosses, setFocusLosses] = useState(0);
  /* Device gate: both camera and microphone must work before the call starts. */
  const [devices, setDevices] = useState({ camera: false, microphone: false });
  const [setupLeft, setSetupLeft] = useState(DEVICE_SETUP_SECONDS);
  const [deviceDetail, setDeviceDetail] = useState<string | null>(null);
  /* The AI's words are revealed at speaking pace, not dumped in full up front. */
  const [aiShown, setAiShown] = useState("");
  /* Hello-screen device check: run on arrival, re-runnable, with a live preview. */
  const [checkingDevices, setCheckingDevices] = useState(true);
  const [deviceAttempt, setDeviceAttempt] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);

  const pc = useRef<RTCPeerConnection | null>(null);
  const dc = useRef<RTCDataChannel | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const startedAt = useRef<number>(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingAi = useRef<string>("");
  const pendingUser = useRef<string>("");
  /* Live-caption machinery: how much of the buffered AI turn has been shown, and
     whether the model has finished generating / finished speaking it. */
  const aiRevealed = useRef<number>(0);
  const aiComplete = useRef<boolean>(false);
  const aiSpeaking = useRef<boolean>(false);
  /** Media acquired by the pre-flight device check and reused for the call. */
  const preflight = useRef<MediaStream | null>(null);
  /** Self-view on the hello screen, before the room opens. */
  const previewVideo = useRef<HTMLVideoElement | null>(null);
  /** Last moment the candidate was heard — drives the silence nudge. */
  const lastSpeechAt = useRef<number>(0);
  const nudgeCount = useRef<number>(0);
  const wrapUpSent = useRef<boolean>(false);
  /** Pacing checkpoints already delivered to the interviewer (0.5 / 0.8 of max). */
  const pacingSent = useRef<Set<number>>(new Set());
  /** Wall-clock moment the hard stop was armed, so closing words get a grace window. */
  const closingStartedAt = useRef<number>(0);
  /** Set when the interviewer calls `end_interview` after its closing words. */
  const completionRequested = useRef<number>(0);
  /** True once an implausibly early close has already been pushed back. */
  const completionRejected = useRef<boolean>(false);
  /** Moment the closing words finished playing, which starts the 5-second hold. */
  const completionSpokenAt = useRef<number>(0);
  /** The recruiter's question set, and which of its questions have been asked. */
  const questionsRef = useRef<string[]>([]);
  const askedRef = useRef<Set<number>>(new Set());
  /** Moment the set became fully covered, so the close can be forced after it settles. */
  const coveredAt = useRef<number>(0);
  /** True once the room has told the interviewer to close on its own initiative. */
  const forcedCloseSent = useRef<boolean>(false);
  /** Consecutive frames of direct eye contact, and the positives earned so far. */
  const eyeContactStreak = useRef<number>(0);
  const positivesRef = useRef<Set<string>>(new Set());
  /** Whether the candidate is mid-utterance, and when that utterance began. */
  const userSpeaking = useRef<boolean>(false);
  const userSpeechStartedAt = useRef<number>(0);
  /** Guards against double-finishing when a timer and the user both end the call. */
  const endingRef = useRef<boolean>(false);
  const endRef = useRef<(options?: { terminated?: boolean; reason?: string; flag?: string }) => Promise<void>>(
    async () => undefined,
  );
  /* Camera + recording + proctoring. */
  /** Moment the camera picture was lost, so the grace window can be timed. */
  const videoLostAt = useRef<number>(0);
  const camVideo = useRef<HTMLVideoElement | null>(null);
  const camStream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const awayStartedAt = useRef<number>(0);
  const awaySecondsRef = useRef<number>(0);
  const penaltyRef = useRef<number>(0);
  const focusLossRef = useRef<number>(0);
  const flagsRef = useRef<Set<string>>(new Set());
  const warningTimer = useRef<number | null>(null);
  const lastFlagWarnAt = useRef<number>(0);

  useEffect(() => {
    if (phase !== "live") return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, aiShown]);

  /**
   * Live captions for the interviewer. The Realtime API finishes streaming the
   * transcript long before the audio has finished playing, so writing it straight
   * to the screen shows the candidate the whole question before it is spoken.
   * Instead the buffered text is released at roughly speaking pace, catches up
   * once the audio stops, and only then becomes a committed transcript turn.
   */
  useEffect(() => {
    if (phase !== "live") return;
    /* ~13 characters a second is close to natural speech; the flush rate takes
       over once the model has stopped talking so captions never lag behind. */
    const TICK_MS = 80;
    const SPEAKING_RATE = 1.15;
    const FLUSH_RATE = 12;
    let carry = 0;

    const timer = window.setInterval(() => {
      const buffer = pendingAi.current;
      if (!buffer) return;
      const flushing = aiComplete.current && !aiSpeaking.current;
      carry += flushing ? FLUSH_RATE : SPEAKING_RATE;
      const step = Math.floor(carry);
      if (step > 0) {
        carry -= step;
        aiRevealed.current = Math.min(buffer.length, aiRevealed.current + step);
        setAiShown(buffer.slice(0, aiRevealed.current));
      }
      /* Fully spoken and fully shown — promote it to a transcript turn. */
      if (aiComplete.current && !aiSpeaking.current && aiRevealed.current >= buffer.length) {
        const text = buffer.trim();
        pendingAi.current = "";
        aiRevealed.current = 0;
        aiComplete.current = false;
        setAiShown("");
        if (text) record("ai", text);
      }
    }, TICK_MS);
    return () => window.clearInterval(timer);
    /* `record` is stable for the life of the interview. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /**
   * Device check on the hello screen. The candidate sees their own picture and a
   * live microphone meter before they ever agree to start, so a dead webcam or a
   * muted headset is found here — not thirty seconds into a recorded interview.
   */
  useEffect(() => {
    if (phase !== "consent") return;
    let cancelled = false;
    let raf = 0;
    let ctx: AudioContext | null = null;

    async function probe() {
      setCheckingDevices(true);
      const result = await checkDevices();
      if (cancelled) return;
      setDevices({ camera: result.camera, microphone: result.microphone });
      setDeviceDetail(result.detail ?? null);
      setCheckingDevices(false);
      const media = preflight.current;
      if (!media) return;
      if (previewVideo.current) {
        previewVideo.current.srcObject = media;
        void previewVideo.current.play().catch(() => undefined);
      }
      if (media.getAudioTracks().length === 0) return;
      /* A "detected" microphone that picks up nothing is no microphone at all,
         so the candidate is shown the level they are actually sending. */
      ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(media).connect(analyser);
      const buffer = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(buffer);
        let peak = 0;
        for (const value of buffer) peak = Math.max(peak, Math.abs(value - 128));
        setMicLevel(Math.min(100, Math.round((peak / 90) * 100)));
        raf = window.requestAnimationFrame(tick);
      };
      tick();
    }

    void probe();
    return () => {
      cancelled = true;
      if (raf) window.cancelAnimationFrame(raf);
      /* Only the meter is torn down — the stream itself is handed to the call. */
      void ctx?.close().catch(() => undefined);
    };
    /* checkDevices is stable for the life of the component. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, deviceAttempt]);

  /**
   * Heartbeat. While the room is live the server is told so every 20 seconds; if
   * the page is reloaded or the browser dies, the gap since the last beat is
   * priced as time away rather than quietly forgiven.
   */
  useEffect(() => {
    if (phase !== "live") return;
    const beat = () => heartbeatRef.current({ token });
    beat();
    const timer = window.setInterval(beat, HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [phase, token]);

  /* Consent already recorded (a rejoin) — don't make them agree twice. */
  useEffect(() => {
    if (!interview.data?.consentGiven) return;
    setConsent(true);
    setIdentity(true);
  }, [interview.data?.consentGiven]);

  /** Countdown while the candidate fixes their camera or microphone. */
  useEffect(() => {
    if (phase !== "setup") return;
    const timer = window.setInterval(() => setSetupLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  /* The self-view element only exists once the interview is live. */
  useEffect(() => {
    if (phase !== "live" || !camVideo.current || !camStream.current) return;
    camVideo.current.srcObject = camStream.current;
    void camVideo.current.play().catch(() => undefined);
  }, [phase]);

  /**
   * Client-side guardrails that mirror the interviewer's own instructions: nudge
   * the candidate after the configured silence window, and force a wrap-up once
   * the maximum interview length is reached.
   */
  useEffect(() => {
    if (phase !== "live" || !voiceMode) return;
    const timer = setInterval(() => {
      const channel = dc.current;
      if (!channel || channel.readyState !== "open") return;

      /* Time spent off the interview screen counts against the clock. */
      const runningMs = Date.now() - startedAt.current + penaltyRef.current * 1000;

      /* The interviewer has declared the interview complete. Submit as soon as
         its closing words have finished playing (or after a short grace, if the
         audio never reports stopping) instead of idling until the time cap. */
      if (completionRequested.current) {
        /* A model that tries to close in the first minute has not run an
           interview. It is pushed back to the question set — once only, so a
           candidate who genuinely wants to stop is never trapped. */
        if (runningMs < 60_000 && !completionRejected.current) {
          completionRejected.current = true;
          completionRequested.current = 0;
          channel.send(
            JSON.stringify({
              type: "response.create",
              response: {
                instructions:
                  "You have not finished the interview — questions remain in your set. Do not close the call. Ask the next unasked question from your set now, exactly as written, with no preamble.",
              },
            }),
          );
          return;
        }
        const waited = Date.now() - completionRequested.current;
        const spoken = !aiSpeaking.current && !pendingAi.current;
        /* Once the goodbye has actually finished playing, hold the line open for
           five seconds — the candidate gets to hear the end of the sentence and
           reply — and only then submit. The grace window is the fallback for a
           browser that never reports the audio stopping. */
        if (spoken && !completionSpokenAt.current) completionSpokenAt.current = Date.now();
        const held = completionSpokenAt.current && Date.now() - completionSpokenAt.current >= END_HOLD_MS;
        if (held || waited > COMPLETION_GRACE_MS + END_HOLD_MS) {
          void endRef.current({});
          return;
        }
        return;
      }

      /* Every question in the set has been asked and the room has gone quiet.
         The interviewer should have closed the call itself; when it does not,
         the room takes over — it asks for the closing words and then hangs up on
         its own timer, so finishing the interview is never the candidate's job. */
      if (
        !wrapUpSent.current &&
        coveredAt.current > 0 &&
        !aiSpeaking.current &&
        !userSpeaking.current &&
        !pendingAi.current.trim() &&
        Date.now() - coveredAt.current > COVERAGE_SETTLE_MS &&
        Date.now() - (lastSpeechAt.current || coveredAt.current) > COVERAGE_SETTLE_MS
      ) {
        if (!forcedCloseSent.current) {
          /* First pass: ask for a proper goodbye and let it play out. */
          forcedCloseSent.current = true;
          closingStartedAt.current = Date.now();
          wrapUpSent.current = true;
          channel.send(
            JSON.stringify({
              type: "response.create",
              response: {
                instructions:
                  "Every question in your set has now been asked and answered. Close the interview now, in under 15 seconds: thank the candidate by name, tell them the recruitment team will review the interview and follow up with next steps shortly, and wish them well. Ask no further questions, start no new topic, and then call end_interview.",
              },
            }),
          );
        }
        return;
      }

      /* Hard time cap. The interviewer is told to deliver a proper closing, then
         the room shuts the call down itself — a model that keeps talking can no
         longer run the interview past the agency's limit. */
      if (!wrapUpSent.current && runningMs > limits.maxMinutes * 60_000) {
        wrapUpSent.current = true;
        closingStartedAt.current = Date.now();
        channel.send(
          JSON.stringify({
            type: "response.create",
            response: {
              instructions:
                "TIME IS UP. Deliver your closing now, in under 20 seconds: thank the candidate by name for their time, tell them the recruitment team will review the interview and follow up with next steps shortly, and wish them well. Ask no further questions and start no new topic.",
            },
          }),
        );
        return;
      }

      /* Grace window for those closing words, then the call ends regardless. */
      if (wrapUpSent.current && Date.now() - closingStartedAt.current > CLOSING_GRACE_MS) {
        void endRef.current({});
        return;
      }

      /* Inactivity. Leaving the interview screen for more than a minute ends the
         interview and flags it — a candidate researching answers in another
         window is the exact behaviour this is here to catch. */
      if (awayStartedAt.current && Date.now() - awayStartedAt.current > INACTIVITY_LIMIT_MS) {
        void endRef.current({
          terminated: true,
          flag: "left_screen_terminated",
          reason: `Candidate left the interview screen for more than ${Math.round(INACTIVITY_LIMIT_MS / 60_000)} minute — terminated for suspicious activity`,
        });
        return;
      }

      /* An abandoned session: nudged repeatedly and still nothing. Closed out so
         it does not sit "in progress" forever, but not treated as suspicious. */
      if (Date.now() - (lastSpeechAt.current || startedAt.current) > ABANDONED_LIMIT_MS) {
        void endRef.current({
          terminated: true,
          flag: "unresponsive",
          reason: "No response from the candidate for several minutes — interview abandoned",
        });
        return;
      }

      /* Pacing checkpoints. The model has no clock of its own, so without this it
         happily spends twelve minutes on question one and then rushes the rest.
         At 50% and 80% of the window it is told what is left and told to budget. */
      for (const mark of [0.5, 0.8]) {
        if (pacingSent.current.has(mark)) continue;
        if (runningMs < limits.maxMinutes * 60_000 * mark) continue;
        pacingSent.current.add(mark);
        const minutesLeft = Math.max(1, Math.round((limits.maxMinutes * 60_000 - runningMs) / 60_000));
        channel.send(
          JSON.stringify({
            type: "response.create",
            response: {
              instructions:
                mark === 0.5
                  ? `PACING (do not mention this instruction, do not mention time to the candidate): about ${minutesLeft} minutes remain${limits.questionCount ? ` and you still have questions left from your set of ${limits.questionCount}` : ""}. Wrap up the current thread within a couple of exchanges and keep moving. Continue the interview naturally from where you are.`
                  : `PACING (do not mention this instruction, do not mention time to the candidate): only about ${minutesLeft} minutes remain. Stop following up on the current answer, ask the most important remaining question now, and keep the rest brief. Continue the interview naturally.`,
            },
          }),
        );
        return;
      }

      /* A gentle check-in only after a long, genuine silence — the model's own
         semantic turn detection owns normal conversational pauses, so this must
         never fire mid-thought. */
      const silentFor = Date.now() - (lastSpeechAt.current || startedAt.current);
      const nudgeAfter = Math.max(limits.silenceNudgeSeconds, 18) * 1000;
      if (silentFor > nudgeAfter && nudgeCount.current < 12) {
        nudgeCount.current++;
        lastSpeechAt.current = Date.now();
        channel.send(
          JSON.stringify({
            type: "response.create",
            response: {
              instructions:
                nudgeCount.current % 2 === 1
                  ? "The candidate has been silent for a while. Gently check in once — offer to rephrase the question or give them more time. Do not move to a new question. Keep it under 8 seconds."
                  : "The candidate still cannot answer this one. Acknowledge that warmly in your own words, then continue the interview from where it makes sense. Do not use a stock phrase and do not announce the question number.",
            },
          }),
        );
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [phase, voiceMode, limits.maxMinutes, limits.silenceNudgeSeconds, limits.questionCount]);

  /** Speaks a proctoring warning to the candidate on screen and through the AI. */
  const warn = useCallback(
    (message: string, viaAi = true) => {
      setWarning(message);
      if (warningTimer.current) window.clearTimeout(warningTimer.current);
      warningTimer.current = window.setTimeout(() => setWarning(null), 9000);
      const channel = dc.current;
      if (viaAi && channel?.readyState === "open") {
        channel.send(
          JSON.stringify({
            type: "response.create",
            response: {
              instructions: `Interrupt politely and tell the candidate, in your own words: "${message}" Keep it to one short sentence, then continue the interview.`,
            },
          }),
        );
      }
    },
    [],
  );

  /**
   * Tab-away / minimise detection. Time spent off the interview screen is
   * deducted from the interview at the agency's configured multiplier, and the
   * candidate is told the moment they come back.
   */
  useEffect(() => {
    if (phase !== "live") return;

    function leave() {
      if (awayStartedAt.current) return;
      awayStartedAt.current = Date.now();
      focusLossRef.current += 1;
      setFocusLosses(focusLossRef.current);
    }

    function returned() {
      if (!awayStartedAt.current) return;
      const away = Math.max(1, Math.round((Date.now() - awayStartedAt.current) / 1000));
      awayStartedAt.current = 0;
      awaySecondsRef.current += away;
      const penalty = Math.round(away * limits.awayPenaltyMultiplier);
      penaltyRef.current += penalty;
      setPenaltySeconds(penaltyRef.current);
      flagsRef.current.add("left_screen");
      proctor.mutate({
        token,
        kind: "focus_lost",
        detail: `Away from the interview screen for ${away}s (-${penalty}s interview time)`,
        awaySeconds: away,
        flags: ["left_screen"],
      });
      warn(
        `You left the interview screen for ${away} seconds, so ${penalty} seconds were deducted from your interview time. Please stay on this page until the interview ends.`,
      );
    }

    function onVisibility() {
      if (document.hidden) leave();
      else returned();
    }

    window.addEventListener("blur", leave);
    window.addEventListener("focus", returned);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", returned);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [phase, limits.awayPenaltyMultiplier, proctor, token, warn]);

  /**
   * Camera integrity check: a still frame is inspected every 25 seconds for a
   * missing or extra face, a candidate reading off-screen, or headphones. Frames
   * are never stored — only the resulting flags.
   */
  useEffect(() => {
    if (phase !== "live" || !cameraReady || !limits.proctoringEnabled) return;
    let cancelled = false;

    async function sample() {
      const video = camVideo.current;
      if (!video || video.videoWidth === 0) return;
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = Math.round((video.videoHeight / video.videoWidth) * 480) || 360;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = canvas.toDataURL("image/jpeg", 0.6);

      try {
        const res = await fetch("/api/ai-interview/proctor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, frame }),
        });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as {
          flags?: string[];
          warnings?: string[];
          note?: string;
          positives?: string[];
        };
        const flags = body.flags ?? [];
        /* Positive evidence, tracked the same way as the negative kind: a single
           frame looking down the lens means nothing, but holding it across
           several samples is a genuinely composed, confident candidate and the
           recruiter should see that on the report. */
        const positives: string[] = [];
        if (body.positives?.includes("strong_eye_contact")) {
          eyeContactStreak.current += 1;
          if (eyeContactStreak.current >= EYE_CONTACT_FRAMES && !positivesRef.current.has("strong_eye_contact")) {
            positivesRef.current.add("strong_eye_contact");
            positives.push("strong_eye_contact");
          }
        } else {
          eyeContactStreak.current = 0;
        }
        if (flags.length === 0 && positives.length === 0) return;
        flags.forEach((f) => flagsRef.current.add(f));
        proctor.mutate({
          token,
          kind: positives.length > 0 && flags.length === 0 ? "positive_signal" : "camera_signal",
          detail: body.note?.slice(0, 200),
          awaySeconds: 0,
          flags,
          positives,
        });
        /* At most one spoken warning per minute so the interview stays usable. */
        if (Date.now() - lastFlagWarnAt.current > 60_000 && body.warnings?.length) {
          lastFlagWarnAt.current = Date.now();
          warn(body.warnings[0]!);
        }
      } catch {
        /* Proctoring is best-effort; never break the interview over it. */
      }
    }

    const timer = window.setInterval(() => void sample(), 25_000);
    const kickoff = window.setTimeout(() => void sample(), 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(kickoff);
    };
  }, [phase, cameraReady, limits.proctoringEnabled, proctor, token, warn]);

  /**
   * Camera watchdog. The device gate only proves the camera worked at the start —
   * nothing stops a candidate unplugging it, revoking the permission or taping
   * over the lens once the interview is running. This checks every two seconds
   * that a live track is still delivering a picture that is not blacked out, and
   * treats a lasting outage as grounds for termination.
   */
  useEffect(() => {
    if (phase !== "live") return;
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 24;

    /** Returns why the picture is unusable, or null when the camera is fine. */
    function outage(): string | null {
      const track = camStream.current?.getVideoTracks()[0];
      if (!track) return "no camera track";
      if (track.readyState !== "live") return "camera disconnected";
      if (!track.enabled || track.muted) return "camera turned off";
      const video = camVideo.current;
      if (!video || video.videoWidth === 0) return "no video signal";
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) {
          sum += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
        }
        const luma = sum / (data.length / 4);
        if (luma < DARK_FRAME_LUMA) return "camera covered or in the dark";
      } catch {
        /* A tainted or not-yet-ready frame is not evidence of an outage. */
        return null;
      }
      return null;
    }

    const timer = window.setInterval(() => {
      const reason = outage();
      if (!reason) {
        if (videoLostAt.current) {
          videoLostAt.current = 0;
          setCameraReady(true);
          setWarning(null);
        }
        return;
      }
      setCameraReady(false);
      if (!videoLostAt.current) {
        videoLostAt.current = Date.now();
        warn(
          "We can no longer see you. Please turn your camera back on and uncover it — the interview will end if the picture does not come back within 30 seconds.",
        );
        proctor.mutate({ token, kind: "camera_signal", detail: reason, awaySeconds: 0, flags: ["camera_lost"] });
        return;
      }
      if (Date.now() - videoLostAt.current > CAMERA_GRACE_MS) {
        void endRef.current({
          terminated: true,
          flag: "camera_off_terminated",
          reason: `Camera picture lost for more than ${Math.round(CAMERA_GRACE_MS / 1000)} seconds (${reason}) — interview terminated`,
        });
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [phase, proctor, token, warn]);

  const record = useCallback(
    (role: "ai" | "candidate", text: string) => {
      const turn: Turn = { role, text, at: Date.now() };
      setTurns((prev) => [...prev, turn]);
      append.mutate({ token, turns: [turn] });
    },
    [append, token],
  );

  function teardown() {
    dc.current?.close();
    pc.current?.close();
    stream.current?.getTracks().forEach((t) => t.stop());
    camStream.current?.getTracks().forEach((t) => t.stop());
    dc.current = null;
    pc.current = null;
    stream.current = null;
    camStream.current = null;
    setCameraReady(false);
    setAiStream(null);
    setOrbState("idle");
  }

  /**
   * Records the candidate's camera and microphone locally for the recruiter's
   * evidence file. Stopping resolves with the finished blob.
   */
  function startRecording(media: MediaStream) {
    const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
    if (!mimeType) return;
    chunks.current = [];
    const rec = new MediaRecorder(media, { mimeType, videoBitsPerSecond: 700_000 });
    rec.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };
    rec.start(4000);
    recorder.current = rec;
  }

  function stopRecording(): Promise<Blob | null> {
    const rec = recorder.current;
    recorder.current = null;
    if (!rec || rec.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(chunks.current, { type: rec.mimeType || "video/webm" });
        chunks.current = [];
        resolve(blob.size > 0 ? blob : null);
      };
      rec.stop();
    });
  }

  /** Uploads the interview recording straight to storage and returns its key. */
  async function uploadRecording(blob: Blob): Promise<string | null> {
    try {
      const res = await fetch("/api/ai-interview/recording-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, contentType: blob.type || "video/webm" }),
      });
      if (!res.ok) return null;
      const { url, key } = (await res.json()) as { url: string; key: string };
      const put = await fetch(url, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": blob.type || "video/webm" },
      });
      return put.ok ? key : null;
    } catch {
      return null;
    }
  }

  /**
   * Marks off any question from the set that this utterance just asked. Coverage
   * is what lets the room end the interview on its own once the set is done,
   * instead of leaving the candidate to hang up.
   */
  function noteCoverage(spoken: string) {
    if (!spoken.trim() || questionsRef.current.length === 0) return;
    questionsRef.current.forEach((question, index) => {
      if (askedRef.current.has(index)) return;
      if (looksLikeQuestion(question, spoken)) askedRef.current.add(index);
    });
    if (askedRef.current.size >= questionsRef.current.length && !coveredAt.current) {
      coveredAt.current = Date.now();
    }
  }

  /** Connect to the OpenAI Realtime API over WebRTC using an ephemeral key. */
  async function connectVoice(rejoinTurns?: Turn[]): Promise<boolean> {
    const res = await fetch("/api/ai-interview/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { reason?: string };
      throw new Error(body.reason ? `Voice service unavailable: ${body.reason}` : "Voice service unavailable.");
    }
    const payload = (await res.json()) as {
      clientSecret: string;
      model: string;
      minMinutes?: number;
      maxMinutes?: number;
      silenceNudgeSeconds?: number;
      proctoringEnabled?: boolean;
      awayPenaltyMultiplier?: number;
      questionCount?: number;
      questions?: string[];
    };
    const { clientSecret, model } = payload;
    setLimits({
      minMinutes: payload.minMinutes ?? 10,
      maxMinutes: payload.maxMinutes ?? 15,
      silenceNudgeSeconds: payload.silenceNudgeSeconds ?? 10,
      proctoringEnabled: payload.proctoringEnabled ?? true,
      awayPenaltyMultiplier: payload.awayPenaltyMultiplier ?? 2,
      questionCount: payload.questionCount ?? 0,
      questions: payload.questions ?? [],
    });
    questionsRef.current = payload.questions ?? [];

    /* Camera + microphone were already proven to work by the pre-flight device
       gate, and that same stream is reused here — an interview never starts
       without both. */
    const media = preflight.current;
    if (!media || media.getAudioTracks().length === 0 || media.getVideoTracks().length === 0) {
      throw new Error("Camera and microphone are required for this interview.");
    }
    stream.current = media;
    camStream.current = media;
    if (media.getVideoTracks().length > 0) {
      setCameraReady(true);
      if (camVideo.current) {
        camVideo.current.srcObject = media;
        void camVideo.current.play().catch(() => undefined);
      }
    }
    startRecording(media);

    const peer = new RTCPeerConnection();
    pc.current = peer;

    peer.ontrack = (event) => {
      const remote = event.streams[0]!;
      /* Feed the same track to the speaker and to the animated avatar. */
      setAiStream(remote);
      if (audioEl.current) {
        audioEl.current.srcObject = remote;
        void audioEl.current.play();
      }
    };
    /* Only audio goes to the Realtime model — the video track is for the local
       recording and the proctoring frames. */
    media.getAudioTracks().forEach((track) => peer.addTrack(track, media));

    const channel = peer.createDataChannel("oai-events");
    dc.current = channel;
    channel.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type: string;
          delta?: string;
          transcript?: string;
          name?: string;
          item?: { type?: string; name?: string };
        };
        /* The interviewer has finished its question set and said its goodbyes.
           The call is closed as soon as those words have finished playing. */
        const toolName = msg.name ?? msg.item?.name;
        if (
          toolName === "end_interview" &&
          (msg.type === "response.function_call_arguments.done" ||
            msg.type === "response.output_item.done" ||
            msg.type === "conversation.item.created")
        ) {
          if (!completionRequested.current) completionRequested.current = Date.now();
        }
        if (msg.type === "output_audio_buffer.started" || msg.type === "response.output_audio.delta") {
          aiSpeaking.current = true;
          setOrbState("speaking");
        }
        if (msg.type === "output_audio_buffer.stopped" || msg.type === "response.done") {
          aiSpeaking.current = false;
          setOrbState("listening");
        }
        if (msg.type === "input_audio_buffer.speech_started") {
          lastSpeechAt.current = Date.now();
          userSpeaking.current = true;
          userSpeechStartedAt.current = Date.now();
          setOrbState("listening");
          /* The candidate has the floor. Short bursts are ignored (see
             BARGE_IN_MS) but sustained speech stops the interviewer talking
             over them — the API's own interrupt is off precisely so that a
             cough or a chair scrape cannot do this. */
          window.setTimeout(() => {
            if (!userSpeaking.current || !aiSpeaking.current) return;
            const live = dc.current;
            if (!live || live.readyState !== "open") return;
            live.send(JSON.stringify({ type: "response.cancel" }));
            aiComplete.current = true;
          }, BARGE_IN_MS);
        }
        if (msg.type === "input_audio_buffer.speech_stopped") {
          lastSpeechAt.current = Date.now();
          userSpeaking.current = false;
          setOrbState("thinking");
        }
        if (
          (msg.type === "response.output_audio_transcript.delta" ||
            msg.type === "response.audio_transcript.delta") &&
          msg.delta
        ) {
          pendingAi.current += msg.delta;
        }
        if (msg.type === "response.output_audio_transcript.done" || msg.type === "response.audio_transcript.done") {
          /* Generation is finished, but the audio is still playing. The caption
             loop keeps releasing the text at speaking pace and commits the turn
             once it has caught up. */
          if (msg.transcript && msg.transcript.length > pendingAi.current.length) {
            pendingAi.current = msg.transcript;
          }
          aiComplete.current = true;
          noteCoverage(pendingAi.current);
        }
        if (msg.type === "conversation.item.input_audio_transcription.delta" && msg.delta) {
          pendingUser.current += msg.delta;
        }
        if (msg.type === "conversation.item.input_audio_transcription.completed") {
          const text = (msg.transcript ?? pendingUser.current).trim();
          pendingUser.current = "";
          if (text) record("candidate", text);
        }
      } catch {
        /* ignore non-JSON frames */
      }
    };
    channel.onopen = () => {
      /* A rejoin is not a new interview. The model has no memory of the previous
         connection, so the transcript so far is replayed as context and it is
         told to pick up rather than start again — otherwise a reload would mean
         answering question one twice. */
      if (rejoinTurns && rejoinTurns.length > 0) {
        const history = rejoinTurns
          .slice(-40)
          .map((turn) => `${turn.role === "ai" ? "You" : "Candidate"}: ${turn.text}`)
          .join("\n")
          .slice(-6000);
        channel.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: `[SYSTEM] The candidate's connection dropped and they have just rejoined. This is the interview so far — treat it as your own memory of the conversation:\n\n${history}`,
                },
              ],
            },
          }),
        );
        channel.send(
          JSON.stringify({
            type: "response.create",
            response: {
              instructions:
                "The candidate lost their connection and has rejoined. Welcome them back in one short sentence, then continue the interview from exactly where it stopped — ask the next unasked question from your set, or re-ask only the question that was interrupted. Never restart the interview, never repeat a question they already answered, and do not discuss the disconnection beyond that one sentence.",
            },
          }),
        );
        return;
      }
      // The interviewer speaks first: greet the candidate and ask question one.
      channel.send(
        JSON.stringify({
          type: "response.create",
          response: {
            instructions:
              "Greet the candidate warmly by name if you know it, say in one short sentence that you'll be running a short screening interview, then ask your first question exactly as written in your set. Two sentences plus the question, nothing more. No explanation of the question, no reassurance, no preamble.",
          },
        }),
      );
    };

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    const answer = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`, {
      method: "POST",
      body: offer.sdp,
      headers: { Authorization: `Bearer ${clientSecret}`, "Content-Type": "application/sdp" },
    });
    if (!answer.ok) {
      const detail = (await answer.text().catch(() => "")).slice(0, 200);
      teardown();
      throw new Error(`Could not connect to the voice interviewer.${detail ? ` (${detail})` : ""}`);
    }
    await peer.setRemoteDescription({ type: "answer", sdp: await answer.text() });
    return true;
  }

  /**
   * Pre-flight device gate. The interview is only valid as recorded evidence if
   * both the camera and the microphone work, so it is never started with one of
   * them missing — the candidate gets a minute to fix it instead.
   */
  async function checkDevices(): Promise<{ camera: boolean; microphone: boolean; detail?: string }> {
    preflight.current?.getTracks().forEach((t) => t.stop());
    preflight.current = null;
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      });
      const camera = media.getVideoTracks().some((t) => t.readyState === "live");
      const microphone = media.getAudioTracks().some((t) => t.readyState === "live");
      if (camera && microphone) {
        preflight.current = media;
        return { camera, microphone };
      }
      media.getTracks().forEach((t) => t.stop());
      return { camera, microphone, detail: "A device was found but is not delivering a signal" };
    } catch (e) {
      /* Work out which of the two is actually missing so the on-screen guidance
         names the right device. */
      const detail = (e as Error).message;
      let camera = false;
      let microphone = false;
      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
        microphone = audioOnly.getAudioTracks().length > 0;
        audioOnly.getTracks().forEach((t) => t.stop());
      } catch {
        microphone = false;
      }
      try {
        const videoOnly = await navigator.mediaDevices.getUserMedia({ video: true });
        camera = videoOnly.getVideoTracks().length > 0;
        videoOnly.getTracks().forEach((t) => t.stop());
      } catch {
        camera = false;
      }
      return { camera, microphone, detail };
    }
  }

  /** Runs the gate and moves the flow on, or opens the one-minute setup window. */
  async function gateDevices(): Promise<boolean> {
    const result = await checkDevices();
    setDevices({ camera: result.camera, microphone: result.microphone });
    setDeviceDetail(result.detail ?? null);
    if (result.camera && result.microphone) return true;
    if (phase !== "setup") setSetupLeft(DEVICE_SETUP_SECONDS);
    setPhase("setup");
    return false;
  }

  /** Retry from the setup screen; gives up politely once the minute is gone. */
  async function retryDevices() {
    const ok = await gateDevices();
    if (ok) {
      await launch();
      return;
    }
    if (setupLeft <= 0) void abandonForDevices();
  }

  /** The minute ran out with a device still missing — close the room politely. */
  async function abandonForDevices() {
    await deviceFailure
      .mutateAsync({
        token,
        camera: devices.camera,
        microphone: devices.microphone,
        detail: deviceDetail ?? undefined,
      })
      .catch(() => undefined);
    setPhase("declined");
  }

  /* Once the setup window expires the interview is closed out on its own. */
  useEffect(() => {
    if (phase !== "setup" || setupLeft > 0) return;
    void abandonForDevices();
    /* abandonForDevices is stable enough for this one-shot transition. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, setupLeft]);

  /** Consent is recorded, devices are proven — open the room. */
  async function launch() {
    setPhase("connecting");
    try {
      await consentMutation.mutateAsync({ token, consentGiven: true, identityVerified: true });
      const started = await start.mutateAsync({ token });
      /* The clock belongs to the server: an interview that has already been
         running keeps its original start so a reload cannot buy fresh minutes. */
      startedAt.current = started.startedAt ? new Date(started.startedAt).getTime() : Date.now();
      lastSpeechAt.current = Date.now();
      nudgeCount.current = 0;
      wrapUpSent.current = false;
      completionRequested.current = 0;
      completionRejected.current = false;
      completionSpokenAt.current = 0;
      askedRef.current = new Set();
      coveredAt.current = 0;
      forcedCloseSent.current = false;
      completionSpokenAt.current = 0;
      videoLostAt.current = 0;
      userSpeaking.current = false;

      if (voiceMode) {
        try {
          await connectVoice();
        } catch (e) {
          /* The candidate must never see the provider's error — an expired key or
             an exhausted quota is not their problem and not their business. They
             get one polite notice; the super admins get the exact message. */
          teardown();
          setVoiceFailed(true);
          reportError.mutate({ token, scope: "voice_connection", message: (e as Error).message });
          setError(VOICE_FAILURE_NOTICE);
          setPhase("consent");
          return;
        }
      } else {
        const first = FALLBACK_QUESTIONS[0]!;
        record("ai", first);
        setFallbackIndex(1);
      }
      setPhase("live");
    } catch (e) {
      reportError.mutate({ token, scope: "interview_start", message: (e as Error).message });
      setError(VOICE_FAILURE_NOTICE);
      setPhase("consent");
    }
  }

  /**
   * Rejoin an interview that is already in progress — a reload, a crash, a lost
   * connection. The transcript and the original clock come back from the server,
   * and the time the candidate was gone is deducted before they carry on, so a
   * reload is never a free break to look something up.
   */
  async function rejoin() {
    setError(null);
    setPhase("connecting");
    const ok = await gateDevices();
    if (!ok) return;
    try {
      const state = await resumeInterview.mutateAsync({ token });
      const history = (state.transcript as Turn[]) ?? [];
      setTurns(history);
      startedAt.current = state.startedAt ? new Date(state.startedAt).getTime() : Date.now();
      awaySecondsRef.current = state.awaySeconds;
      penaltyRef.current = state.timePenaltySeconds;
      setPenaltySeconds(state.timePenaltySeconds);
      lastSpeechAt.current = Date.now();
      nudgeCount.current = 0;
      wrapUpSent.current = false;
      completionRequested.current = 0;
      completionRejected.current = false;
      completionSpokenAt.current = 0;
      askedRef.current = new Set();
      coveredAt.current = 0;
      forcedCloseSent.current = false;
      completionSpokenAt.current = 0;
      videoLostAt.current = 0;
      userSpeaking.current = false;
      endingRef.current = false;
      setResumeNotice(
        state.gapSeconds > 0
          ? `Welcome back. You were away for ${state.gapSeconds} seconds, so ${Math.round(state.timePenaltySeconds)} seconds have been deducted from your interview time. We're picking up where you left off.`
          : "Welcome back — we're picking up where you left off.",
      );
      await connectVoice(history);
      setPhase("live");
    } catch (e) {
      teardown();
      reportError.mutate({ token, scope: "interview_resume", message: (e as Error).message });
      setError(VOICE_FAILURE_NOTICE);
      setPhase("consent");
    }
  }

  /** Start button: consent, then the device gate, then the room. */
  async function begin() {
    setError(null);
    if (!consent || !identity) {
      setError("Please confirm your identity and give consent to continue.");
      return;
    }
    if (!devices.camera || !devices.microphone) {
      setError("Your camera and microphone both need to be working before the interview can start.");
      return;
    }
    setPhase("connecting");
    const ok = await gateDevices();
    if (!ok) return;
    await launch();
  }

  function sendText() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    record("candidate", text);

    if (voiceMode && dc.current?.readyState === "open") {
      dc.current.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
        }),
      );
      dc.current.send(JSON.stringify({ type: "response.create" }));
      return;
    }

    const next = FALLBACK_QUESTIONS[fallbackIndex];
    if (next) {
      setTimeout(() => {
        record("ai", next);
        setFallbackIndex((i) => i + 1);
      }, 700);
    } else {
      setTimeout(() => record("ai", "That's everything I needed. Thank you — your recruiter will follow up."), 700);
    }
  }

  /**
   * Ends the interview and ships the evidence. `terminated` marks an interview
   * the system cut short (inactivity, or the hard time cap being blown) so the
   * recruiter sees why rather than a silently short report.
   */
  async function end(options?: { terminated?: boolean; reason?: string; flag?: string }) {
    if (endingRef.current) return;
    endingRef.current = true;
    if (options?.flag) flagsRef.current.add(options.flag);
    /* Whatever the interviewer had said but not yet finished captioning still
       belongs in the transcript the recruiter reads. */
    const trailing = pendingAi.current.trim();
    pendingAi.current = "";
    aiRevealed.current = 0;
    aiComplete.current = false;
    setAiShown("");
    if (trailing) record("ai", trailing);
    setPhase("finishing");
    if (options?.terminated) setTerminationNotice(options.reason ?? "The interview was ended early.");
    const recording = await stopRecording();
    teardown();
    const videoKey = recording ? await uploadRecording(recording) : null;
    try {
      const result = await finish.mutateAsync({
        token,
        durationSeconds: elapsed,
        videoKey: videoKey ?? undefined,
        recordingKey: videoKey ?? undefined,
        focusLossCount: focusLossRef.current,
        awaySeconds: awaySecondsRef.current,
        timePenaltySeconds: penaltyRef.current,
        fraudFlags: [...flagsRef.current],
        positiveSignals: [...positivesRef.current],
        terminated: Boolean(options?.terminated),
        terminationReason: options?.reason,
      });
      setCompletedSummary(
        result.graded ? "Your interview has been summarised and shared with the recruitment team." : null,
      );
    } catch (e) {
      setError((e as Error).message);
    }
    setPhase("done");
  }

  /* The guardrail timers below are declared before `end`, so they reach it
     through a ref that always points at the current closure. */
  endRef.current = end;

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    stream.current?.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
  }

  if (interview.isLoading) {
    return (
      <div className="app-bg grid min-h-screen place-items-center">
        <Spinner className="size-6 text-primary" />
      </div>
    );
  }

  if (interview.isError || !interview.data) {
    return (
      <div className="app-bg grid min-h-screen place-items-center p-6">
        <Card className="max-w-md p-7 text-center">
          <h1 className="font-display text-[20px] font-bold">This interview link isn't valid</h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            It may have expired or already been completed. Please contact your recruiter for a new link.
          </p>
        </Card>
      </div>
    );
  }

  const data = interview.data;
  const candidateName = data.candidate ? `${data.candidate.firstName} ${data.candidate.lastName ?? ""}`.trim() : "there";
  /* A terminated session is finished too — its link must not restart. */
  const alreadyDone = data.status === "completed" || data.status === "terminated";

  return (
    <div className="app-bg min-h-screen">
      <audio ref={audioEl} autoPlay playsInline className="hidden" />

      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5">
        <img src="/images/skillton-wordmark.png" alt="Skillton" className="h-7 w-auto sm:h-8" />
        {phase === "live" && (
          <div className="flex items-center gap-3">
            <Badge tone="danger" className="pulse-ring">
              <Radio className="size-3" /> Recording
            </Badge>
            <span className="num text-[13px] text-muted-foreground">
              {String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}
            </span>
            {penaltySeconds > 0 && (
              <Badge tone="warning" title="Time deducted for leaving the interview screen">
                −{penaltySeconds}s
              </Badge>
            )}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-20">
        {(phase === "done" || alreadyDone) && (
          <Card className="rise p-8 text-center">
            {terminationNotice ? (
              <ShieldAlert className="mx-auto mb-4 size-10 text-destructive" />
            ) : (
              <CheckCircle2 className="mx-auto mb-4 size-10 text-success" />
            )}
            <h1 className="font-display text-[24px] font-bold">
              {terminationNotice ? "Interview ended" : "Interview complete"}
            </h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
              {terminationNotice
                ? `${terminationNotice} Everything recorded so far has been sent to the recruitment team, who will decide whether to reschedule.`
                : `Thank you, ${candidateName}. Your responses have been recorded and shared with the recruitment team — they will be in touch about the next step.`}
            </p>
            <p className="mt-3 text-[12.5px] text-muted-foreground">
              Nothing else is needed from you — you can close this window.
            </p>
            {completedSummary && (
              <p className="mt-5 rounded-lg border border-border bg-white/[0.02] p-4 text-left text-[12.5px] leading-relaxed text-muted-foreground">
                {completedSummary}
              </p>
            )}
          </Card>
        )}

        {phase === "consent" && !alreadyDone && (
          <Card className="rise p-7">
            <Badge tone="primary" className="mb-4">
              <Sparkles className="size-3" /> AI screening interview
            </Badge>
            <h1 className="font-display text-[26px] font-bold">
              {data.resumable ? `Welcome back, ${candidateName}` : `Hello ${candidateName}`}
            </h1>
            {data.resumable && (
              <p className="mt-2.5 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-[13px] leading-relaxed text-foreground">
                Your interview is still in progress — it will continue from where it stopped, with the questions you
                have already answered kept. The time you were away counts as time away from the interview and is
                deducted from what's left.
              </p>
            )}
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted-foreground">
              You've been invited to a short first-round interview
              {data.job?.title ? ` for the ${data.job.title} role` : ""}. It's conducted by an AI interviewer, takes
              about {limits.minMinutes}–{limits.maxMinutes} minutes, and covers your recent work, a problem you solved, your motivation and your
              availability.
            </p>

            <div className="mt-6 space-y-3 rounded-xl border border-border bg-white/[0.02] p-4">
              <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                <ShieldCheck className="size-3.5" /> Before we start
              </p>
              <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                <li>· Your camera and microphone are recorded and reviewed by the recruitment team.</li>
                <li>· Your audio is transcribed and attached to your interview report.</li>
                <li>· There is no score — the interview produces a written summary only.</li>
                <li>· Stay on this page for the whole interview — time spent on other tabs is deducted.</li>
                <li>· Keep your face in the camera, and remove headphones or earphones.</li>
                <li>· A working camera <strong>and</strong> microphone are required — the interview cannot run without both.</li>
                <li>· Find a quiet space. You can answer by voice, or type if you need to.</li>
                <li>· You may stop the interview at any time.</li>
              </ul>
            </div>

            {/* Device check lives here, on the hello screen: the candidate can see
                their own picture and watch the microphone meter move before they
                agree to anything, and Start stays locked until both work. */}
            <div className="mt-5 rounded-xl border border-border bg-white/[0.02] p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Video className="size-3.5" /> Camera and microphone check
                </p>
                <Button variant="outline" size="sm" onClick={() => setDeviceAttempt((n) => n + 1)}>
                  <RotateCw className="size-3.5" /> Check again
                </Button>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,180px)_1fr]">
                <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-border bg-black/60">
                  <video
                    ref={previewVideo}
                    muted
                    playsInline
                    autoPlay
                    className="size-full scale-x-[-1] object-cover"
                  />
                  {!devices.camera && (
                    <div className="absolute inset-0 grid place-items-center text-center">
                      {checkingDevices ? (
                        <Spinner className="size-5 text-primary" />
                      ) : (
                        <VideoOff className="size-6 text-destructive" />
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-2.5">
                  <div className="flex items-center gap-2 text-[13px]">
                    {devices.camera ? (
                      <CheckCircle2 className="size-4 text-success" />
                    ) : (
                      <AlertTriangle className="size-4 text-destructive" />
                    )}
                    <span>
                      {checkingDevices
                        ? "Checking your camera…"
                        : devices.camera
                          ? "Camera working — that's what we'll record"
                          : "Camera not available"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[13px]">
                    {devices.microphone ? (
                      <CheckCircle2 className="size-4 text-success" />
                    ) : (
                      <AlertTriangle className="size-4 text-destructive" />
                    )}
                    <span>
                      {checkingDevices
                        ? "Checking your microphone…"
                        : devices.microphone
                          ? "Microphone working — say something to test it"
                          : "Microphone not available"}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-100"
                      style={{ width: `${devices.microphone ? micLevel : 0}%` }}
                    />
                  </div>
                  <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                    {devices.camera && devices.microphone
                      ? "Both devices are ready. The bar should move while you talk."
                      : "Allow camera and microphone access in your browser, close any other app using them, then press Check again."}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <Switch
                checked={identity}
                onChange={setIdentity}
                label={`I confirm I am ${candidateName} and I am completing this interview myself`}
              />
              <Switch
                checked={consent}
                onChange={setConsent}
                label="I consent to my camera and audio being recorded, transcribed and reviewed"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <p className="text-[13px] leading-relaxed text-foreground">{error}</p>
              </div>
            )}

            <Button
              onClick={() => void (data.resumable ? rejoin() : begin())}
              size="lg"
              className="glow-primary mt-6 w-full"
              disabled={!consent || !identity || !devices.camera || !devices.microphone}
            >
              <Mic className="size-4" />
              {data.resumable
                ? "Rejoin interview"
                : voiceFailed
                  ? "Try again"
                  : !devices.camera || !devices.microphone
                    ? "Waiting for camera and microphone"
                    : "Start interview"}
            </Button>

            <p className="mt-3 text-center text-[11.5px] text-muted-foreground">
              {data.resumable
                ? "Your interview is still open. You'll continue from where it stopped, and the time you were away is deducted from your remaining interview time."
                : "The interviewer speaks first — make sure your speakers are on."}
            </p>
          </Card>
        )}

        {phase === "setup" && (
          <Card className="rise p-7">
            <Badge tone="warning" className="mb-4">
              <AlertTriangle className="size-3" /> Camera and microphone check
            </Badge>
            <h1 className="font-display text-[22px] font-bold">
              We can't start without your {!devices.camera && !devices.microphone
                ? "camera and microphone"
                : !devices.camera
                  ? "camera"
                  : "microphone"}
            </h1>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted-foreground">
              This interview is recorded, so both your camera and your microphone have to be working. Please fix
              it now — you have{" "}
              <span className="num font-semibold text-foreground">{setupLeft}s</span> before the room closes.
            </p>

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <div className="flex items-center gap-2.5 rounded-xl border border-border bg-white/[0.02] px-3.5 py-3">
                {devices.camera ? (
                  <Video className="size-4 text-success" />
                ) : (
                  <VideoOff className="size-4 text-destructive" />
                )}
                <span className="text-[13px]">Camera {devices.camera ? "detected" : "not available"}</span>
              </div>
              <div className="flex items-center gap-2.5 rounded-xl border border-border bg-white/[0.02] px-3.5 py-3">
                {devices.microphone ? (
                  <Mic className="size-4 text-success" />
                ) : (
                  <MicOff className="size-4 text-destructive" />
                )}
                <span className="text-[13px]">
                  Microphone {devices.microphone ? "detected" : "not available"}
                </span>
              </div>
            </div>

            <ul className="mt-5 space-y-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
              <li>· Click the camera icon in your browser's address bar and allow both devices.</li>
              <li>· Close any other app using them — Zoom, Teams, Meet, another browser tab.</li>
              <li>· Plug the device back in, or switch to a laptop with a built-in camera.</li>
              <li>· Then press "Check again" below.</li>
            </ul>

            <div className="mt-6 flex flex-wrap gap-2">
              <Button onClick={() => void retryDevices()} className="glow-primary">
                <RotateCw className="size-4" /> Check again
              </Button>
              <Button variant="outline" onClick={() => void abandonForDevices()}>
                I can't fix this now
              </Button>
            </div>
          </Card>
        )}

        {phase === "declined" && (
          <Card className="rise p-8 text-center">
            <VideoOff className="mx-auto mb-4 size-10 text-warning" />
            <h1 className="font-display text-[24px] font-bold">Thank you, {candidateName}</h1>
            <p className="mx-auto mt-2.5 max-w-md text-[13.5px] leading-relaxed text-muted-foreground">
              We couldn't start your interview because your camera and microphone weren't both available. Nothing
              has been recorded and this attempt does not count against you.
            </p>
            <p className="mx-auto mt-3 max-w-md text-[13.5px] leading-relaxed text-muted-foreground">
              Please contact your HR or recruitment contact to arrange another interview slot. We look forward to
              speaking with you then.
            </p>
          </Card>
        )}

        {phase === "connecting" && (
          <Card className="rise p-10 text-center">
            <Spinner className="mx-auto size-6 text-primary" />
            <p className="mt-4 text-[13.5px]">Connecting your interview room…</p>
            <p className="mt-1 text-[12px] text-muted-foreground">Allow microphone access if your browser asks.</p>
          </Card>
        )}

        {phase === "live" && (
          <div className="space-y-4">
            {resumeNotice && (
              <div className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3">
                <RotateCw className="mt-0.5 size-4 shrink-0 text-primary" />
                <p className="text-[13px] leading-relaxed text-foreground">{resumeNotice}</p>
              </div>
            )}
            {warning && (
              <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                <p className="text-[13px] leading-relaxed text-foreground">{warning}</p>
              </div>
            )}
            {voiceMode && (
              <Card className="overflow-hidden p-0">
                {/* The candidate's own picture is the main element — they are on
                    camera, and seeing themselves keeps them framed. The voice
                    orb is reduced to a small live indicator over it. */}
                <div className="relative w-full overflow-hidden bg-black">
                  <video
                    ref={camVideo}
                    muted
                    playsInline
                    autoPlay
                    className="block max-h-[62vh] w-full scale-x-[-1] object-cover"
                  />
                  {!cameraReady && (
                    <div className="absolute inset-0 grid place-items-center bg-black/80 px-6 text-center">
                      <div>
                        <VideoOff className="mx-auto size-7 text-destructive" />
                        <p className="mt-3 text-[13px] font-medium text-foreground">Camera picture lost</p>
                        <p className="mt-1 text-[12px] text-muted-foreground">
                          Turn your camera back on and uncover it — the interview ends if it stays off.
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-full border border-border/70 bg-black/55 px-2.5 py-1 text-[10.5px] backdrop-blur">
                    {cameraReady ? (
                      <>
                        <Video className="size-3 text-success" />
                        <span className="text-muted-foreground">Camera on · recording</span>
                      </>
                    ) : (
                      <>
                        <VideoOff className="size-3 text-destructive" />
                        <span className="text-destructive">No camera</span>
                      </>
                    )}
                  </div>
                  <div className="absolute bottom-4 right-4 flex flex-col items-center gap-1.5 rounded-2xl border border-border/70 bg-black/55 px-3 py-2.5 backdrop-blur">
                    <VoiceOrb stream={aiStream} state={orbState} size={72} />
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {orbState === "speaking" ? "Speaking" : orbState === "thinking" ? "Thinking" : "Listening"}
                    </span>
                  </div>
                </div>
                <p className="px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
                  This interview runs {limits.minMinutes}–{limits.maxMinutes} minutes. Take your time — the
                  interviewer waits for you to finish. Stay on this page and keep your face in the camera.
                </p>
              </Card>
            )}
            <Card className="flex flex-wrap items-center gap-3 p-4">
              <span
                className={
                  voiceMode
                    ? "grid size-10 place-items-center rounded-xl bg-primary/15 text-primary"
                    : "grid size-10 place-items-center rounded-xl bg-info/15 text-info"
                }
              >
                {voiceMode ? <Mic className="size-4" /> : <Keyboard className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium">
                  {voiceMode ? "Voice interview in progress" : "Typed interview in progress"}
                </p>
                <p className="text-[12px] text-muted-foreground">
                  {voiceMode
                    ? "Speak naturally — the interviewer is listening and will reply out loud."
                    : "You chose the typed interview. Answer in the box below."}
                  {focusLosses > 0 &&
                    ` You have left this page ${focusLosses} time(s); ${penaltySeconds}s of interview time was deducted.`}
                </p>
              </div>
              {voiceMode && (
                <Button variant="outline" size="sm" onClick={toggleMute}>
                  {muted ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
                  {muted ? "Unmute" : "Mute"}
                </Button>
              )}
              <Button variant="destructive" size="sm" onClick={() => void end()}>
                <PhoneOff className="size-3.5" /> End interview
              </Button>
            </Card>

            <Card className="p-0">
              <div ref={scrollRef} className="max-h-[46vh] space-y-3 overflow-y-auto p-4">
                {turns.length === 0 && !aiShown && (
                  <p className="py-8 text-center text-[13px] text-muted-foreground">
                    The interviewer is about to speak…
                  </p>
                )}
                {turns.map((turn, i) => (
                  <div
                    key={i}
                    className={turn.role === "ai" ? "flex justify-start" : "flex justify-end"}
                  >
                    <div
                      className={
                        turn.role === "ai"
                          ? "max-w-[80%] rounded-2xl rounded-tl-sm border border-border bg-white/[0.04] px-3.5 py-2.5"
                          : "max-w-[80%] rounded-2xl rounded-tr-sm border border-primary/30 bg-primary/12 px-3.5 py-2.5"
                      }
                    >
                      <p className="mb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {turn.role === "ai" ? "Interviewer" : "You"}
                      </p>
                      <p className="text-[13px] leading-relaxed">{turn.text}</p>
                    </div>
                  </div>
                ))}
                {/* Live caption: written out as the interviewer speaks, never ahead of it. */}
                {aiShown && (
                  <div className="flex justify-start">
                    <div className="max-w-[80%] rounded-2xl rounded-tl-sm border border-primary/25 bg-white/[0.04] px-3.5 py-2.5">
                      <p className="mb-0.5 text-[10px] uppercase tracking-wider text-primary/80">
                        Interviewer · speaking
                      </p>
                      <p className="text-[13px] leading-relaxed">
                        {aiShown}
                        <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-primary align-middle" />
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 border-t border-border p-3">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendText();
                  }}
                  placeholder={voiceMode ? "Or type your answer…" : "Type your answer…"}
                />
                <Button onClick={sendText} disabled={!draft.trim()}>
                  Send
                </Button>
              </div>
            </Card>
          </div>
        )}

        {phase === "finishing" && (
          <Card className="rise p-10 text-center">
            <Spinner className="mx-auto size-6 text-primary" />
            <p className="mt-4 text-[13.5px]">Wrapping up and preparing your summary…</p>
          </Card>
        )}
      </main>
    </div>
  );
}
