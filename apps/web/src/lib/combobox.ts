/**
 * What a typeahead's list shows for what's been typed.
 *
 * A `<datalist>` filtered by the field's whole value, so once a model was
 * chosen the list offered that one model and nothing else — seeing the rest
 * meant clearing the field and losing the value. Here filtering is only what
 * typing does: a list opened without typing shows everything, and a filtered
 * one says how many it hid so "show all" is always one click away.
 */
export interface ComboOption {
  value: string;
  label?: string;
}

export interface ComboView {
  options: ComboOption[];
  /** How many options the filter left out — the "Show all" row appears when this is above zero. */
  hidden: number;
}

export function comboView(all: ComboOption[], query: string, showAll: boolean): ComboView {
  const q = query.trim().toLowerCase();
  if (showAll || !q) return { options: all, hidden: 0 };
  const options = all.filter((o) => o.value.toLowerCase().includes(q) || (o.label?.toLowerCase().includes(q) ?? false));
  return { options, hidden: all.length - options.length };
}
