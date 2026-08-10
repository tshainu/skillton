import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "./modal";
import { Button } from "./button";

/* ------------------------------------------------------------------ types */

export type ToastTone = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

interface FeedbackApi {
  toast: (input: { tone?: ToastTone; title: string; description?: string }) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

const TONE_STYLE: Record<ToastTone, { icon: typeof Info; className: string }> = {
  success: { icon: CheckCircle2, className: "text-emerald-400" },
  error: { icon: XCircle, className: "text-red-400" },
  warning: { icon: AlertTriangle, className: "text-amber-400" },
  info: { icon: Info, className: "text-primary-light" },
};

/* --------------------------------------------------------------- provider */

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<FeedbackApi["toast"]>(
    ({ tone = "info", title, description }) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, tone, title, description }]);
      window.setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4500);
    },
    [dismiss],
  );

  const confirm = useCallback<FeedbackApi["confirm"]>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setConfirmState({ ...options, resolve });
      }),
    [],
  );

  const api = useMemo<FeedbackApi>(() => ({ toast, confirm }), [toast, confirm]);

  const settle = (value: boolean) => {
    confirmState?.resolve(value);
    setConfirmState(null);
  };

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
          {toasts.map((item) => {
            const { icon: Icon, className } = TONE_STYLE[item.tone];
            return (
              <div
                key={item.id}
                className="glass pointer-events-auto flex items-start gap-3 rounded-xl border border-border px-4 py-3 shadow-2xl animate-in slide-in-from-right-4 fade-in duration-200"
              >
                <Icon className={cn("mt-0.5 size-4 shrink-0", className)} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold leading-snug">{item.title}</p>
                  {item.description && (
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                      {item.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => dismiss(item.id)}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
      <Modal
        open={Boolean(confirmState)}
        onClose={() => settle(false)}
        title={confirmState?.title ?? ""}
        description={confirmState?.description}
        width="max-w-md"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => settle(false)}>
              {confirmState?.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              size="sm"
              variant={confirmState?.tone === "danger" ? "destructive" : "default"}
              onClick={() => settle(true)}
            >
              {confirmState?.confirmLabel ?? "Confirm"}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-muted-foreground">
          {confirmState?.tone === "danger"
            ? "This action cannot be undone."
            : "Please confirm to continue."}
        </p>
      </Modal>
    </FeedbackContext.Provider>
  );
}

/* -------------------------------------------------------------- consumers */

function useFeedback(): FeedbackApi {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error("useFeedback must be used inside <FeedbackProvider>");
  return context;
}

/** `toast({ tone: "success", title: "Saved" })` */
export function useToast(): FeedbackApi["toast"] {
  return useFeedback().toast;
}

/** `if (await confirm({ title: "Delete?", tone: "danger" })) ...` */
export function useConfirm(): FeedbackApi["confirm"] {
  return useFeedback().confirm;
}
