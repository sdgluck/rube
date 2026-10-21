import { asList, asRecord } from "./parse.ts";

/**
 * Kometa's template system, modelled as far as is honest and no further.
 *
 * Templates are how a Kometa config stays short: one template describes "a
 * collection built from an IMDb list", and twenty definitions instantiate it
 * with different urls. Skipping expansion would leave every one of those
 * twenty definitions looking like `template: {name: imdb, url: …}` and nothing
 * else — no builder, nothing to map. So this has to work.
 *
 * What is modelled: `<<var>>` substitution (in values *and* keys), `default:`
 * fallbacks, `optional:` attribute deletion, the `<<mapping_name>>` /
 * `<<collection_name>>` / `<<library_name>>` specials, multiple templates per
 * definition, and variable precedence. Anchors and merge keys come free from
 * the parser.
 *
 * What is not: `conditionals:`, which is a small expression language, and
 * template recursion beyond one level of `template:` inside a template. Both
 * are rare outside Kometa's own Defaults — which we resolve from a table
 * rather than interpret — and both are reported rather than silently
 * half-applied. That reporting is the load-bearing part: a definition built on
 * machinery we only partly understood must never reach the review screen
 * labelled faithful.
 */

/** `<<name>>`, Kometa's substitution syntax. */
const VAR_RE = /<<\s*([a-zA-Z0-9_]+)\s*>>/g;

export interface ExpansionResult {
  definition: Record<string, unknown>;
  /** Template features that applied but weren't fully modelled. */
  warnings: string[];
}

function substituteString(input: string, vars: Record<string, unknown>): { out: unknown; missing: string[] } {
  const missing: string[] = [];

  // A value that is *entirely* one variable takes that variable's type: a
  // template var holding a list must arrive as a list, not as "[object
  // Object]". Only mixed strings get stringified.
  const whole = input.match(/^<<\s*([a-zA-Z0-9_]+)\s*>>$/);
  if (whole) {
    const name = whole[1]!;
    if (name in vars) return { out: vars[name], missing };
    return { out: input, missing: [name] };
  }

  const out = input.replace(VAR_RE, (match, name: string) => {
    if (name in vars) {
      const v = vars[name];
      return v == null ? "" : String(v);
    }
    missing.push(name);
    return match;
  });
  return { out, missing };
}

/** Walk any value, substituting variables in every string it contains. */
function substitute(value: unknown, vars: Record<string, unknown>, missing: Set<string>): unknown {
  if (typeof value === "string") {
    const { out, missing: m } = substituteString(value, vars);
    m.forEach((name) => missing.add(name));
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, vars, missing));
  const rec = asRecord(value);
  if (rec) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      // Keys are substituted too: Kometa templates parameterise the builder
      // itself in places (`<<builder>>: <<value>>`).
      const key = typeof k === "string" ? String(substituteString(k, vars).out) : k;
      out[key] = substitute(v, vars, missing);
    }
    return out;
  }
  return value;
}

/** True if any string anywhere under `value` references `<<name>>`. */
function referencesVar(value: unknown, name: string): boolean {
  if (typeof value === "string") {
    VAR_RE.lastIndex = 0;
    return [...value.matchAll(VAR_RE)].some((m) => m[1] === name);
  }
  if (Array.isArray(value)) return value.some((v) => referencesVar(v, name));
  const rec = asRecord(value);
  if (rec) return Object.entries(rec).some(([k, v]) => referencesVar(k, name) || referencesVar(v, name));
  return false;
}

/**
 * Expand one definition against the file's templates.
 *
 * Precedence, lowest to highest: the template's own `default:` block, then
 * library-level `template_variables`, then variables attached to the file
 * reference in config.yml, then the vars written inline on `template:`, then
 * the definition's own `variables:`. This is the order that makes "set it
 * once at the library level, override it for one collection" work, which is
 * how the Defaults are customised in practice.
 */
export function expandDefinition(opts: {
  mappingName: string;
  definition: Record<string, unknown>;
  templates: Record<string, unknown>;
  libraryVars: Record<string, unknown>;
  refVars: Record<string, unknown>;
  libraryName: string;
}): ExpansionResult {
  const { mappingName, definition, templates, libraryVars, refVars, libraryName } = opts;
  const warnings: string[] = [];

  const templateRefs = asList(definition.template);
  if (templateRefs.length === 0) {
    // No template, but the specials still resolve — a definition can use
    // `<<collection_name>>` in its summary without any template involved.
    const specials = {
      mapping_name: mappingName,
      collection_name: typeof definition.name === "string" ? definition.name : mappingName,
      library_name: libraryName,
      ...libraryVars,
      ...refVars,
      ...asRecord(definition.variables),
    };
    const missing = new Set<string>();
    const out = asRecord(substitute(stripMeta(definition), specials, missing)) ?? {};
    return { definition: out, warnings };
  }

  // Later templates in the list win over earlier ones, and the definition's
  // own attributes win over all of them.
  let merged: Record<string, unknown> = {};

  for (const raw of templateRefs) {
    const ref = typeof raw === "string" ? { name: raw } : (asRecord(raw) ?? {});
    const name = typeof ref.name === "string" ? ref.name : undefined;
    if (!name) {
      warnings.push("A `template:` entry had no `name` — skipped.");
      continue;
    }
    const body = asRecord(templates[name]);
    if (!body) {
      warnings.push(`Template "${name}" wasn't found in this file — the definition may be missing its builder.`);
      continue;
    }

    const inlineVars: Record<string, unknown> = { ...ref };
    delete inlineVars.name;

    const defaults = asRecord(body.default) ?? {};
    const optional = new Set(
      asList(body.optional)
        .filter((v) => typeof v === "string")
        .map((v) => v as string),
    );

    if (body.conditionals != null) {
      warnings.push(
        `Template "${name}" uses \`conditionals:\`, which Rube doesn't evaluate — any value it would have chosen fell back to the template default.`,
      );
    }
    if (body.template != null) {
      warnings.push(
        `Template "${name}" extends another template, which Rube doesn't follow — some settings may be missing.`,
      );
    }

    const vars: Record<string, unknown> = {
      ...defaults,
      ...libraryVars,
      ...refVars,
      ...inlineVars,
      ...asRecord(definition.variables),
      mapping_name: mappingName,
      collection_name: typeof definition.name === "string" ? definition.name : mappingName,
      library_name: libraryName,
    };

    const bodyAttrs = stripTemplateMeta(body);

    // `optional:` means "drop any attribute that depends on a variable nobody
    // set". Without this, an optional url arrives as the literal string
    // `<<url>>` and the mapping dutifully proposes a rule pointing at it.
    const pruned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(bodyAttrs)) {
      const unmet = [...optional].find((name) => !(name in vars) && (referencesVar(v, name) || referencesVar(k, name)));
      if (unmet) continue;
      pruned[k] = v;
    }

    const missing = new Set<string>();
    const expanded = asRecord(substitute(pruned, vars, missing)) ?? {};
    for (const varName of missing) {
      if (optional.has(varName)) continue;
      warnings.push(`Template "${name}" expects a \`<<${varName}>>\` variable that was never set — left unresolved.`);
    }

    merged = { ...merged, ...expanded };
  }

  // The definition's own attributes are the last word, and are themselves
  // substituted so `<<mapping_name>>` works when written inline.
  const ownVars: Record<string, unknown> = {
    ...libraryVars,
    ...refVars,
    ...asRecord(definition.variables),
    mapping_name: mappingName,
    collection_name: typeof definition.name === "string" ? definition.name : mappingName,
    library_name: libraryName,
  };
  const own = asRecord(substitute(stripMeta(definition), ownVars, new Set())) ?? {};

  return { definition: { ...merged, ...own }, warnings: dedupe(warnings) };
}

/** Definition-level keys that configure expansion rather than the collection. */
function stripMeta(definition: Record<string, unknown>): Record<string, unknown> {
  const { template: _t, variables: _v, ...rest } = definition;
  return rest;
}

/** Template-level keys that configure expansion rather than the collection. */
function stripTemplateMeta(body: Record<string, unknown>): Record<string, unknown> {
  const { default: _d, optional: _o, conditionals: _c, template: _t, variables: _v, ...rest } = body;
  return rest;
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
