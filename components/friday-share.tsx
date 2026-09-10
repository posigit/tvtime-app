"use client";

import { useMemo, useState } from "react";
import { Share2, Download, Copy, X } from "lucide-react";
import { posterUrl } from "@/lib/tmdb";
import { StarRatingDisplay } from "@/components/star-rating";
import { useToast } from "@/components/toast";

export type FridayShareItem = {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  rating?: number | null;
  favorite?: boolean | null;
  rewatchCount?: number | null;
  year?: string | null;
};

function starsText(rating: number | null | undefined): string {
  if (rating == null) return "○ unrated";
  return `★ ${(rating / 2).toFixed(1)}`;
}

function shareListText(items: FridayShareItem[]): string {
  const lines = items.slice(0, 4).map((m, i) => {
    const bits: string[] = [];
    if (m.year) bits.push(`(${m.year})`);
    const star = m.rating != null ? `★${(m.rating / 2).toFixed(1)}` : "unrated";
    const extra = [
      m.favorite ? "♥" : null,
      m.rewatchCount != null && m.rewatchCount >= 2
        ? `⟳×${m.rewatchCount}`
        : null,
    ]
      .filter(Boolean)
      .join(" ");
    return `${i + 1}. ${m.title} ${bits.join(" ")} — ${star}${extra ? ` ${extra}` : ""}`;
  });
  return `My last 4 watched 🎬\n${lines.join("\n")}`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("img"));
    img.src = src;
  });
}

/** Renders a 1080×1350 IG-portrait card to canvas. No deps, TMDB CORS-safe. */
async function renderShareCanvas(
  items: FridayShareItem[]
): Promise<HTMLCanvasElement> {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");

  // Background
  ctx.fillStyle = "#0b0b0c";
  ctx.fillRect(0, 0, W, H);
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "rgba(245,197,24,0.10)");
  grad.addColorStop(0.35, "rgba(245,197,24,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = "#f5c518";
  ctx.font = "900 34px system-ui, -apple-system, sans-serif";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("FRIDAY · LAST 4 WATCHED", 64, 110);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "600 30px system-ui, -apple-system, sans-serif";
  const date = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  ctx.fillText(date, 64, 152);

  // Grid
  const pad = 64;
  const gap = 32;
  const cellW = (W - pad * 2 - gap) / 2;
  const posterH = Math.round(cellW * 1.5);
  const capH = 118;
  const cellH = posterH + capH;
  const startY = 196;
  const four = items.slice(0, 4);

  const drawPlaceholder = (
    x: number,
    y: number,
    w: number,
    h: number,
    title: string
  ) => {
    ctx.save();
    roundRect(ctx, x, y, w, h, 28);
    ctx.fillStyle = "#1c1c1e";
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "700 30px system-ui, sans-serif";
    ctx.textAlign = "center";
    const words = title.split(" ").slice(0, 4).join(" ");
    ctx.fillText(words || "No poster", x + w / 2, y + h / 2, w - 40);
    ctx.restore();
    ctx.textAlign = "left";
  };

  for (let i = 0; i < four.length; i++) {
    const m = four[i];
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = pad + col * (cellW + gap);
    const y = startY + row * (cellH + gap);

    const src = m.posterPath ? posterUrl(m.posterPath, "w500") : null;
    let img: HTMLImageElement | null = null;
    if (src) {
      try {
        img = await loadImage(src);
      } catch {
        img = null;
      }
    }
    if (img) {
      ctx.save();
      roundRect(ctx, x, y, cellW, posterH, 28);
      ctx.clip();
      // cover-fit
      const scale = Math.max(cellW / img.width, posterH / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, x + (cellW - dw) / 2, y + (posterH - dh) / 2, dw, dh);
      ctx.restore();
      // subtle ring
      ctx.save();
      roundRect(ctx, x, y, cellW, posterH, 28);
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    } else {
      drawPlaceholder(x, y, cellW, posterH, m.title);
    }

    // Favorite heart (top-right, leaking look approximated on canvas)
    if (m.favorite) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + cellW - 34, y + 34, 30, 0, Math.PI * 2);
      ctx.fillStyle = "#e0202e";
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = "#0b0b0c";
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "900 30px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("♥", x + cellW - 34, y + 45);
      ctx.restore();
      ctx.textAlign = "left";
    }
    // Rewatch pill
    if (m.rewatchCount != null && m.rewatchCount >= 2) {
      const label = `⟳ ×${m.rewatchCount}`;
      ctx.save();
      ctx.font = "900 26px system-ui, sans-serif";
      const tw = ctx.measureText(label).width + 32;
      roundRect(ctx, x + cellW - tw - 16, y + posterH - 52, tw, 40, 12);
      ctx.fillStyle = "rgba(0,0,0,0.78)";
      ctx.fill();
      ctx.fillStyle = "#7ed321";
      ctx.fillText(label, x + cellW - tw, y + posterH - 23);
      ctx.restore();
    }

    // Caption
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 32px system-ui, -apple-system, sans-serif";
    const title = m.title.length > 26 ? `${m.title.slice(0, 25)}…` : m.title;
    ctx.fillText(title, x + 4, y + posterH + 44, cellW - 8);
    ctx.fillStyle = "#f5c518";
    ctx.font = "700 28px system-ui, sans-serif";
    const sub = [
      m.year ?? null,
      starsText(m.rating),
      m.favorite ? "♥" : null,
    ]
      .filter(Boolean)
      .join("  ·  ");
    ctx.fillText(sub, x + 4, y + posterH + 84, cellW - 8);
  }

  // Footer
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = "600 26px system-ui, sans-serif";
  ctx.fillText("my watchlist · friday drop", 64, H - 56);
  ctx.fillStyle = "#f5c518";
  ctx.font = "900 26px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("★ rated by me", W - 64, H - 56);
  ctx.textAlign = "left";

  return canvas;
}

/** Small icon button + bottom-sheet preview. Drop into any rail header. */
export function FridayShareButton({ items }: { items: FridayShareItem[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const four = useMemo(() => items.slice(0, 4), [items]);

  if (four.length === 0) return null;

  const download = async () => {
    setBusy(true);
    try {
      const canvas = await renderShareCanvas(four);
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, "image/png")
      );
      if (!blob) throw new Error("encode failed");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `friday-last-4-${new Date().toISOString().slice(0, 10)}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      // Offer native share sheet when available (IG/X/WhatsApp).
      try {
        const file = new File([blob], "friday-last-4.png", {
          type: "image/png",
        });
        if (
          navigator.canShare?.({ files: [file] }) &&
          navigator.share
        ) {
          await navigator.share({ files: [file], title: "My last 4 watched" });
        }
      } catch {
        // User dismissed share sheet — download already happened.
      }
      toast("Friday card saved — post it!");
    } catch {
      toast("Couldn't build the image — try again", "error");
    } finally {
      setBusy(false);
    }
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(shareListText(four));
      toast("List copied — paste it anywhere");
    } catch {
      toast("Couldn't copy — try again", "error");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Share last 4 watched"
        title="Share last 4 watched"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.07] text-white/70 ring-1 ring-white/15 transition hover:bg-white/[0.12] hover:text-white"
      >
        <Share2 className="h-4 w-4" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-2xl bg-card p-5">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-base font-black text-white">
                Friday drop · last 4
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close share"
                className="flex h-8 w-8 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">
              Poster grid + your stars, ready for IG / X / WhatsApp.
            </p>
            {/* Live HTML preview (canvas export mirrors this layout) */}
            <div className="mb-4 rounded-xl bg-black p-3 ring-1 ring-white/10">
              <p className="mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-primary">
                Friday · Last 4 watched
              </p>
              <div className="grid grid-cols-2 gap-2">
                {four.map((m) => {
                  const src = m.posterPath
                    ? posterUrl(m.posterPath, "w342")
                    : null;
                  return (
                    <div key={m.tmdbId} className="min-w-0">
                      <div className="relative overflow-visible">
                        <div className="relative overflow-hidden rounded-lg bg-secondary">
                          {src ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={src}
                              alt={m.title}
                              className="aspect-[2/3] w-full object-cover"
                              loading="lazy"
                              crossOrigin="anonymous"
                            />
                          ) : (
                            <div className="flex aspect-[2/3] w-full items-center justify-center p-2 text-center text-[10px] text-muted-foreground">
                              {m.title}
                            </div>
                          )}
                          {m.rewatchCount != null && m.rewatchCount >= 2 && (
                            <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1.5 py-0.5 text-[9px] font-black text-success">
                              ⟳ ×{m.rewatchCount}
                            </span>
                          )}
                        </div>
                        {m.favorite && (
                          <span className="absolute -right-1.5 -top-1.5 flex h-6 w-6 rotate-12 items-center justify-center rounded-full bg-[#e0202e] text-[11px] text-white ring-2 ring-black">
                            ♥
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-[11px] font-bold text-white">
                        {m.title}
                      </p>
                      {m.rating != null ? (
                        <StarRatingDisplay value={m.rating} size={10} />
                      ) : (
                        <p className="text-[10px] text-muted-foreground">
                          unrated
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={download}
                disabled={busy}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-primary py-3 text-sm font-black text-black disabled:opacity-50"
              >
                <Download className="h-4 w-4" strokeWidth={2.5} />
                {busy ? "Building…" : "Save image"}
              </button>
              <button
                type="button"
                onClick={copyText}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-white/20 py-3 text-sm font-bold text-white"
              >
                <Copy className="h-4 w-4" />
                Copy list
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
