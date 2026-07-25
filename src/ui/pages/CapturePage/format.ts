/** Display helpers shared by the capture list, timeline, and flow table. */

/** Wireshark-style relative time: seconds with microsecond precision. */
export function formatRelativeTime(usec: number): string {
  return (usec / 1_000_000).toFixed(6);
}

/** Compact duration for flow rows: µs, ms, or s depending on magnitude. */
export function formatDuration(usec: number): string {
  if (usec === 0) return '—';
  if (usec < 1_000) return `${usec} µs`;
  if (usec < 1_000_000) return `${(usec / 1_000).toFixed(1)} ms`;
  return `${(usec / 1_000_000).toFixed(3)} s`;
}

export function formatByteCount(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
