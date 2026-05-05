import { trpc } from "#/trpc";
import styles from "#pages/Jobs.module.css";

interface Props {
  selected: string[];
  onChange: (next: string[]) => void;
}

export default function SectionsRow({ selected, onChange }: Props) {
  const sectionsQuery = trpc.plexSections.useQuery(undefined, {
    refetchOnWindowFocus: false,
    retry: false,
  });
  const sections = sectionsQuery.data;

  return (
    <tr>
      <td>Sections</td>
      <td>
        {sections && sections.length > 0 ? (
          <div className={styles.configSections}>
            {sections.map((s) => (
              <label key={s.key} className={styles.configSectionItem}>
                <input
                  type="checkbox"
                  checked={selected.includes(s.title)}
                  onChange={() => {
                    onChange(
                      selected.includes(s.title) ? selected.filter((t) => t !== s.title) : [...selected, s.title],
                    );
                  }}
                />
                <span>{s.title}</span>
              </label>
            ))}
          </div>
        ) : (
          <span className={styles.configHint}>Configure Plex first</span>
        )}
      </td>
      <td className={styles.configSummary}>{selected.length > 0 ? selected.join(", ") : "All sections"}</td>
    </tr>
  );
}
