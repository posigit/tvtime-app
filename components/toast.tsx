"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

export type ToastType = "success" | "error" | "info";

type ToastItem = {
  id: number;
  message: string;
  type: ToastType;
};

type ToastContextValue = {
  toast: (message: string, type?: ToastType) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let idSeq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = "success") => {
      const id = ++idSeq;
      setToasts((prev) => [...prev.slice(-2), { id, message, type }]);
      window.setTimeout(() => dismiss(id), 2800);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))]"
        aria-live="polite"
        aria-relevant="additions"
      >
        {toasts.map((t) => (
          <ToastPill key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastPill({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const enter = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(enter);
  }, []);

  return (
    <button
      type="button"
      onClick={onDismiss}
      className={cn(
        "pointer-events-auto max-w-sm rounded-2xl px-4 py-3 text-sm font-semibold shadow-lg backdrop-blur-md transition-all duration-200",
        "border border-white/10",
        visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
        item.type === "error"
          ? "bg-[#3a1515]/95 text-[#ff8a80]"
          : item.type === "info"
            ? "bg-[#1c1c1e]/95 text-white"
            : "bg-[#1c1c1e]/95 text-white"
      )}
    >
      {item.type === "success" && (
        <span className="mr-1.5 text-primary" aria-hidden>
          ✓
        </span>
      )}
      {item.type === "error" && (
        <span className="mr-1.5" aria-hidden>
          !
        </span>
      )}
      {item.message}
    </button>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      toast: () => {
        /* no-op outside provider */
      },
    };
  }
  return ctx;
}

/** S02 | E05 style label for episode toasts */
export function formatEpisodeLabel(seasonNumber: number, episodeNumber: number) {
  return `S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
}
