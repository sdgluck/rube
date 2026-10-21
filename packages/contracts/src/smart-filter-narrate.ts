/**
 * A smart filter as a sentence a person would write.
 *
 * `describeSmartFilter` (in `presentation.ts`) restates a filter clause by
 * clause — "Genre is 1204 and unplayed is yes and release date in the last 10
 * years". That is the right thing for the wizard's review pane, where the
 * reader is checking the filter they just built. It is the wrong thing for a
 * collection's description in Plex, which is read by somebody browsing their
 * library and has no idea a filter exists.
 *
 * So this module rearranges the same clauses into English word order:
 * adjectives before the noun, the phrases that qualify it after, and the
 * conditions on the *items* last as relative clauses.
 *
 *     Horror films released in the last 10 years that you haven't watched.
 *
 * Every clause lands in one of four slots:
 *
 *   adjective   before the noun          "horror", "4K", "HDR"
 *   attachment  glued to the noun        "directed by Christopher Nolan"
 *   phrase      comma-joined qualifiers  "released in the last 10 years"
 *   clause      trailing relative clause "that you haven't watched"
 *
 * Anything whose shape doesn't decompose — nested groups, a top-level `or`
 * across different fields — falls back to a restatement rather than inventing
 * prose that might not mean what the filter means.
 */
import type { SmartFilterNode, SmartFilterOp } from "@rube/plex-smart-filter";
import { fieldDef, fieldKind, fieldLabel } from "./smart-filter-fields.ts";
import {
  formatDateValue,
  formatFilterValue,
  isTruthyBoolean,
  parseRelativeDate,
  relativeSpanText,
} from "./smart-filter-format.ts";
import { opLabel } from "./smart-filter-ops.ts";

/** Per-server tag key → title. Returns the value untouched if it can't. */
export type TagResolver = (field: string, value: string) => string;

export interface NarrateOptions {
  /** The library's noun, lower case: "films", "series", "titles". */
  noun: string;
  resolveTag?: TagResolver;
}

type Slot = "adjective" | "attachment" | "phrase" | "clause";

interface Fragment {
  slot: Slot;
  text: string;
}

/** One field compared against one or more values — an `or` over a single
 *  field collapses into this, since "genre is A or genre is B" is one idea. */
interface Clause {
  field: string;
  op: SmartFilterOp;
  values: string[];
}

// ─── Flattening ─────────────────────────────────────────────────────────────

/**
 * A tree as a flat clause list, or null if it doesn't reduce to one.
 *
 * The shapes that survive are the ones people actually build: a top-level
 * `all` over leaves, with `any` groups inside it that all name the same field
 * ("genre is horror or genre is thriller"). Everything else — a top-level `or`
 * across different fields, a group nested two deep — returns null, because
 * flattening it would quietly drop the precedence the filter depends on.
 */
function flatten(root: SmartFilterNode): Clause[] | null {
  if (root.kind === "leaf") return [{ field: root.field, op: root.op, values: [root.value] }];

  // A top-level `or` is only narratable when every branch is the same field.
  if (root.combinator === "any") {
    const merged = mergeSameField(root.children);
    return merged ? [merged] : null;
  }

  const out: Clause[] = [];
  for (const child of root.children) {
    if (child.kind === "leaf") {
      out.push({ field: child.field, op: child.op, values: [child.value] });
      continue;
    }
    if (child.children.length === 1) {
      const inner = flatten(child.children[0]);
      if (!inner) return null;
      out.push(...inner);
      continue;
    }
    if (child.combinator === "all") {
      const inner = flatten(child);
      if (!inner) return null;
      out.push(...inner);
      continue;
    }
    const merged = mergeSameField(child.children);
    if (!merged) return null;
    out.push(merged);
  }
  return out;
}

/** `genre = A or genre = B` → one clause with two values. Null otherwise. */
function mergeSameField(children: readonly SmartFilterNode[]): Clause | null {
  if (children.length === 0) return null;
  const leaves = children.filter((c) => c.kind === "leaf");
  if (leaves.length !== children.length) return null;
  const [first] = leaves;
  if (!leaves.every((l) => l.field === first.field && l.op === first.op)) return null;
  // Only a positive match reads as a list. "not A or not B" matches everything
  // and is a filter bug, not a phrase to translate.
  if (first.op !== "=" && first.op !== "==") return null;
  return { field: first.field, op: first.op, values: leaves.map((l) => l.value) };
}

// ─── Clause → fragment ──────────────────────────────────────────────────────

/**
 * Scopes that describe the collection's own items. `show.genre` on a TV
 * section is still "horror series"; `episode.unwatched` is a statement about
 * episodes, not about the series, so it goes through the generic path where
 * the label keeps saying "episode".
 */
const ITEM_SCOPES = new Set(["show", "artist"]);

function baseField(field: string): string {
  const dot = field.indexOf(".");
  if (dot === -1) return field;
  const scope = field.slice(0, dot);
  return ITEM_SCOPES.has(scope) ? field.slice(dot + 1) : field;
}

function joinList(parts: string[], conjunction: "and" | "or"): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} ${conjunction} ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} ${conjunction} ${parts[parts.length - 1]}`;
}

/** Who a credit belongs to, as the verb that introduces them. */
const CREDIT_VERBS: Record<string, string> = {
  director: "directed by",
  writer: "written by",
  actor: "starring",
  studio: "from",
  country: "from",
};

function fragmentFor(clause: Clause, opts: NarrateOptions): Fragment {
  const { field, op } = clause;
  const base = baseField(field);
  const shown = (conjunction: "and" | "or" = "or") =>
    joinList(
      clause.values.map((v) => formatFilterValue(field, v, opts.resolveTag?.(field, v))),
      conjunction,
    );
  const one = () => shown("or");
  const positive = op === "=" || op === "==";
  const truthy = isTruthyBoolean(clause.values[0] ?? "1") !== (op === "!=");

  switch (base) {
    case "genre":
      // Genres are common nouns wherever they sit in the sentence — "Comedy
      // and Romance films" reads like a proper title, "comedy and romance
      // films" reads like English. The leading capital comes back at the end.
      return positive
        ? { slot: "adjective", text: shown("and").toLowerCase() }
        : { slot: "phrase", text: `excluding ${one().toLowerCase()}` };

    case "resolution":
      return positive ? { slot: "adjective", text: shown("and") } : { slot: "phrase", text: `excluding ${one()}` };

    case "hdr":
      return truthy ? { slot: "adjective", text: "HDR" } : { slot: "phrase", text: "without HDR" };

    case "contentRating":
      return { slot: "phrase", text: positive ? `rated ${one()}` : `not rated ${one()}` };

    case "director":
    case "writer":
    case "actor":
    case "studio":
    case "country": {
      const verb = CREDIT_VERBS[base];
      return { slot: "attachment", text: positive ? `${verb} ${one()}` : `not ${verb} ${one()}` };
    }

    case "network":
      return { slot: "clause", text: positive ? `that aired on ${one()}` : `that didn't air on ${one()}` };

    case "collection":
      return { slot: "phrase", text: positive ? `in the ${one()} collection` : `outside the ${one()} collection` };

    case "label":
      return { slot: "phrase", text: positive ? `labelled ${one()}` : `not labelled ${one()}` };

    case "year": {
      const v = one();
      if (op === ">=") return { slot: "phrase", text: `from ${v} onwards` };
      if (op === ">") return { slot: "phrase", text: `released after ${v}` };
      if (op === "<=") return { slot: "phrase", text: `up to ${v}` };
      if (op === "<") return { slot: "phrase", text: `released before ${v}` };
      if (op === "!=") return { slot: "phrase", text: `excluding ${v}` };
      return { slot: "phrase", text: `from ${v}` };
    }

    case "decade": {
      const v = one();
      if (op === ">=") return { slot: "phrase", text: `from the ${v}s onwards` };
      if (op === "<=") return { slot: "phrase", text: `up to the ${v}s` };
      return { slot: "phrase", text: positive ? `from the ${v}s` : `outside the ${v}s` };
    }

    case "originallyAvailableAt":
      return datePhrase(clause, "released") ?? generic(clause, opts);
    case "addedAt":
      return datePhrase(clause, "added") ?? generic(clause, opts);

    // Both "last played" fields answer the same question about different
    // people: Plex's is scoped to whichever token asked (the server owner),
    // Rube's spans every user. The wording has to say which.
    case "lastViewedAt":
      return lastPlayedPhrase(clause, "last played") ?? generic(clause, opts);
    case "tb.lastPlayedAt":
      return lastPlayedPhrase(clause, "last played by anyone") ?? generic(clause, opts);

    case "rating":
      return { slot: "phrase", text: `rated ${bound(op, one())}` };
    case "audienceRating":
      return { slot: "phrase", text: `audience-rated ${bound(op, one())}` };
    case "userRating":
      return { slot: "clause", text: `that you've rated ${bound(op, one())}` };

    case "duration": {
      const v = one();
      if (op === ">" || op === ">=") return { slot: "phrase", text: `longer than ${v}` };
      if (op === "<" || op === "<=") return { slot: "phrase", text: `shorter than ${v}` };
      return { slot: "phrase", text: `${v} long` };
    }

    case "unwatched":
      return { slot: "clause", text: truthy ? "that you haven't watched" : "that you've watched" };
    case "inProgress":
      return { slot: "clause", text: truthy ? "that you're partway through" : "that you aren't partway through" };
    case "trash":
      return truthy ? { slot: "phrase", text: "in the trash" } : { slot: "phrase", text: "not in the trash" };
    case "duplicate":
      return truthy ? { slot: "phrase", text: "with duplicate copies" } : { slot: "phrase", text: "with one copy" };
    case "unmatched":
      return { slot: "clause", text: truthy ? "that Plex hasn't matched" : "that Plex has matched" };

    case "viewCount":
      return { slot: "clause", text: playCountText(clause, "you've played", "you've never played") };
    case "tb.playCount":
      return { slot: "clause", text: playCountText(clause, "anyone has played", "nobody has played") };

    case "tb.watchedByAll":
      return { slot: "clause", text: truthy ? "that everyone has watched" : "that not everyone has watched" };
    case "tb.watchedByNobody":
      return { slot: "clause", text: truthy ? "that nobody has watched" : "that somebody has watched" };
    case "tb.watchedBy": {
      const who = one();
      return { slot: "clause", text: positive ? `that ${who} has watched` : `that ${who} hasn't watched` };
    }
    case "tb.abandonedPct": {
      const pct = clause.values[0] || "?";
      if (op === "<" || op === "<=") return { slot: "phrase", text: `abandoned below ${pct}%` };
      if (op === ">" || op === ">=") return { slot: "phrase", text: `watched past ${pct}%` };
      return generic(clause, opts);
    }

    case "title":
      return { slot: "clause", text: op === "==" ? `titled "${one()}"` : `whose title contains "${one()}"` };
    case "summary":
      return { slot: "clause", text: `whose summary mentions "${one()}"` };

    default:
      return generic(clause, opts);
  }
}

/** "7/10 or higher" — the comparison as a person states a threshold. */
function bound(op: SmartFilterOp, value: string): string {
  if (op === ">=" || op === ">") return `${value} or higher`;
  if (op === "<=" || op === "<") return `${value} or lower`;
  return value;
}

function playCountText(clause: Clause, who: string, never: string): string {
  const n = Number(clause.values[0]);
  if (n === 0 && (clause.op === "=" || clause.op === "<=")) return `that ${never}`;
  if (clause.op === ">=" || clause.op === ">") return `that ${who} at least ${clause.values[0]} times`;
  if (clause.op === "<=" || clause.op === "<") return `that ${who} at most ${clause.values[0]} times`;
  return `that ${who} ${clause.values[0]} times`;
}

/**
 * A date clause as "released in the last 10 years" / "added more than 6
 * months ago". Null when the operator and value don't make a phrase worth
 * having — the generic path says it correctly, if less prettily.
 */
function datePhrase(clause: Clause, verb: string): Fragment | null {
  if (clause.values.length !== 1) return null;
  const value = clause.values[0];
  const rel = parseRelativeDate(value);
  if (rel) {
    const span = relativeSpanText(rel);
    if (clause.op === ">=" || clause.op === ">") return { slot: "phrase", text: `${verb} in the last ${span}` };
    if (clause.op === "<=" || clause.op === "<") return { slot: "phrase", text: `${verb} more than ${span} ago` };
    return null;
  }
  const shown = formatDateValue(value);
  const bare = /^\d{4}$/.test(value);
  if (clause.op === ">=")
    return { slot: "phrase", text: `${verb} ${bare ? `from ${shown} onwards` : `on or after ${shown}`}` };
  if (clause.op === ">") return { slot: "phrase", text: `${verb} after ${shown}` };
  if (clause.op === "<=")
    return { slot: "phrase", text: `${verb} ${bare ? `up to ${shown}` : `on or before ${shown}`}` };
  if (clause.op === "<") return { slot: "phrase", text: `${verb} before ${shown}` };
  if (clause.op === "=") return { slot: "phrase", text: `${verb} ${bare ? "in" : "on"} ${shown}` };
  return null;
}

function lastPlayedPhrase(clause: Clause, lead: string): Fragment | null {
  if (clause.values.length !== 1) return null;
  const rel = parseRelativeDate(clause.values[0]);
  if (!rel) return null;
  const span = relativeSpanText(rel);
  if (clause.op === ">=" || clause.op === ">") return { slot: "phrase", text: `${lead} in the last ${span}` };
  if (clause.op === "<=" || clause.op === "<") return { slot: "phrase", text: `${lead} more than ${span} ago` };
  return null;
}

/**
 * The clause nobody wrote a phrasing for, as a relative clause: "whose
 * bitrate is at least 8000 kbps". Plex has far more fields than this module
 * has opinions about, and a slightly stiff sentence beats no summary.
 */
function generic(clause: Clause, opts: NarrateOptions): Fragment {
  const label = fieldLabel(clause.field).toLowerCase();
  const values = joinList(
    clause.values.map((v) => formatFilterValue(clause.field, v, opts.resolveTag?.(clause.field, v))),
    "or",
  );
  return { slot: "clause", text: `whose ${label} ${opLabel(clause.field, clause.op)} ${values}` };
}

// ─── Composition ────────────────────────────────────────────────────────────

/** Quality before kind: "4K HDR horror films", not "horror 4K HDR films". */
function adjectiveRank(field: string): number {
  return baseField(field) === "genre" ? 1 : 0;
}

/**
 * The whole filter as one sentence, ending in a full stop, or null when it
 * has nothing to say. Callers write the result to Plex verbatim.
 */
export function narrateSmartFilter(root: SmartFilterNode, opts: NarrateOptions): string | null {
  const clauses = flatten(root);
  if (!clauses || clauses.length === 0) return null;

  const kept = clauses.filter((c) => c.values.some((v) => v.trim() !== ""));
  if (kept.length === 0) return null;

  const ordered = [...kept].sort((a, b) => adjectiveRank(a.field) - adjectiveRank(b.field));
  const fragments = ordered.map((c) => fragmentFor(c, opts));
  const bySlot = (slot: Slot) => fragments.filter((f) => f.slot === slot).map((f) => f.text);

  const adjectives = bySlot("adjective");
  const attachments = bySlot("attachment");
  const phrases = bySlot("phrase");
  const relatives = bySlot("clause");

  let sentence = [...adjectives, opts.noun].join(" ");
  if (attachments.length) sentence += ` ${joinList(attachments, "and")}`;
  // The first qualifier hangs straight off the noun phrase; the rest are a
  // list, so they get commas. "Films from 2000 onwards, rated 7/10 or higher".
  phrases.forEach((phrase, i) => {
    sentence += i === 0 ? ` ${phrase}` : `, ${phrase}`;
  });
  if (relatives.length) sentence += ` ${joinList(relatives, "and")}`;

  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/** Whether a field's value needs a per-server tag lookup to read as English. */
export function needsTagLookup(field: string, value: string): boolean {
  return fieldKind(field) === "tag" && /^\d+$/.test(value.trim()) && fieldDef(field)?.field !== "resolution";
}
