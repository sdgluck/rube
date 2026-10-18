import { useState, useEffect } from "react";

/** "5m ago" — for strings that can't hold a ticking hook, like a `title`. */
export function formatRelativeTime(ts: number): string {
  const now = Date.now();
  const diffMs = now - ts;
  if (diffMs < 0) return "just now";

  const secs = Math.floor(diffMs / 1000);
  if (secs < 30) return "just now";
  if (secs < 60) return `${secs}s ago`;

  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

export default function useRelativeTime(tsMs: number): string {
  const [text, setText] = useState(() => formatRelativeTime(tsMs));

  useEffect(() => {
    setText(formatRelativeTime(tsMs));
    const id = setInterval(() => setText(formatRelativeTime(tsMs)), 30000);
    return () => clearInterval(id);
  }, [tsMs]);

  return text;
}
