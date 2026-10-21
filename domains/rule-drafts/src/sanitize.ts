/**
 * The model's draft, made into a filter this app can actually run.
 *
 * Nothing the model returns is trusted. A field it invented would be sent to
 * Plex as a query parameter Plex ignores, and the rule would quietly widen to
 * everything the other clauses match; a genre this library doesn't have would
 * fail to resolve when the rule runs. So every clause is checked against the
 * same vocabulary the wizard's own pickers use — the field catalog, the
 * operators each field's kind allows, the library's real tag values, the
 * server's real users — and whatever doesn't survive is dropped *with a note
 * saying so*. A draft that silently lost a clause would read as "this is what
 * you asked for" when it isn't.
 */
import {
  fieldDef,
  fieldLabel,
  opsFor,
  parseRelativeDate,
  SMART_FILTER_FIELD_DEFS,
  type SmartFilterFieldKind,
} from "@rube/contracts";
import {
  isLocalField,
  type SmartFilterGroup,
  type SmartFilterLeaf,
  type SmartFilterNode,
} from "@rube/plex-smart-filter";

/** What the model is asked to return. Two levels deep, which is all a sentence needs. */
export interface DraftLeaf {
  field?: unknown;
  op?: unknown;
  value?: unknown;
}
export interface DraftGroup {
  combinator?: unknown;
  clauses?: unknown;
}
export interface Draft extends DraftGroup {
  /** Anything in the description the model couldn't express as a clause. */
  unsupported?: unknown;
}

export interface Vocabulary {
  /** Known values per tag field, by display name. A field absent here is not checked. */
  tags: ReadonlyMap<string, readonly string[]>;
  /** The server's users, for `tb.watchedBy`, which stores a user id. */
  users: ReadonlyArray<{ userId: number; username: string; name?: string | null }>;
}

export interface Sanitized {
  filter: SmartFilterGroup;
  /** What was changed or dropped, and why, in sentences for the wizard. */
  notes: string[];
}

/** Fields a draft may use: the ones the wizard's picker offers. */
export const DRAFTABLE_FIELDS = SMART_FILTER_FIELD_DEFS.filter((d) => !d.advanced);
const DRAFTABLE = new Set(DRAFTABLE_FIELDS.map((d) => d.field));

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MINUTE_MS = 60_000;

/**
 * A value in the stored form for its field's kind, or a reason it can't be.
 *
 * Lenient where a model's mistake has one obvious meaning — `true` for a
 * boolean, `2h` for a runtime, a rating out of 100 — and strict where it
 * doesn't, because a wrongly guessed number is a wrong rule nobody notices.
 */
function normaliseValue(
  kind: SmartFilterFieldKind,
  field: string,
  raw: string,
): { value: string; note?: string } | { error: string } {
  const v = raw.trim();
  if (v === "") return { error: "it had no value" };
  switch (kind) {
    case "boolean": {
      if (/^(1|true|yes)$/i.test(v)) return { value: "1" };
      if (/^(0|false|no)$/i.test(v)) return { value: "0" };
      return { error: `"${v}" isn't yes or no` };
    }
    case "number": {
      if (!/^-?\d+(\.\d+)?$/.test(v)) return { error: `"${v}" isn't a number` };
      const n = Math.round(Number(v));
      if (field === "tb.abandonedPct" && (n < 0 || n > 100)) return { error: `${n}% isn't a percentage` };
      return { value: String(n) };
    }
    case "rating": {
      if (!/^\d+(\.\d+)?$/.test(v)) return { error: `"${v}" isn't a rating` };
      const n = Number(v);
      if (n <= 10) return { value: String(n) };
      // "Rotten Tomatoes over 80" — the field is out of 10.
      if (n <= 100) return { value: String(n / 10), note: `read ${v} as ${n / 10} out of 10` };
      return { error: `${v} is above the 0–10 scale` };
    }
    case "date": {
      if (ISO_DATE.test(v) || parseRelativeDate(v)) return { value: v };
      // A bare year is how people say it: "released before 2000".
      if (/^\d{4}$/.test(v)) return { value: `${v}-01-01`, note: `read ${v} as 1 January ${v}` };
      return { error: `"${v}" isn't a date` };
    }
    case "duration": {
      const m = v.match(/^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?|ms)?$/i);
      if (!m) return { error: `"${v}" isn't a length of time` };
      const n = Number(m[1]);
      const unit = (m[2] ?? "").toLowerCase();
      if (unit === "ms") return { value: String(Math.round(n)) };
      if (unit.startsWith("h")) return { value: String(Math.round(n * 60 * MINUTE_MS)) };
      if (unit.startsWith("m")) return { value: String(Math.round(n * MINUTE_MS)) };
      // Unitless: a number of minutes reads as minutes, anything bigger is already milliseconds.
      return { value: String(n < 1000 ? Math.round(n * MINUTE_MS) : Math.round(n)) };
    }
    default:
      return { value: v };
  }
}

function sanitizeLeaf(raw: DraftLeaf, vocab: Vocabulary, notes: string[]): SmartFilterLeaf | null {
  const field = typeof raw.field === "string" ? raw.field.trim() : "";
  const op = typeof raw.op === "string" ? raw.op.trim() : "";
  const value = raw.value == null ? "" : String(raw.value);

  if (!DRAFTABLE.has(field)) {
    notes.push(`Left out a condition on "${field || "nothing"}", which isn't a field rules can filter on.`);
    return null;
  }
  const def = fieldDef(field)!;
  const label = fieldLabel(field);
  const allowed = opsFor(field);
  const opOption = allowed.find((o) => o.op === op);
  if (!opOption) {
    notes.push(`Left out "${label} ${op} ${value}": that comparison doesn't work on ${label.toLowerCase()}.`);
    return null;
  }

  if (field === "tb.watchedBy") {
    const wanted = value.trim().toLowerCase();
    const user = vocab.users.find(
      (u) =>
        u.username.toLowerCase() === wanted || (u.name ?? "").toLowerCase() === wanted || String(u.userId) === wanted,
    );
    if (!user) {
      notes.push(`Left out "watched by ${value}": there's no user by that name.`);
      return null;
    }
    return { kind: "leaf", field, op: opOption.op, value: String(user.userId) };
  }

  if (def.kind === "tag") {
    const known = vocab.tags.get(field);
    if (known) {
      const match = known.find((k) => k.toLowerCase() === value.trim().toLowerCase());
      if (!match) {
        notes.push(
          `Left out "${label} ${opOption.label} ${value}": this library has no ${label.toLowerCase()} called that.`,
        );
        return null;
      }
      return { kind: "leaf", field, op: opOption.op, value: match };
    }
    return { kind: "leaf", field, op: opOption.op, value: value.trim() };
  }

  const normalised = normaliseValue(def.kind, field, value);
  if ("error" in normalised) {
    notes.push(`Left out a ${label.toLowerCase()} condition: ${normalised.error}.`);
    return null;
  }
  if (normalised.note) notes.push(`For ${label.toLowerCase()}, ${normalised.note}.`);
  return { kind: "leaf", field, op: opOption.op, value: normalised.value };
}

function combinatorOf(raw: unknown): "all" | "any" {
  return raw === "any" ? "any" : "all";
}

function sanitizeGroup(raw: DraftGroup, vocab: Vocabulary, notes: string[], depth: number): SmartFilterGroup {
  const clauses = Array.isArray(raw.clauses) ? raw.clauses : [];
  const children: SmartFilterNode[] = [];
  for (const c of clauses) {
    if (!c || typeof c !== "object") continue;
    if ("clauses" in c) {
      // Two levels is what the model is asked for; anything deeper is flattened
      // into its parent rather than refused, losing only the nesting.
      const group = sanitizeGroup(c as DraftGroup, vocab, notes, depth + 1);
      if (depth >= 1) children.push(...group.children);
      else if (group.children.length === 1) children.push(group.children[0]);
      else if (group.children.length > 1) children.push(group);
    } else {
      const leaf = sanitizeLeaf(c as DraftLeaf, vocab, notes);
      if (leaf) children.push(leaf);
    }
  }
  return { kind: "group", combinator: combinatorOf(raw.combinator), children };
}

/**
 * Watch-history fields only work under AND (`splitLocalLeaves`): inside an OR,
 * Plex never returns the items the local check needs. The wizard refuses to
 * save that, so a draft that does it would hand the admin an error to find.
 */
function dropLocalUnderOr(group: SmartFilterGroup, notes: string[], underOr = false): SmartFilterGroup {
  const orHere = underOr || (group.combinator === "any" && group.children.length > 1);
  const children: SmartFilterNode[] = [];
  for (const child of group.children) {
    if (child.kind === "group") {
      const kept = dropLocalUnderOr(child, notes, orHere);
      if (kept.children.length > 0) children.push(kept);
    } else if (orHere && isLocalField(child.field)) {
      notes.push(`Left out "${fieldLabel(child.field)}": watch-history conditions can only be combined with AND.`);
    } else {
      children.push(child);
    }
  }
  return { ...group, children };
}

export function sanitizeDraft(raw: Draft, vocab: Vocabulary): Sanitized {
  const notes: string[] = [];
  let filter = dropLocalUnderOr(sanitizeGroup(raw, vocab, notes, 0), notes);
  // A root holding a single group is that group.
  if (filter.children.length === 1 && filter.children[0].kind === "group") filter = filter.children[0];
  if (Array.isArray(raw.unsupported)) {
    for (const u of raw.unsupported) {
      if (typeof u === "string" && u.trim()) notes.push(`Couldn't express "${u.trim()}" as a filter.`);
    }
  }
  return { filter, notes };
}
