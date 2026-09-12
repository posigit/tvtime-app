import Link from "next/link";

/** Unknown routes / bad list kinds land here instead of a blank 404. */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-black px-6 text-center">
      <p className="text-lg font-black text-white">Nothing here</p>
      <p className="max-w-xs text-sm text-white/50">
        This page doesn&apos;t exist or was moved.
      </p>
      <Link
        href="/shows"
        className="mt-2 rounded-full bg-primary px-6 py-3 text-sm font-black uppercase tracking-wide text-black transition active:scale-95"
      >
        Back to shows
      </Link>
    </div>
  );
}
