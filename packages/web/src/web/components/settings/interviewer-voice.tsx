import { useRef, useState } from "react";
import { Loader2, Volume2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { AI_VOICES, DEFAULT_AI_VOICE } from "../../../api/lib/voices";

const GENDER_LABEL: Record<string, string> = { male: "Male", female: "Female", neutral: "Neutral" };

/**
 * Interviewer voice picker. The voice is the first thing a candidate judges the
 * agency on, so it is chosen by ear here rather than guessed from a voice id.
 */
export function InterviewerVoiceCard({
  canEdit,
  value,
  onChange,
}: {
  canEdit: boolean;
  value: string;
  onChange: (voice: string) => void;
}) {
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const selected = value || DEFAULT_AI_VOICE;

  async function preview(voice: string) {
    setError(null);
    audio.current?.pause();
    setPlaying(voice);
    try {
      const res = await fetch(`/api/ai-interview/voice-preview?voice=${encodeURIComponent(voice)}`);
      if (!res.ok) throw new Error("Preview unavailable right now.");
      const url = URL.createObjectURL(await res.blob());
      const el = new Audio(url);
      audio.current = el;
      el.onended = () => {
        setPlaying(null);
        URL.revokeObjectURL(url);
      };
      await el.play();
    } catch (e) {
      setPlaying(null);
      setError((e as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Interviewer voice</CardTitle>
          <p className="text-[12px] text-muted-foreground">
            The voice every candidate hears in the AI interview. Preview one before you save it — Cedar is the most
            natural male voice.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {AI_VOICES.map((voice) => {
          const active = voice.id === selected;
          return (
            <div
              key={voice.id}
              className={`flex items-center gap-3 rounded-lg border p-3 transition ${
                active ? "border-primary/60 bg-primary/5" : "border-border/60 hover:border-border"
              }`}
            >
              <input
                type="radio"
                name="ai-voice"
                className="size-4 accent-[var(--primary)]"
                checked={active}
                disabled={!canEdit}
                onChange={() => onChange(voice.id)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium">{voice.label}</span>
                  <Badge variant={voice.gender === "male" ? "default" : "outline"}>
                    {GENDER_LABEL[voice.gender]}
                  </Badge>
                  {voice.id === DEFAULT_AI_VOICE && <Badge variant="outline">Recommended</Badge>}
                </div>
                <p className="truncate text-[12px] text-muted-foreground">{voice.description}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => void preview(voice.id)} disabled={playing === voice.id}>
                {playing === voice.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Volume2 className="size-4" />
                )}
                Preview
              </Button>
            </div>
          );
        })}
        {error && <p className="text-[12px] text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
