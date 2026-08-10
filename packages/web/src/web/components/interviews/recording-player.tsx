import { useEffect, useState } from "react";
import { Download, Video } from "lucide-react";
import { client } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";

/**
 * Plays back the interview evidence file — the candidate's camera and microphone
 * recorded in one webm. The object is private, so a short-lived signed URL is
 * minted on demand rather than stored anywhere in the page.
 */
export function RecordingPlayer({
  storageKey,
  label = "Interview recording",
  hint,
}: {
  storageKey: string;
  label?: string;
  hint?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setError(null);
    client.upload
      .download({ key: storageKey })
      .then((res) => {
        if (cancelled) return;
        if (res.url) setUrl(res.url);
        else setError("This recording is not available to your account.");
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  return (
    <div className="print:hidden">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Video className="size-3.5" /> {label}
        </p>
        {url && (
          <a href={url} download>
            <Button size="sm" variant="ghost">
              <Download className="size-3.5" /> Download
            </Button>
          </a>
        )}
      </div>
      {!url && !error && (
        <div className="grid h-40 place-items-center rounded-lg border border-border bg-black/40">
          <Spinner className="size-5 text-primary" />
        </div>
      )}
      {error && (
        <p className="rounded-lg border border-border bg-black/30 p-3 text-[12.5px] text-muted-foreground">
          {error}
        </p>
      )}
      {url && (
        <video
          src={url}
          controls
          playsInline
          className="w-full rounded-lg border border-border bg-black"
          preload="metadata"
        />
      )}
      {hint && <p className="mt-1.5 text-[11.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
