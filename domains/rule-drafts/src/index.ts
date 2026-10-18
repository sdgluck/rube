/* ─── Rule drafts: a sentence in, a smart filter out ─────────────────────────
 *
 * "90s action films under two hours that nobody has watched" becomes the
 * clauses the wizard would otherwise be clicked through. The result is a
 * draft and nothing more: it lands in the wizard's own editor, where every
 * clause can be read and changed, and nothing is saved until the admin saves.
 *
 * Different from the `ai_prompt` rule type on purpose. That asks the model
 * every time the rule runs, so its output is opaque and varies night to
 * night. A draft is asked once, and what is stored is an ordinary smart
 * filter — deterministic, explainable by `explainItem`, and free to run.
 *
 * One model call per draft, made while the admin waits. It is a short prompt
 * and a short answer, unlike the library-sized calls `ai-preview` had to move
 * to start-and-poll for; the timeout below is what bounds it.
 */
import { token } from "@tinkerbell/container";
import { errorMessage, type ConfigStore } from "@tinkerbell/core";
import { plexUsers, type Db } from "@tinkerbell/db";
import { createLlmClient, type LlmClient, type LlmConfig } from "@tinkerbell/llm";
import type { AiUsage } from "@tinkerbell/domain.ai-usage";
import type { SmartFilterGroup } from "@tinkerbell/plex-smart-filter";
import type { PlexClient } from "@tinkerbell/plex";
import { buildPrompt, DRAFT_SCHEMA } from "./prompt.ts";
import { sanitizeDraft, type Draft, type Vocabulary } from "./sanitize.ts";

export { sanitizeDraft, DRAFTABLE_FIELDS } from "./sanitize.ts";
export { buildPrompt } from "./prompt.ts";

/**
 * Tag fields whose values are listed for the model and checked afterwards.
 * Small facets only: a library's actors run to tens of thousands, so people
 * fields are passed through as written and resolved when the rule runs.
 */
export const CHECKED_TAG_FIELDS = [
  "genre",
  "contentRating",
  "country",
  "resolution",
  "studio",
  "network",
  "label",
  "collection",
] as const;

/** Long enough for a local model to load; short of a reverse proxy's usual minute. */
export const DRAFT_TIMEOUT_MS = 55_000;

/** A draft that can't be made, in words for the wizard. The router makes it a 4xx. */
export class RuleDraftError extends Error {
  readonly notes: string[];
  constructor(message: string, notes: string[] = []) {
    super(message);
    this.name = "RuleDraftError";
    this.notes = notes;
  }
}

export interface RuleDraftsDeps {
  db: Db;
  config: Pick<ConfigStore, "getLlmConfig">;
  aiUsage: Pick<AiUsage, "track" | "budgetExceededReason">;
  plex: (opts?: { signal?: AbortSignal }) => PlexClient;
  now: () => number;
  /** For tests; production builds the configured provider's client. */
  llmClient?: (config: LlmConfig) => LlmClient;
}

export interface DraftResult {
  filter: SmartFilterGroup;
  notes: string[];
  model: string;
  tokensIn: number;
  tokensOut: number;
}

/** The JSON object in a reply, wherever the model put it — fenced, prefixed or bare. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function createRuleDrafts(deps: RuleDraftsDeps) {
  const { db } = deps;
  const buildClient = deps.llmClient ?? createLlmClient;

  /** Why drafting can't be offered right now, or null. Costs no request. */
  function unavailableReason(): string | null {
    const cfg = deps.config.getLlmConfig();
    if (!cfg) return "No AI provider is set up (Settings → AI).";
    try {
      buildClient(cfg as LlmConfig);
    } catch (err) {
      return errorMessage(err);
    }
    return deps.aiUsage.budgetExceededReason();
  }

  async function vocabulary(plex: PlexClient, sectionId: string): Promise<Vocabulary> {
    const tags = new Map<string, string[]>();
    await Promise.all(
      CHECKED_TAG_FIELDS.map(async (field) => {
        // A facet the section's type doesn't have 404s. Recording it as empty
        // means a `network` clause on a film library is dropped, not trusted.
        const values = await plex.getFilterFieldValues(sectionId, field).catch(() => []);
        tags.set(field, values.map((v) => v.title).filter(Boolean));
      }),
    );
    const users = db
      .select({ userId: plexUsers.userId, username: plexUsers.username, name: plexUsers.name })
      .from(plexUsers)
      .all();
    return { tags, users };
  }

  async function draftSmartFilter(input: { description: string; sectionId: string }): Promise<DraftResult> {
    const reason = unavailableReason();
    if (reason) throw new RuleDraftError(reason);
    const cfg = deps.config.getLlmConfig() as LlmConfig;

    const signal = AbortSignal.timeout(DRAFT_TIMEOUT_MS);
    const plex = deps.plex({ signal });
    const section = (await plex.getSections()).find((s) => s.key === input.sectionId);
    if (!section) throw new RuleDraftError("That library is no longer in Plex.");
    const vocab = await vocabulary(plex, section.key);

    const prompt = buildPrompt({
      description: input.description,
      sectionTitle: section.title,
      sectionType: section.type,
      today: new Date(deps.now()).toISOString().slice(0, 10),
      vocab,
    });
    const client = deps.aiUsage.track(buildClient(cfg), { feature: "rule-draft" });
    let res;
    try {
      res = await client.complete({ prompt, jsonSchema: DRAFT_SCHEMA, maxTokens: 1500, temperature: 0.2, signal });
    } catch (err) {
      if (signal.aborted) {
        throw new RuleDraftError(
          `The model took longer than ${DRAFT_TIMEOUT_MS / 1000}s to answer. Try again, or a faster model.`,
        );
      }
      throw new RuleDraftError(`The model couldn't be asked: ${errorMessage(err)}`);
    }

    const parsed = extractJson(res.text);
    if (!parsed || typeof parsed !== "object") {
      throw new RuleDraftError("The model's answer wasn't a filter. Try rewording the description.");
    }
    const { filter, notes } = sanitizeDraft(parsed as Draft, vocab);
    if (filter.children.length === 0) {
      throw new RuleDraftError("Nothing in that description could be turned into a filter.", notes);
    }
    return { filter, notes, model: res.model, tokensIn: res.tokensIn, tokensOut: res.tokensOut };
  }

  return { unavailableReason, draftSmartFilter };
}

export type RuleDrafts = ReturnType<typeof createRuleDrafts>;
export const RuleDraftsToken = token<RuleDrafts>("ruleDrafts");
