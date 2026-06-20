import styles from "./CodeBlock.module.css";

/** Minimal terminal-style code block. Lines starting with `#` render muted. */
export default function CodeBlock({ lines }: { lines: string[] }) {
  return (
    <pre className={styles.block}>
      <code>
        {lines.map((line, i) => (
          <span key={i} className={line.startsWith("#") ? styles.comment : styles.line}>
            {line || " "}
            {"\n"}
          </span>
        ))}
      </code>
    </pre>
  );
}
