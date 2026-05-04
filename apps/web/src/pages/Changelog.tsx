import { useMemo } from "react";
import { CHANGELOG, VERSION, IS_BETA } from "../version";
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

export default function Changelog() {
  const blocks = useMemo(() => parse(CHANGELOG), []);

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>
        Changelog
        {IS_BETA && <span className="version-pill">beta</span>}
      </h2>
      <p className={styles.versionLine}>Currently running v{VERSION}</p>
      <div className={styles.entry}>
        {blocks.map((b, idx) => {
          switch (b.kind) {
            case "h1":
              return null;
            case "h2":
              return <h2 key={idx} dangerouslySetInnerHTML={{ __html: renderInline(b.text) }} />;
            case "h3":
              return <h3 key={idx} dangerouslySetInnerHTML={{ __html: renderInline(b.text) }} />;
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
    </div>
  );
}
