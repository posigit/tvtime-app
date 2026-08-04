export function formatPlaybackTime(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${total}m`;
}

export function formatEpisodeCode(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")} E${String(episode).padStart(2, "0")}`;
}
