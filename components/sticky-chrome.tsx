import { cn } from "@/lib/utils";

/**
 * Shared sticky app chrome for tab pages.
 * Solid black under the status bar so scrolled content never bleeds through.
 */
export function StickyChrome({
  children,
  className,
  contentClassName,
}: {
  children: React.ReactNode;
  className?: string;
  /** Inner padding under the safe-area top inset */
  contentClassName?: string;
}) {
  return (
    <div
      className={cn(
        "sticky top-0 z-20 border-b border-white/10 bg-black pb-1 pt-safe",
        className
      )}
    >
      <div className={cn(contentClassName)}>{children}</div>
    </div>
  );
}
