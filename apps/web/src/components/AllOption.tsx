/**
 * The "everything" choice at the head of a Plex checkbox group.
 *
 * Plex reads an empty library or rating selection as *no restriction*, which
 * is the opposite of what an empty checklist looks like. Each group used to
 * carry a sentence saying so; this makes the empty state a ticked option of
 * its own. It is on exactly when nothing else is, and clicking it clears the
 * rest — there is nothing to untick it *to*, so unchecking it is a no-op.
 */
export default function AllOption({
  label,
  checked,
  onSelect,
  disabled,
  className,
}: {
  label: string;
  checked: boolean;
  onSelect: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={className}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={() => !checked && onSelect()} />
      {label}
    </label>
  );
}
