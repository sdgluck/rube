import useRelativeTime from "./useRelativeTime";

interface RelativeTimeProps {
  timestamp: number;
  seconds?: boolean;
}

export default function RelativeTime({ timestamp, seconds }: RelativeTimeProps) {
  const tsMs = seconds ? timestamp * 1000 : timestamp;
  const relative = useRelativeTime(tsMs);
  const absolute = new Date(tsMs).toLocaleString();

  return (
    <time dateTime={new Date(tsMs).toISOString()} title={absolute}>
      {relative}
    </time>
  );
}
