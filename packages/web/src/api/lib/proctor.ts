import { z } from "zod";
import { generateObject } from "ai";
import dedent from "dedent";
import { gateway, PARSE_MODEL } from "../agent/gateway";

/**
 * Vision-based interview proctoring. A still frame from the candidate's webcam
 * is checked for the integrity signals a human invigilator would look for:
 * is the candidate there, are they looking at the camera, are they reading from
 * something, is anyone else present, are they wearing headphones.
 *
 * Everything is advisory — it produces warnings and evidence, never a verdict.
 */

export const FRAUD_FLAGS = [
  "no_face",
  "multiple_faces",
  "looking_away",
  "reading",
  "headphones",
  "phone_visible",
  "screen_reflection",
] as const;

export type FraudFlag = (typeof FRAUD_FLAGS)[number];

export const FLAG_WARNING: Record<FraudFlag, string> = {
  no_face: "We can't see you on camera. Please sit in front of the camera so your face is visible.",
  multiple_faces:
    "Someone else appears to be in frame. This interview must be completed by you alone.",
  looking_away: "Please look at the camera and stay focused on the interview.",
  reading:
    "It looks like you're reading from something. Please answer in your own words, looking at the camera.",
  headphones:
    "Please remove your headphones or earphones and use your device speakers for this interview.",
  phone_visible: "Please put your phone away for the duration of the interview.",
  screen_reflection: "Please close any other screens or windows you're referring to.",
};

/** Positive behavioural signals — the opposite of a fraud flag. */
export const POSITIVE_SIGNALS = ["strong_eye_contact"] as const;
export type PositiveSignal = (typeof POSITIVE_SIGNALS)[number];

const frameSchema = z.object({
  faceCount: z.number().min(0).max(6).describe("How many human faces are visible"),
  lookingAtCamera: z.boolean().describe("Is the main subject looking at or near the camera"),
  eyeContact: z
    .enum(["direct", "partial", "away", "unclear"])
    .describe(
      "Gaze quality: 'direct' = eyes squarely on the camera/screen, 'partial' = generally forward but drifting, 'away' = looking elsewhere, 'unclear' = cannot tell",
    ),
  reading: z
    .boolean()
    .describe("Do the eyes/head suggest they are reading text off-screen or off a page"),
  headphones: z.boolean().describe("Are headphones, earphones or earbuds visible"),
  phoneVisible: z.boolean().describe("Is a mobile phone visible in frame or in hand"),
  confidence: z.number().min(0).max(1).describe("How confident you are in this reading"),
  note: z.string().max(200).describe("One short factual observation about the frame"),
});

export interface ProctorReading {
  flags: FraudFlag[];
  positives: PositiveSignal[];
  note: string;
  confidence: number;
}

/**
 * Inspects one webcam frame. `frame` is a data URL (`data:image/jpeg;base64,...`).
 * Returns an empty flag list when the model is unavailable or unsure — never a
 * false accusation.
 */
export async function inspectFrame(frame: string): Promise<ProctorReading> {
  const base64 = frame.includes(",") ? frame.slice(frame.indexOf(",") + 1) : frame;
  try {
    const { object } = await generateObject({
      model: gateway(PARSE_MODEL),
      schema: frameSchema,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: dedent`
                You are invigilating a remote job interview. Look at this webcam frame and
                report only what you can actually see. Be conservative: if the image is dark,
                blurred or ambiguous, lower your confidence rather than guessing.

                Report the number of visible human faces, whether the main subject is looking
                at the camera, how strong their eye contact is, whether their gaze/posture
                suggests they are reading text somewhere off camera, whether headphones or
                earphones are visible, and whether a mobile phone is visible.
              `,
            },
            { type: "image", image: base64, mediaType: "image/jpeg" },
          ],
        },
      ],
    });

    const flags: FraudFlag[] = [];
    const positives: PositiveSignal[] = [];
    /* Held eye contact reads as confidence, but only on a clear frame of one
       person who is plainly not reading off-screen. */
    if (
      object.confidence >= 0.6 &&
      object.faceCount === 1 &&
      object.eyeContact === "direct" &&
      object.lookingAtCamera &&
      !object.reading
    ) {
      positives.push("strong_eye_contact");
    }
    if (object.confidence >= 0.45) {
      if (object.faceCount === 0) flags.push("no_face");
      if (object.faceCount > 1) flags.push("multiple_faces");
      if (object.faceCount === 1 && !object.lookingAtCamera) flags.push("looking_away");
      if (object.reading) flags.push("reading");
      if (object.headphones) flags.push("headphones");
      if (object.phoneVisible) flags.push("phone_visible");
    }
    return { flags, positives, note: object.note, confidence: object.confidence };
  } catch {
    return { flags: [], positives: [], note: "", confidence: 0 };
  }
}

/** Human-readable integrity summary appended to the interview report. */
export function summariseProctoring(input: {
  focusLossCount: number;
  awaySeconds: number;
  timePenaltySeconds: number;
  fraudFlags: string[];
  positiveSignals?: string[];
  resumeCount?: number;
}): string {
  const lines: string[] = [];
  if (input.focusLossCount > 0) {
    lines.push(
      `Left the interview screen ${input.focusLossCount} time(s) for a total of ${input.awaySeconds}s (${input.timePenaltySeconds}s deducted from the interview time).`,
    );
  } else {
    lines.push("Stayed on the interview screen throughout.");
  }
  const unique = [...new Set(input.fraudFlags)];
  if (unique.length) {
    lines.push(
      `Camera integrity signals raised: ${unique
        .map((f) => f.replace(/_/g, " "))
        .join(", ")}. Treat as advisory and confirm in the technical round.`,
    );
  } else {
    lines.push("No camera integrity signals were raised.");
  }
  if (input.resumeCount) {
    lines.push(
      `The candidate rejoined the interview ${input.resumeCount} time(s) after losing the page; that time was counted as time away.`,
    );
  }
  if (input.positiveSignals?.includes("strong_eye_contact")) {
    lines.push(
      "Held direct eye contact with the camera throughout — presented as a very confident candidate.",
    );
  }
  return lines.join(" ");
}
