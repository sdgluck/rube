import { useState, useEffect } from "react";

function compute(ts: number): string {
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
  const [text, setText] = useState(() => compute(tsMs));

  useEffect(() => {
    setText(compute(tsMs));
    const id = setInterval(() => setText(compute(tsMs)), 30000);
    return () => clearInterval(id);
  }, [tsMs]);

  return text;
}
