import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { trpc } from "../trpc";
import styles from "./Collections.module.css";

export default function CollectionDetail() {
  const { ratingKey } = useParams<{ ratingKey: string }>();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingLabels, setSavingLabels] = useState(false);
  const [labelInput, setLabelInput] = useState("");
  const [status, setStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const collectionQuery = trpc.collections.get.useQuery(
    { ratingKey: ratingKey! },
    { enabled: !!ratingKey, refetchOnWindowFocus: false },
  );

  const itemsQuery = trpc.collections.items.useQuery(
    { ratingKey: ratingKey! },
    { enabled: !!ratingKey, refetchOnWindowFocus: false },
  );

  const updateMutation = trpc.collections.update.useMutation();
  const updateLabelsMutation = trpc.collections.updateLabels.useMutation();
  const deleteMutation = trpc.collections.delete.useMutation();

  const collection = collectionQuery.data;
  const items = itemsQuery.data || [];

  useEffect(() => {
    if (collection) {
      setTitle(collection.title);
      setSummary(collection.summary);
    }
  }, [collection]);

  const handleSave = async () => {
    if (!ratingKey) return;
    setSaving(true);
    setStatus(null);
    try {
      await updateMutation.mutateAsync({ ratingKey, title, summary });
      setStatus({ type: "success", msg: "Collection updated" });
      collectionQuery.refetch();
    } catch {
      setStatus({ type: "error", msg: "Failed to update collection" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!ratingKey || !collection) return;
    if (!confirm(`Delete "${collection.title}"? This will remove it from Plex.`)) return;
    try {
      await deleteMutation.mutateAsync({ ratingKey });
      navigate("/collections");
    } catch {
      setStatus({ type: "error", msg: "Failed to delete collection" });
    }
  };

  if (collectionQuery.isLoading) return <p>Loading...</p>;
  if (collectionQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Collection not found</div>;
  if (!collection) return null;

  const labels: string[] = (() => {
    try {
      return JSON.parse(collection.labels);
    } catch {
      return [];
    }
  })();

  return (
    <div>
      <a
        href="#"
        className={styles.backLink}
        onClick={(e) => {
          e.preventDefault();
          navigate(-1);
        }}
      >
        &larr; Back to Collections
      </a>

      <div className={styles.detailHeader}>
        <h2 className={styles.heading}>{collection.title}</h2>
        <button className={styles.buttonDanger} onClick={handleDelete}>
          Delete
        </button>
      </div>

      <div className={styles.meta}>
        <span>Section: {collection.sectionTitle}</span>
        <span>{collection.childCount} items</span>
        {collection.addedAt && <span>Added: {new Date(collection.addedAt * 1000).toLocaleDateString()}</span>}
      </div>

      {labels.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {labels.map((label) => (
            <span
              key={label}
              className={`${styles.label} ${["tinkerbell", "generated", "becauseyouwatched"].includes(label.toLowerCase()) ? styles.labelTinkerbell : label.toLowerCase().startsWith("user:") ? styles.labelUser : ""}`}
            >
              {label}
              <button
                className={styles.labelRemove}
                title={`Remove "${label}"`}
                onClick={async () => {
                  if (!ratingKey) return;
                  setSavingLabels(true);
                  setStatus(null);
                  try {
                    await updateLabelsMutation.mutateAsync({
                      ratingKey,
                      labels: labels.filter((l) => l !== label),
                    });
                    setStatus({ type: "success", msg: `Removed label "${label}"` });
                    collectionQuery.refetch();
                  } catch {
                    setStatus({ type: "error", msg: `Failed to remove label "${label}"` });
                  } finally {
                    setSavingLabels(false);
                  }
                }}
                disabled={savingLabels}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      <div className={styles.labelEditorRow} style={{ marginBottom: 16 }}>
        <input
          type="text"
          className={styles.labelEditorInput}
          placeholder="Add label..."
          value={labelInput}
          onChange={(e) => setLabelInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const value = labelInput.trim();
              if (!value || !ratingKey) return;
              setSavingLabels(true);
              setStatus(null);
              updateLabelsMutation
                .mutateAsync({ ratingKey, labels: [...new Set([...labels, value])] })
                .then(() => {
                  setLabelInput("");
                  setStatus({ type: "success", msg: `Added label "${value}"` });
                  collectionQuery.refetch();
                })
                .catch(() => {
                  setStatus({ type: "error", msg: `Failed to add label "${value}"` });
                })
                .finally(() => setSavingLabels(false));
            }
          }}
          disabled={savingLabels}
        />
      </div>

      {status && <div className={`${styles.toast} ${styles[status.type]}`}>{status.msg}</div>}

      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>Edit</legend>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Title</span>
          <input type="text" className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Summary</span>
          <textarea className={styles.textarea} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>
        <div className={styles.buttons}>
          <button className={styles.button} onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>Items ({items.length})</legend>
        {itemsQuery.isLoading ? (
          <p className={styles.hint}>Loading items...</p>
        ) : items.length === 0 ? (
          <p className={styles.hint}>No items in this collection.</p>
        ) : (
          <div className={styles.itemsList}>
            {items.map((item) => (
              <div key={item.ratingKey} className={styles.itemRow}>
                <span className={styles.itemTitle}>{item.title}</span>
                {item.year && <span className={styles.itemYear}>({item.year})</span>}
              </div>
            ))}
          </div>
        )}
      </fieldset>
    </div>
  );
}
