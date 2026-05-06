import { trpc } from "#/trpc";
import styles from "#pages/Jobs/Jobs.module.css";

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
  const summary = selected.length > 0 ? selected.join(", ") : "All sections";

  return (
    <tr>
      <td className={styles.fieldLabel}>Sections</td>
      <td>
        {sections && sections.length > 0 ? (
          <>
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
            <div className={styles.fieldHelp}>{summary}</div>
          </>
        ) : (
          <span className={styles.fieldHelp}>Configure Plex first</span>
        )}
      </td>
    </tr>
  );
}
