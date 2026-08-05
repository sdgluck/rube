import { useMemo } from "react";
import { CHANGELOG, VERSION, IS_BETA } from "#/version";
import PageShell, { StatusChip } from "#components/PageShell";
import styles from "./Changelog.module.css";

type Block =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] };

function escape(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderInline(s: string): string {
  let out = escape(s);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
    const safe = /^https?:\/\//.test(href) ? href : "#";
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  return out;
}

function parse(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) {
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push({ kind: "h1", text: line.slice(2).trim() });
      i++;
    } else if (line.startsWith("## ")) {
      blocks.push({ kind: "h2", text: line.slice(3).trim() });
      i++;
    } else if (line.startsWith("### ")) {
      blocks.push({ kind: "h3", text: line.slice(4).trim() });
      i++;
    } else if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("- ")) {
        items.push(lines[i]!.slice(2).trim());
        i++;
      }
      blocks.push({ kind: "ul", items });
    } else if (line.trim() === "") {
      i++;
    } else {
      const buf: string[] = [line];
      i++;
      while (i < lines.length && lines[i]!.trim() !== "" && !/^(#|-)/.test(lines[i]!)) {
        buf.push(lines[i]!);
        i++;
      }
      blocks.push({ kind: "p", text: buf.join(" ") });
    }
  }
  return blocks;
}

type Release = { version: string; date: string | null; body: Block[] };

/** `[0.6.1] - 2026-08-04` → version and date, each rendered in its own slot. */
function splitHeading(text: string): { version: string; date: string | null } {
  const m = /^\[?([^\]\s]+)\]?(?:\s*[-–]\s*(.+))?$/.exec(text.trim());
  if (!m) return { version: text, date: null };
  return { version: m[1], date: m[2]?.trim() ?? null };
}

/** One card per release: group the flat block list at each `##`. */
function toReleases(blocks: Block[]): Release[] {
  const releases: Release[] = [];
  for (const b of blocks) {
    if (b.kind === "h1") continue;
    if (b.kind === "h2") {
      releases.push({ ...splitHeading(b.text), body: [] });
    } else if (releases.length > 0) {
      releases[releases.length - 1].body.push(b);
    }
  }
  return releases;
}

const TAG_TONE: Record<string, string> = {
  added: styles.tagAdded,
  changed: styles.tagChanged,
  fixed: styles.tagFixed,
  removed: styles.tagRemoved,
};

export default function Changelog() {
  const releases = useMemo(() => {
    const all = parse(CHANGELOG);
    const start = all.findIndex((b) => b.kind === "h2" && b.text !== "[Unreleased]");
    return start === -1 ? [] : toReleases(all.slice(start));
  }, []);

  return (
    <PageShell
      title="Changelog"
      count={`v${VERSION}`}
      chip={IS_BETA ? <StatusChip tone="advisory">Beta</StatusChip> : undefined}
      subtitle="What changed in each release, newest first."
    >
      <div className={styles.releases}>
        {releases.map((release) => (
          <article key={release.version} className={styles.release}>
            <header className={styles.releaseHeader}>
              <h2 className={styles.releaseVersion}>{release.version}</h2>
              {release.version === VERSION && <StatusChip tone="ok">Running</StatusChip>}
              <span className={styles.releaseSpacer} />
              {release.date && <span className={styles.releaseDate}>{release.date}</span>}
            </header>
            <div className={styles.entry}>
              {release.body.map((b, idx) => {
                switch (b.kind) {
                  case "h1":
                  case "h2":
                    return null;
                  case "h3": {
                    const tone = TAG_TONE[b.text.trim().toLowerCase()];
                    return (
                      <h3 key={idx} className={styles.sectionHeading}>
                        <span className={`${styles.tag} ${tone ?? styles.tagNeutral}`}>{b.text}</span>
                      </h3>
                    );
                  }
                  case "p":
                    return <p key={idx} dangerouslySetInnerHTML={{ __html: renderInline(b.text) }} />;
                  case "ul":
                    return (
                      <ul key={idx}>
                        {b.items.map((item, j) => (
                          <li key={j} dangerouslySetInnerHTML={{ __html: renderInline(item) }} />
                        ))}
                      </ul>
                    );
                }
              })}
            </div>
          </article>
        ))}
      </div>
    </PageShell>
  );
}
