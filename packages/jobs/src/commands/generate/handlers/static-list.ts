import { indexItemsByImdb, indexItemsByTmdb, type IndexedItem } from "#commands/generate/plex-index.ts";

import type { HandlerDeps, PendingCollection } from "#commands/generate/types.ts";

/**
 * A collection whose members are written down rather than worked out.
 *
 * Every other rule type answers "which items match this description?". This
 * one answers "which items did I say?", which sounds like a step backwards
 * until you look at what it's for: migration. A Kometa config contains
 * definitions Tinkerbell has no builder for — a Letterboxd list, a TMDb
 * discover query, a hand-picked `tmdb_movie` id list — and the alternative to
 * this rule type is telling the user those collections are simply gone.
 *
 * With it, the migration can adopt any collection at all: freeze its current
 * members, keep it alive under Tinkerbell's management, and let the user
 * convert it to a real rule later or leave it exactly as it is. That is the
 * difference between "we migrated most of it" and "nothing was lost".
 *
 * Items are addressed by IMDb/TMDb id rather than by Plex rating key on
 * purpose. Rating keys are per-server and don't survive a library rebuild, so
 * a frozen collection keyed on them would quietly empty itself the first time
 * somebody re-added their library — which is precisely when they'd least want
 * to discover the backup was worthless.
 */
export function createStaticListCommand() {
  const staticListHandler = async function* (deps: HandlerDeps): AsyncGenerator<PendingCollection> {
    const { ctx, client, sections, ruleConfig } = deps;

    const items = ruleConfig.items ?? [];
    if (items.length === 0) {
      ctx.log("This collection has no items recorded — nothing to build.");
      return;
    }

    const imdbIds = items.flatMap((i) => (i.imdb ? [i.imdb] : []));
    const tmdbIds = items.flatMap((i) => (i.tmdb == null ? [] : [i.tmdb]));
    const name = ruleConfig.collectionName?.trim();
    if (!name) throw new Error("A frozen collection needs a name.");

    ctx.log(`Rebuilding "${name}" from ${items.length} recorded item(s).`);

    for (const section of sections) {
      ctx.signal?.throwIfAborted();

      const matched: IndexedItem[] = [];
      const seen = new Set<string>();

      // Preserve the recorded order: for a hand-ordered Kometa collection that
      // order is the only thing left of the user's intent, and `collectionSort:
      // custom` in the presentation config is what makes Plex honour it.
      const byImdb = imdbIds.length > 0 ? (await indexItemsByImdb(client, section.key)).imdbToItem : null;
      const byTmdb = tmdbIds.length > 0 ? (await indexItemsByTmdb(client, section.key)).tmdbToItem : null;

      for (const item of items) {
        const found =
          (item.imdb ? byImdb?.get(item.imdb) : undefined) ?? (item.tmdb != null ? byTmdb?.get(item.tmdb) : undefined);
        if (found && !seen.has(found.ratingKey)) {
          matched.push(found);
          seen.add(found.ratingKey);
        }
      }

      if (matched.length === 0) {
        ctx.log(`None of the recorded items are in "${section.title}", skipping.`);
        continue;
      }

      // Worth saying out loud: a frozen collection that has quietly lost half
      // its members is the failure mode this rule type exists to avoid, so the
      // shortfall goes in the run log rather than being inferred from a count.
      if (matched.length < items.length) {
        ctx.log(`[${name}] ${matched.length}/${items.length} recorded items found in "${section.title}".`);
      }

      yield { name, section, matched };
    }
  };

  return { staticListHandler };
}
