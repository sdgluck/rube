/**
 * What We Think You'd Like and Because You Watched say in their run log about
 * the built-in recommender.
 *
 * Its first release logged "Ranking with the built-in recommender…" once and
 * then nothing: when it declined a library — too few titles with a vector, an
 * index with no TMDb ids — the reason went to the server's stdout, and the run
 * log read exactly the same whether it had ranked anything or not. Every row
 * now says which it was, and the run ends with the tally.
 */
import { describeSkip, type RankResult, type RecommenderStatus } from "@rube/domain.recommendations";

const pct = (n: number, d: number) => `${Math.round((100 * n) / Math.max(d, 1))}%`;

export function createRecommenderLog(log: (...args: unknown[]) => void, status: RecommenderStatus) {
  let ranked = 0;
  const skips = new Map<string, number>();

  /** The model, and how much of each library in this run it can rank. */
  function header(sectionTitles: string[]): void {
    if (!status.model) return;
    log(`Built-in recommender: model v${status.model.version} (${status.model.count.toLocaleString()} titles).`);
    const wanted = new Set(sectionTitles);
    for (const lib of status.libraries ?? []) {
      if (!wanted.has(lib.sectionTitle)) continue;
      log(
        lib.withVector === 0
          ? `  "${lib.sectionTitle}": no title has a TMDb id the model knows yet — run a media sync.`
          : `  "${lib.sectionTitle}": ${lib.withVector.toLocaleString()} of ${lib.total.toLocaleString()} titles have vectors (${pct(lib.withVector, lib.total)}).`,
      );
    }
  }

  /** One row's outcome: `null` when the recommender wasn't asked at all. */
  function outcome(result: RankResult | null): void {
    if (!result) return;
    if ("ratingKeys" in result) ranked++;
    else {
      const why = describeSkip(result);
      skips.set(why, (skips.get(why) ?? 0) + 1);
    }
  }

  /** The tally: how many rows it ranked, and why the rest weren't. */
  function footer(): void {
    const skipped = [...skips.values()].reduce((a, b) => a + b, 0);
    if (ranked + skipped === 0) return;
    const reasons = [...skips].map(([why, n]) => (n > 1 ? `${n}× ${why}` : why)).join("; ");
    log(
      `Recommender ranked ${ranked} of ${ranked + skipped} row(s)${skipped > 0 ? `; fell back on ${skipped} (${reasons})` : ""}.`,
    );
  }

  return { header, outcome, footer };
}

/** The first few of a ranking, by title, for a log line. */
export function topTitles(ratingKeys: string[], titleOf: Map<string, string>, n = 5): string {
  const names = ratingKeys.slice(0, n).map((k) => titleOf.get(k) ?? k);
  return ratingKeys.length > n ? `${names.join(", ")}, …` : names.join(", ");
}
