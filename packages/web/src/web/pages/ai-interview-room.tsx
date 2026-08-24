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
 * Continuous silence from the candidate before the room will speak a scripted
 * line into the call. A single short delay was not patience — it fired whether
 * or not the candidate was still talking, which is how the audio-check line
 * ended up landing on top of them.
 */
const SPEAK_SETTLE_MS = 1_800;
/**
 * How long a scripted line is held back waiting for a gap. Past this the line
 * matters more than the wait — a candidate who cannot hear anything will not
 * stop talking on their own — so it is spoken anyway, and every line that can
 * reach this path opens with an apology for the interruption.
 */
const SPEAK_WAIT_LIMIT_MS = 20_000;
/**
 * How long an answer that ended mid-thought is given to resume before the room
 * treats the pause as real. "We fixed it by…" followed by four seconds of
 * silence is a candidate still thinking, not an answer — the room waits rather
 * than letting the turn be scored as finished.
 */
const CONTINUATION_WAIT_MS = 4_000;
/**
 * Silence after an unfinished thought before the room gently checks in. One
 * check-in per answer, never a new question — jumping to the next question here
 * is how a half-given answer got lost.
 */
const CONTINUATION_CHECK_IN_MS = 9_000;
/**
 * Words and phrases that mean the candidate is mid-thought: an answer ending on
 * any of them is not finished, whatever the silence that follows says.
 */
const TRAILING_WORDS = new Set([
  "and",
  "but",
  "so",
  "because",
  "which",
  "that",
  "the",
  "a",
  "an",
  "to",
  "for",
  "with",
  "of",
  "in",
  "on",
  "at",
  "by",
  "from",
  "was",
  "were",
  "is",
  "are",
  "my",
  "our",
  "their",
  "like",
  "about",
  "using",
  "um",
  "uh",
  "err",
  "hmm",
  "well",
  "basically",
  "actually",
  "maybe",
  "mainly",
  "mostly",
  "then",
  "when",
  "where",
  "how",
  "if",
  "or",
  "also",
  "just",
]);
/** Phrases with which candidates say, in so many words, "I have finished". */
const DONE_SIGNALS = [
  "that's it",
  "thats it",
  "that's all",
  "thats all",
  "that is all",
  "that's about it",
  "that's how we",
  "that's how i",
  "that's my experience",
  "thats my experience",
  "i think that covers it",
  "that covers it",
  "yeah that's it",
  "so that's",
  "in a nutshell",
  "that's pretty much it",
  "thats pretty much it",
];
/** Ways a candidate says they want to stop, which the room must always honour. */
const STOP_SIGNALS = [
  "i want to stop",
  "i'd like to stop",
  "i want to end",
  "can we stop",
  "can we end",
  "let's stop",
  "i have to go",
  "i need to go",
  "i can't continue",
  "i cannot continue",
  "i don't want to continue",
  "end the interview",
  "stop the interview",
  "quit the interview",
];
/**
 * The lifecycle of a single answer. Held as an explicit state because guessing
 * from silence alone is exactly what cut candidates off mid-thought and let a
 * short reply pass for a finished interview.
 */
type AnswerState =
  | "waiting_for_answer"
  | "candidate_speaking"
  | "possible_answer_end"
  | "waiting_for_continuation"
  | "answer_complete";
/** One answer's timings and why it was judged finished, for post-hoc diagnosis. */
interface AnswerCycle {
  questionIndex: number;
  question: string;
  speechStartedAt: number;
  speechStoppedAt: number;
  possibleAnswerEndAt: number;
  answerCompletedAt: number;
  completionReason:
    | "semantic_complete"
    | "explicit_candidate_completion"
    | "continuation_timeout"
    | "candidate_termination"
    | "";
  transcript: string;
  checkIns: number;
}
/**
 * Shown to the candidate for any interview-room failure. The real provider error
 * (expired key, no credits, network) is never useful to them and must not leak,
 * so it is sent to the super admin instead.
 */
const VOICE_FAILURE_NOTICE =
  "We are currently experiencing an issue with the voice interviewer. Please contact Skillton Intelligence, or your recruitment contact, so they can arrange your interview. Nothing you have done has caused this.";

/**
 * Reads the candidate's reply to "is the audio coming through clearly?".
 * Deliberately conservative: anything that is not a clear no is treated as
 * unclear rather than as a yes, because starting the interview on a broken line
 * wastes the whole sitting.
 */
function readAudioCheck(reply: string): "yes" | "no" | "unclear" {
  const text = reply.toLowerCase().replace(/[^a-z\s']/g, " ");
  const has = (pattern: RegExp) => pattern.test(text);

  if (
    has(
      /\b(no|nope|not really|can'?t hear|cannot hear|couldn'?t hear|breaking up|cutting out|muffled|robotic|distorted|too (?:quiet|low|soft|faint)|very (?:quiet|low|faint)|barely|hardly|say (?:that )?again|repeat that|pardon|sorry what|not clear|unclear|there'?s (?:an )?echo|echoing|static|crackl)/,
    )
  ) {
    return "no";
  }
  if (
    has(
      /\b(yes|yeah|yep|yup|ya|sure|clear|clearly|perfect|perfectly|fine|good|great|okay|ok|all good|loud and clear|i can hear|hear you|audible|no problem|go ahead|ready)\b/,
    )
  ) {
    return "yes";
  }
  return "unclear";
}

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
  /**
   * The scripted opening handshake: the room greets, confirms the candidate can
   * actually hear, and only then lets the interview proper begin. Left to the
   * model this turned into it asking the candidate what its own first question
   * was, so the room drives each turn with the literal words to say.
   */
  const openingStage = useRef<"audio_check" | "warm_up_how" | "warm_up_work" | "interviewing">("audio_check");
  /** Unclear replies to the audio check, so the room stops asking eventually. */
  const audioCheckTries = useRef<number>(0);
  /** Committed interviewer turns, used to spot the model answering for itself. */
  const aiTurnCount = useRef<number>(0);
  /**
   * Where the current answer is in its lifecycle, plus the log of every answer
   * cycle in the sitting. Held explicitly because the premature-wrap bug is
   * intermittent: without a state and a reason recorded for every answer there
   * is nothing to diagnose after the fact.
   */
  const answerState = useRef<AnswerState>("waiting_for_answer");
  const answerCycle = useRef<AnswerCycle | null>(null);
  const answerLog = useRef<AnswerCycle[]>([]);
  /** Continuation watchdog for an answer that stopped mid-thought. */
  const continuationTimer = useRef<number | null>(null);
  /** Last thing the candidate said, read by the completion gate. */
  const lastCandidateText = useRef<string>("");
  /** Set once the candidate has clearly asked to stop, which always ends the call. */
  const stopRequested = useRef<boolean>(false);
  /** The recruiter's question set, and which of its questions have been asked. */
  const questionsRef = useRef<string[]>([]);
  const askedRef = useRef<Set<number>>(new Set());
  /**
   * Which asked questions have actually been ANSWERED. Asked is not answered,
   * and conflating the two is what closed the call on top of a candidate who
   * was still thinking about the last question: the set read as covered the
   * moment the question left the interviewer's mouth.
   */
  const answeredRef = useRef<Set<number>>(new Set());
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
  /**
   * Web Audio graph that mixes BOTH voices into the one audio track the recorder
   * writes. Without it the evidence file was the candidate talking into silence:
   * the recorder was handed the raw camera+mic stream, which by definition
   * cannot contain the interviewer, because the interviewer's voice arrives on a
   * separate WebRTC track and only ever went to the speaker.
   */
  const mixCtx = useRef<AudioContext | null>(null);
  const mixDest = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mixAiSource = useRef<MediaStreamAudioSourceNode | null>(null);
  const awayStartedAt = useRef<number>(0);
  /**
   * Set only while the interview page is genuinely hidden (minimised, tab
   * switched). Kept apart from `awayStartedAt` because losing window FOCUS is
   * not leaving the screen — clicking a second monitor, an OS notification or
   * the address bar all fire `blur` while the candidate is still sitting there
   * looking at the interview, and that must never terminate the sitting.
   */
  const hiddenStartedAt = useRef<number>(0);
  /** Consecutive automatic reconnect attempts after a dropped media connection. */
  const reconnectTries = useRef<number>(0);
  const reconnecting = useRef<boolean>(false);
  /**
   * Phase and transcript read through refs by the reconnect path: it runs from a
   * WebRTC callback and a timer, which would otherwise close over stale values.
   */
  const phaseRef = useRef<Phase>("consent");
  const turnsRef = useRef<Turn[]>([]);
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
        if (text) {
          record("ai", text);
          /* Counts committed interviewer turns, so a scripted line the room is
             holding can tell whether the model has already spoken since the
             trigger — that race is what said the greeting and the warm-up
             question twice in a row. */
          aiTurnCount.current += 1;
        }
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
      /* ASKED IS NOT ANSWERED. This gate used to need only 7 seconds of quiet
         since the candidate last spoke — which is satisfied the instant the
         last question is asked, because the candidate has by definition not
         answered it yet. The room then delivered the closing over the top of
         somebody who was still thinking. Every question must now be answered,
         the candidate must have spoken AFTER the set was completed, and no
         answer may be held open mid-thought. */
      const allAnswered =
        questionsRef.current.length > 0 && answeredRef.current.size >= questionsRef.current.length;
      const spokeSinceCovered = lastSpeechAt.current > coveredAt.current;
      const answerSettled =
        answerState.current !== "candidate_speaking" &&
        answerState.current !== "waiting_for_continuation" &&
        answerState.current !== "possible_answer_end";
      if (
        !wrapUpSent.current &&
        coveredAt.current > 0 &&
        allAnswered &&
        spokeSinceCovered &&
        answerSettled &&
        !aiSpeaking.current &&
        !userSpeaking.current &&
        !pendingAi.current.trim() &&
        Date.now() - coveredAt.current > COVERAGE_SETTLE_MS &&
        Date.now() - lastSpeechAt.current > COVERAGE_SETTLE_MS
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
      if (hiddenStartedAt.current && Date.now() - hiddenStartedAt.current > INACTIVITY_LIMIT_MS) {
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
      /* Nothing the room says may land on top of the candidate. If they are
         mid-answer the mark is left unspent and retried on the next tick. */
      if (userSpeaking.current || aiSpeaking.current || pendingAi.current.trim()) return;
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
      /* An answer that stopped mid-thought is owned by the continuation
         watchdog, which waits and then checks in gently. The nudge must not
         barge in on top of it and re-ask a question they are still answering. */
      if (answerState.current === "waiting_for_continuation" || answerState.current === "candidate_speaking") return;
      if (!userSpeaking.current && silentFor > nudgeAfter && nudgeCount.current < 12) {
        nudgeCount.current++;
        lastSpeechAt.current = Date.now();
        /* Before the interview has begun the only thing outstanding is the audio
           check, so the nudge repeats that question verbatim. Offering to
           "rephrase the question" here is nonsense — no question has been asked
           yet — and it is where the candidate heard instruction-speak. */
        if (openingStage.current === "audio_check") {
          speakIfSilent("Sorry, I didn't catch that — can you hear me clearly?");
          return;
        }
        /* Mid warm-up, the only thing outstanding is the easy question the room
           just asked, so repeat that one rather than talking about a question
           set that has not been opened yet. */
        if (openingStage.current !== "interviewing") {
          speakIfSilent(
            openingStage.current === "warm_up_how" ? warmUpHowLine() : warmUpWorkLine(),
          );
          return;
        }
        channel.send(
          JSON.stringify({
            type: "response.create",
            response: {
              instructions:
                nudgeCount.current % 2 === 1
                  ? "The candidate has been silent for a while. Check in once, in one short sentence, and offer to repeat the question you just asked or give them more time. Do not move to a new question, do not refer to your instructions or to a question set, and keep it under 8 seconds."
                  : "The candidate still cannot answer this one. Acknowledge that warmly in your own words, then continue the interview from where it makes sense. Do not use a stock phrase, do not announce the question number, and never refer to your instructions or to a question set.",
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
      if (!viaAi) return;
      /* The on-screen warning is instant, but the spoken one waits: cutting
         across a candidate mid-answer is exactly the interruption we are
         removing. Retried for up to 30s, then dropped — the banner already
         carried the message. */
      let attempts = 0;
      const trySpeak = () => {
        const channel = dc.current;
        if (!channel || channel.readyState !== "open") return;
        if (userSpeaking.current || aiSpeaking.current || pendingAi.current.trim()) {
          if (attempts++ > 30) return;
          window.setTimeout(trySpeak, 1000);
          return;
        }
        channel.send(
          JSON.stringify({
            type: "response.create",
            response: {
              instructions: `Tell the candidate, in your own words: "${message}" Keep it to one short sentence, then continue the interview from where you were. Do not re-ask the question.`,
            },
          }),
        );
      };
      trySpeak();
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

    /**
     * Returns why the picture is unusable, or null when the camera is fine.
     * `fatal` separates a camera that is genuinely gone from one that is merely
     * dark: a candidate sitting in a dim room, backlit, or in front of a bright
     * window was being terminated mid-interview for a badly lit picture, which
     * is a lighting problem and not evidence of cheating.
     */
    function outage(): { reason: string; fatal: boolean } | null {
      const track = camStream.current?.getVideoTracks()[0];
      if (!track) return { reason: "no camera track", fatal: true };
      if (track.readyState !== "live") return { reason: "camera disconnected", fatal: true };
      if (!track.enabled || track.muted) return { reason: "camera turned off", fatal: true };
      const video = camVideo.current;
      if (!video || video.videoWidth === 0) return { reason: "no video signal", fatal: true };
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
      const problem = outage();
      if (!problem) {
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
          problem.fatal
            ? "We can no longer see you. Please turn your camera back on and uncover it — the interview will end if the picture does not come back within 30 seconds."
            : "We can barely see you — please turn on a light or face a window so the camera can pick you up.",
        );
        proctor.mutate({ token, kind: "camera_signal", detail: problem.reason, awaySeconds: 0, flags: ["camera_lost"] });
        return;
      }
      /* Only a camera that is genuinely gone ends the interview. A dark or badly
         lit picture is logged and warned about but never terminates the sitting
         — that was ending real interviews over room lighting. */
      if (problem.fatal && Date.now() - videoLostAt.current > CAMERA_GRACE_MS) {
        void endRef.current({
          terminated: true,
          flag: "camera_off_terminated",
          reason: `Camera picture lost for more than ${Math.round(CAMERA_GRACE_MS / 1000)} seconds (${problem.reason}) — interview terminated`,
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
    /* The mixer holds the microphone and the interviewer's track; closing it
       releases both and stops the graph running behind a finished interview. */
    mixAiSource.current?.disconnect();
    mixAiSource.current = null;
    mixDest.current = null;
    void mixCtx.current?.close().catch(() => undefined);
    mixCtx.current = null;
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
   * Builds the stream that is actually recorded: the camera picture plus ONE
   * audio track carrying both the candidate's microphone and the interviewer's
   * voice. If the mixer cannot be built for any reason the raw stream is used
   * instead — a recording missing one voice still beats no recording at all.
   */
  function recordableStream(media: MediaStream): MediaStream {
    try {
      const ctx = new AudioContext();
      mixCtx.current = ctx;
      const dest = ctx.createMediaStreamDestination();
      mixDest.current = dest;
      /* The candidate's side. The interviewer's side is connected later, from
         `ontrack`, which cannot fire before the peer connection is answered. */
      ctx.createMediaStreamSource(media).connect(dest);
      const mixed = new MediaStream();
      media.getVideoTracks().forEach((track) => mixed.addTrack(track));
      dest.stream.getAudioTracks().forEach((track) => mixed.addTrack(track));
      return mixed.getAudioTracks().length > 0 ? mixed : media;
    } catch {
      return media;
    }
  }

  /**
   * Adds the interviewer's voice to the recording mix. Called from `ontrack`,
   * which always fires after recording has started — that is fine, because the
   * recorder is holding the mixer's own output track and that track does not
   * change when a new source is connected behind it.
   */
  function attachAiToRecording(remote: MediaStream) {
    const ctx = mixCtx.current;
    const dest = mixDest.current;
    if (!ctx || !dest || remote.getAudioTracks().length === 0) return;
    try {
      mixAiSource.current?.disconnect();
      const source = ctx.createMediaStreamSource(remote);
      source.connect(dest);
      mixAiSource.current = source;
      /* Autoplay policy can leave the context suspended, which would silently
         record nothing at all from either side. */
      if (ctx.state === "suspended") void ctx.resume();
    } catch {
      /* Speaker playback is unaffected; only the mix would lose this voice. */
    }
  }

  /**
   * Records the candidate's camera plus both voices for the recruiter's evidence
   * file. Stopping resolves with the finished blob.
   */
  function startRecording(media: MediaStream) {
    const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
    if (!mimeType) return;
    chunks.current = [];
    const rec = new MediaRecorder(recordableStream(media), { mimeType, videoBitsPerSecond: 700_000 });
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
   * Makes the interviewer say a given line word for word. Used for the scripted
   * opening: describing the line to the model made it read the description out
   * loud instead of the line.
   */
  function speakExactly(line: string, andThen = "") {
    const channel = dc.current;
    if (!channel || channel.readyState !== "open") return;
    /* Kill anything the model has in flight first. With `create_response: true`
       the model answers the candidate's turn on its own, so a scripted line sent
       on top of it produced two interviewer turns back to back — the greeting
       and the warm-up question were both said twice on the real sitting. */
    channel.send(JSON.stringify({ type: "response.cancel" }));
    channel.send(
      JSON.stringify({
        type: "response.create",
        response: {
          instructions:
            `Speak the following, word for word, and add nothing to it: "${line}"` +
            (andThen ? ` ${andThen}` : " Say nothing else in this turn.") +
            " Never mention or refer to this direction.",
        },
      }),
    );
  }

  /** The opening greeting, addressed to the candidate by name. */
  function greetingLine() {
    const person = interview.data?.candidate;
    const name = person ? `${person.firstName} ${person.lastName ?? ""}`.trim() : "";
    return `Hi${name ? ` ${name}` : ""}, I'm your AI screening interviewer today. Is the audio coming through clearly?`;
  }

  /**
   * Handles the candidate's reply to the audio check: begin the interview, ask
   * them to fix their sound, or check once more if the reply was unreadable.
   *
   * The model answers the candidate's turn by itself, and its own instructions
   * now script both branches — so the room only speaks if that answer never
   * comes. Sending unconditionally would make the interviewer say everything
   * twice.
   */
  function handleAudioCheckReply(reply: string) {
    const verdict = readAudioCheck(reply);

    if (verdict === "no") {
      audioCheckTries.current = 0;
      speakIfSilent(
        "Sorry for the interruption — please check your volume or your headphones, and tell me when you can hear me clearly.",
      );
      return;
    }

    if (verdict === "unclear" && audioCheckTries.current < 1) {
      audioCheckTries.current += 1;
      speakIfSilent("Sorry, I didn't catch that — can you hear me clearly?");
      return;
    }

    /* Confirmed (or unreadable twice, which is not worth a third round trip).
       The interview does not start here: two easy warm-up questions come first,
       so the candidate is already talking by the time question one lands. */
    openingStage.current = "warm_up_how";
    speakIfSilent(warmUpHowLine());
  }

  /** Warm-up one: how they are doing, by first name. Not scored, not from the set. */
  function warmUpHowLine() {
    const person = interview.data?.candidate;
    const name = person?.firstName?.trim();
    return `Great${name ? `, ${name}` : ""} — how are you doing today?`;
  }

  /**
   * Warm-up two: one easy question about their current working life, the sort of
   * thing two professionals trade before a meeting starts. Deliberately broad so
   * it fits any discipline, and deliberately fixed so it cannot drift into a
   * real interview question or leak a hint about the set.
   */
  function warmUpWorkLine() {
    return "Good to hear. Before we get into it — what's the biggest challenge you're dealing with in your current role at the moment?";
  }

  /**
   * Drives the two warm-up turns and then hands over to the interview. Each turn
   * is spoken by the room word for word: left to the model, "make small talk"
   * becomes a third and fourth question and a discussion of the answer.
   */
  function handleWarmUpReply() {
    if (openingStage.current === "warm_up_how") {
      openingStage.current = "warm_up_work";
      speakIfSilent(warmUpWorkLine());
      return;
    }
    /* Warm-up done. The first question is handed over verbatim so it cannot be
       paraphrased, announced or described. */
    openingStage.current = "interviewing";
    const first = questionsRef.current[0];
    speakIfSilent(
      "Okay, let's start the interview.",
      first
        ? `Then, in the same turn and with no pause or extra words between them, ask this question word for word: "${first}"`
        : "Then immediately ask your first interview question, and nothing else.",
    );
  }

  /**
   * Says a line only once the candidate has genuinely stopped talking, and only
   * if the interviewer has not answered for itself in the meantime.
   *
   * The old version simply waited 1.8s and then spoke unless the candidate
   * happened to be mid-word at that exact instant. That is not listening: a
   * candidate who paused for breath, or who was still saying "hang on, let me
   * plug my headphones in", got talked over. Now the line waits for a real gap,
   * and only interrupts once the wait limit is gone — which is why every line
   * routed through here opens by apologising for the interruption.
   */
  function speakIfSilent(line: string, andThen = "") {
    const waitingSince = Date.now();
    const turnsAtTrigger = aiTurnCount.current;
    let quietSince = 0;
    const tick = () => {
      if (endingRef.current || phaseRef.current === "done") return;
      /* The interviewer said it itself — nothing to add, and saying it again
         would be a second voice on top of a turn that already worked. */
      if (aiSpeaking.current || pendingAi.current.trim()) return;
      /* It already SAID a whole turn while this line was waiting. On the real
         sitting that is how the greeting and the warm-up question each landed
         twice: the model's own answer finished, the buffer cleared, and the
         room then spoke its scripted copy into the gap. */
      if (aiTurnCount.current > turnsAtTrigger) return;
      const outOfPatience = Date.now() - waitingSince > SPEAK_WAIT_LIMIT_MS;
      const talking = userSpeaking.current || Date.now() - lastSpeechAt.current < SPEAK_SETTLE_MS;
      if (talking && !outOfPatience) {
        quietSince = 0;
        window.setTimeout(tick, 400);
        return;
      }
      if (!outOfPatience) {
        if (!quietSince) quietSince = Date.now();
        if (Date.now() - quietSince < SPEAK_SETTLE_MS) {
          window.setTimeout(tick, 400);
          return;
        }
      }
      speakExactly(line, andThen);
    };
    window.setTimeout(tick, 900);
  }

  /**
   * Moves the answer lifecycle on and logs the transition. The premature-wrap
   * bug is intermittent, so every transition is timestamped in the console and
   * kept in `answerLog` — without a reason recorded per answer there is nothing
   * to look at afterwards.
   */
  function setAnswerState(next: AnswerState, note = "") {
    if (answerState.current === next) return;
    answerState.current = next;
    // eslint-disable-next-line no-console
    console.info("[interview:answer]", {
      state: next,
      note,
      questionIndex: answerCycle.current?.questionIndex ?? -1,
      at: new Date().toISOString(),
      elapsedMs: startedAt.current ? Date.now() - startedAt.current : 0,
    });
  }

  /** Opens a fresh answer cycle for the question currently on the floor. */
  function beginAnswerCycle() {
    const index = Math.max(0, askedRef.current.size - 1);
    answerCycle.current = {
      questionIndex: index,
      question: questionsRef.current[index] ?? "",
      speechStartedAt: Date.now(),
      speechStoppedAt: 0,
      possibleAnswerEndAt: 0,
      answerCompletedAt: 0,
      completionReason: "",
      transcript: "",
      checkIns: 0,
    };
  }

  /**
   * Whether the candidate's thought is actually finished. Silence alone is not
   * evidence: "we fixed it by…" followed by four seconds of quiet is somebody
   * thinking, and treating that as a complete answer is what let a half-given
   * answer be scored and the interview move on.
   */
  function answerCompleteness(text: string): { complete: boolean; reason: AnswerCycle["completionReason"] } {
    const clean = text.trim().toLowerCase();
    if (!clean) return { complete: false, reason: "" };
    if (DONE_SIGNALS.some((signal) => clean.endsWith(signal) || clean.includes(`${signal}.`))) {
      return { complete: true, reason: "explicit_candidate_completion" };
    }
    const words = clean.replace(/[.,!?;:]+$/g, "").split(/\s+/).filter(Boolean);
    const last = words[words.length - 1] ?? "";
    /* Ends on a connector, a preposition or a filler: they are mid-sentence. */
    if (TRAILING_WORDS.has(last)) return { complete: false, reason: "" };
    /* A couple of words with no terminal punctuation is a false start, not an
       answer — "I mainly worked", "so in my". */
    if (words.length < 4 && !/[.!?]$/.test(clean)) return { complete: false, reason: "" };
    return { complete: true, reason: "semantic_complete" };
  }

  /** Closes the current answer cycle and files it with the reason it ended. */
  function completeAnswer(reason: AnswerCycle["completionReason"], transcript: string) {
    if (continuationTimer.current) {
      window.clearTimeout(continuationTimer.current);
      continuationTimer.current = null;
    }
    const cycle = answerCycle.current;
    if (cycle) {
      cycle.answerCompletedAt = Date.now();
      cycle.completionReason = reason;
      cycle.transcript = transcript;
      answerLog.current.push(cycle);
      /* The question on the floor now counts as ANSWERED, which is a different
         thing from asked and is what the closing gates read. */
      if (cycle.questionIndex >= 0) answeredRef.current.add(cycle.questionIndex);
      answerCycle.current = null;
    }
    setAnswerState("answer_complete", reason);
    /* The next question is owed from here on, so the room stops treating this
       answer as live and waits for the interviewer's next turn. */
    setAnswerState("waiting_for_answer", "next question owed");
  }

  /**
   * Judges the candidate's finished utterance and either lets the turn stand or
   * holds the answer open. An unfinished thought gets a real wait and then one
   * gentle check-in — never the next question, which is how the rest of an
   * answer used to be lost.
   */
  function assessAnswer(text: string) {
    if (openingStage.current !== "interviewing") return;
    const cycle = answerCycle.current;
    if (cycle) {
      cycle.speechStoppedAt = Date.now();
      cycle.possibleAnswerEndAt = Date.now();
      cycle.transcript = cycle.transcript ? `${cycle.transcript} ${text}`.trim() : text;
    }
    setAnswerState("possible_answer_end", text.slice(-60));
    const verdict = answerCompleteness(cycle?.transcript ?? text);
    if (verdict.complete) {
      completeAnswer(verdict.reason, cycle?.transcript ?? text);
      return;
    }
    /* Mid-thought. Hold the answer open and let them come back to it. */
    setAnswerState("waiting_for_continuation", "answer ended mid-thought");
    if (continuationTimer.current) window.clearTimeout(continuationTimer.current);
    continuationTimer.current = window.setTimeout(() => {
      continuationTimer.current = null;
      if (endingRef.current || phaseRef.current !== "live") return;
      if (answerState.current !== "waiting_for_continuation") return;
      if (userSpeaking.current) return;
      const quiet = Date.now() - lastSpeechAt.current;
      if (quiet < CONTINUATION_WAIT_MS) return;
      const open = answerCycle.current;
      if (quiet >= CONTINUATION_CHECK_IN_MS && open && open.checkIns < 1) {
        /* They trailed off and nothing came back. One gentle check-in, never a
           new question. */
        open.checkIns += 1;
        speakIfSilent("Take your time — would you like to carry on?");
        return;
      }
      completeAnswer("continuation_timeout", open?.transcript ?? text);
    }, CONTINUATION_CHECK_IN_MS);
  }

  /**
   * The one authoritative way this interview finishes. The interviewer may only
   * REQUEST an ending; a short answer, an "I don't know", a pause or a model that
   * simply feels done must never close a sitting with questions left in it.
   */
  function requestCompletion(source: string) {
    const remaining = questionsRef.current.length - askedRef.current.size;
    /* Asked but not answered is not finished. The last question is the one this
       matters for: the interviewer asks it, the candidate takes a moment to
       think, and the model treats its own question as the end of the interview.
       That is exactly what happened on the real sitting this gate was written
       for — the closing words landed on top of the answer. */
    const unanswered = askedRef.current.size - answeredRef.current.size;
    const answerInFlight =
      answerState.current === "candidate_speaking" ||
      answerState.current === "waiting_for_continuation" ||
      answerState.current === "possible_answer_end";
    const candidateWantsOut = stopRequested.current;
    const roomForcedIt = wrapUpSent.current || forcedCloseSent.current;
    const blocked =
      (remaining > 0 || unanswered > 0 || answerInFlight) && !candidateWantsOut && !roomForcedIt;
    // eslint-disable-next-line no-console
    console.info("[interview:completion]", {
      source,
      remaining,
      asked: askedRef.current.size,
      total: questionsRef.current.length,
      answerState: answerState.current,
      candidateWantsOut,
      roomForcedIt,
      decision: blocked ? "refused" : "accepted",
      at: new Date().toISOString(),
    });
    if (blocked) {
      /* Refused. The interviewer is put straight back on the next unasked
         question rather than left to argue about it. */
      const next = questionsRef.current.findIndex((_, index) => !askedRef.current.has(index));
      const question = next === -1 ? "" : questionsRef.current[next];
      proctor.mutate({
        token,
        kind: "premature_close_blocked",
        detail: `Interviewer tried to end with ${remaining} question(s) unasked (${source})`,
        awaySeconds: 0,
        flags: [],
      });
      const channel = dc.current;
      if (channel && channel.readyState === "open") {
        channel.send(
          JSON.stringify({
            type: "response.create",
            response: {
              instructions: question
                ? `The interview is NOT finished — ${remaining} question${remaining === 1 ? "" : "s"} remain in your set, so the request to end has been refused. Do not close the call, do not mention this and do not say goodbye. Ask this question now, word for word, with no preamble: "${question}"`
                : "The interview is not finished. Do not close the call and do not say goodbye — continue with the question you were on.",
            },
          }),
        );
      }
      return;
    }
    if (!completionRequested.current) completionRequested.current = Date.now();
  }

  /**
   * Marks off any question from the set that this utterance just asked. Coverage
   * is what lets the room end the interview on its own once the set is done,
   * instead of leaving the candidate to hang up.
   */
  function noteCoverage(spoken: string) {
    if (!spoken.trim() || questionsRef.current.length === 0) return;
    /* Nothing said before the interview proper counts — the greeting, the audio
       check and the two warm-up questions all end in "?" and must never tick a
       question off the set. */
    if (openingStage.current !== "interviewing") return;
    /* Only the NEXT unasked question can be credited, only from an utterance
       that actually contains a question, and only one per utterance.
       Previously every question was scored against every utterance, so a
       follow-up or a re-ask that happened to share words with questions further
       down the list ticked them off without ever asking them. The set then
       looked "covered" mid-interview and the room forced the call closed — this
       is the interview cutting out on the candidate. */
    if (!spoken.includes("?")) return;
    const next = questionsRef.current.findIndex((_, index) => !askedRef.current.has(index));
    if (next === -1) return;
    if (!looksLikeQuestion(questionsRef.current[next]!, spoken)) return;
    askedRef.current.add(next);
    if (askedRef.current.size >= questionsRef.current.length && !coveredAt.current) {
      coveredAt.current = Date.now();
    }
  }

  /**
   * Rebuilds a dropped voice connection without ending the interview. The camera,
   * microphone, recording and clock are all deliberately left running — only the
   * peer connection and its data channel are replaced, and the transcript so far
   * is replayed so the interviewer carries on rather than starting again.
   */
  async function recoverConnection() {
    if (endingRef.current || phaseRef.current !== "live") {
      reconnecting.current = false;
      return;
    }
    if (pc.current?.connectionState === "connected") {
      reconnecting.current = false;
      return;
    }
    if (reconnectTries.current >= MAX_RECONNECT_TRIES) {
      /* Out of attempts. Close the interview properly and keep everything said
         so far, rather than leaving the candidate in a dead room. */
      reportError.mutate({ token, scope: "voice_connection", message: "Media connection lost and could not be restored" });
      void endRef.current({ reason: "Voice connection lost and could not be restored — interview closed early" });
      return;
    }
    reconnectTries.current += 1;
    setWarning("Your connection dropped — reconnecting. Please stay on this page.");
    try {
      /* Only the transport goes. Media and recording must survive. */
      dc.current?.close();
      pc.current?.close();
      dc.current = null;
      pc.current = null;
      await connectVoice(turnsRef.current);
      setWarning(null);
      reconnecting.current = false;
    } catch {
      reconnecting.current = false;
      window.setTimeout(() => {
        if (pc.current?.connectionState === "connected") return;
        reconnecting.current = true;
        void recoverConnection();
      }, 3000);
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
    /* A reconnect must never restart the recorder — that would throw away
       everything recorded before the connection dropped. */
    if (!recorder.current) startRecording(media);

    const peer = new RTCPeerConnection();
    pc.current = peer;

    /* A dropped media connection used to be completely unhandled: the browser
       tore the call down, the interviewer went silent, and the candidate sat in
       a dead room until a timer terminated the sitting. Wi-Fi hiccups and
       network hand-offs are routine, so a drop now reconnects and resumes from
       the transcript instead of ending the interview. */
    peer.onconnectionstatechange = () => {
      if (peer !== pc.current) return;
      const state = peer.connectionState;
      if (state === "connected") {
        reconnectTries.current = 0;
        reconnecting.current = false;
        return;
      }
      if (state !== "failed" && state !== "disconnected" && state !== "closed") return;
      if (endingRef.current || completionRequested.current || reconnecting.current) return;
      reconnecting.current = true;
      /* `disconnected` is often transient — give ICE a moment to recover on its
         own before throwing the connection away and building a new one. */
      window.setTimeout(() => void recoverConnection(), state === "disconnected" ? 4000 : 500);
    };

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
          /* A request, never a decision. `requestCompletion` refuses it while
             questions remain and puts the interviewer back on the next one. */
          requestCompletion("model_tool_call");
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
          /* Speech during a held-open answer is the rest of that answer, not a
             new one — the cycle carries on and its watchdog is stood down. */
          if (openingStage.current === "interviewing") {
            if (continuationTimer.current) {
              window.clearTimeout(continuationTimer.current);
              continuationTimer.current = null;
            }
            if (!answerCycle.current) beginAnswerCycle();
            setAnswerState("candidate_speaking");
          }
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
          if (text) {
            lastCandidateText.current = text;
            const lowered = text.toLowerCase();
            /* A candidate who asks to stop is always let out — this is the one
               thing that may end a sitting with questions left in it. */
            if (STOP_SIGNALS.some((signal) => lowered.includes(signal))) {
              stopRequested.current = true;
            }
          }
          /* Still on the opening handshake: this reply decides whether the
             interview starts or the candidate is asked to fix their audio. */
          if (text && openingStage.current === "audio_check") handleAudioCheckReply(text);
          /* Warm-up: their answer is the cue for the next warm-up turn, and
             then for the interview itself. */
          else if (text && openingStage.current !== "interviewing") handleWarmUpReply();
          /* Interview proper: decide whether that was a finished thought or a
             pause mid-answer, rather than letting silence decide it. */
          else if (text) assessAnswer(text);
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
        /* A rejoin resumes an interview that already started — no greeting and
           no audio check, the candidate has already been through both. */
        openingStage.current = "interviewing";
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
      /* The interviewer speaks first, and says only the scripted greeting. The
         interview itself does not begin until the candidate has confirmed they
         can hear it — see `handleAudioCheckReply`. */
      openingStage.current = "audio_check";
      audioCheckTries.current = 0;
      speakExactly(greetingLine());
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
