"use client";

import { useMemo } from "react";

/**
 * Per-user profile picture.
 *
 * - photo (admin only): the branded /avatars/profile.jpg image.
 * - everyone else: an initials disc, tinted deterministically from the
 *   username so it stays stable across sessions/devices without a DB row.
 */
export function UserAvatar({
  name,
  photo,
  className,
}: {
  name: string;
  photo?: string | null;
  className?: string;
}) {
  const { initial, tint } = useMemo(() => {
    const clean = (name || "?").trim();
    const first = clean.charAt(0).toUpperCase() || "?";
    // Stable hash -> hue so an avatar never jumps color between reloads.
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash * 31 + name.charCodeAt(i)) | 0;
    }
    const hue = Math.abs(hash) % 360;
    return { initial: first, tint: `hsl(${hue} 55% 45%)` };
  }, [name]);

  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element -- local avatar; circle crop + SW cache-first
    return <img src={photo} alt={name} className={className} loading="eager" decoding="async" />;
  }

  return (
    <div
      aria-label={name}
      className={`flex items-center justify-center ${className ?? ""}`}
      style={{ backgroundColor: tint }}
    >
      <span className="text-3xl font-bold text-white">{initial}</span>
    </div>
  );
}