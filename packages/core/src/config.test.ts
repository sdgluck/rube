import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { configSchema, NESTED_SECRETS, REDACTED_SECRET, redactSecrets, SECRET_KEYS } from "./config.ts";

/**
 * The field names one level inside a structured config value — the object's own
 * keys, or its elements' keys when it is a list. Reads zod's `def` rather than
 * a hand-maintained list, because a hand-maintained list is the thing that went
 * out of date.
 */
function nestedFieldNames(schema: unknown): string[] {
  let def = (schema as { def?: Record<string, unknown> })?.def;
  // Unwrap optional/default/nullable until something structural turns up.
  while (def && typeof def.type === "string" && ["optional", "default", "nullable"].includes(def.type)) {
    def = (def.innerType as { def?: Record<string, unknown> })?.def;
  }
  if (!def) return [];
  if (def.type === "array") return nestedFieldNames(def.element);
  if (def.type === "object") return Object.keys((def.shape ?? {}) as Record<string, unknown>);
  return [];
}

describe("redactSecrets", () => {
  test("replaces top-level secret strings with the sentinel", () => {
    const out = redactSecrets({
      global_plex_token: "tk-secret",
      global_radarr_api_key: "rad-key",
      global_omdb_api_key: "omdb-key",
      global_plex_url: "http://plex.local",
    });
    assert.equal(out.global_plex_token, REDACTED_SECRET);
    assert.equal(out.global_radarr_api_key, REDACTED_SECRET);
    assert.equal(out.global_omdb_api_key, REDACTED_SECRET);
    // Non-secret values pass through.
    assert.equal(out.global_plex_url, "http://plex.local");
  });

  test("redacts webhook URLs (they typically contain bearer tokens)", () => {
    const out = redactSecrets({
      global_discord_webhook_url: "https://discord.com/api/webhooks/123/abc",
      global_slack_webhook_url: "https://hooks.slack.com/services/abc/def",
      global_lunasea_webhook_url: "https://notify.lunasea.app/v1/custom/xxx",
      global_webhook_url: "https://example.com/webhook?token=zzz",
    });
    assert.equal(out.global_discord_webhook_url, REDACTED_SECRET);
    assert.equal(out.global_slack_webhook_url, REDACTED_SECRET);
    assert.equal(out.global_lunasea_webhook_url, REDACTED_SECRET);
    assert.equal(out.global_webhook_url, REDACTED_SECRET);
  });

  test("redacts the nested global_llm.apiKey while keeping other LLM fields", () => {
    const out = redactSecrets({
      global_llm: {
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
        apiKey: "sk-ant-…",
      },
    });
    assert.equal(out.global_llm?.apiKey, REDACTED_SECRET);
    assert.equal(out.global_llm?.provider, "anthropic");
    assert.equal(out.global_llm?.model, "claude-sonnet-4-5-20250929");
  });

  test("redacts the apiKey of every extra *Arr instance", () => {
    const out = redactSecrets({
      global_arr_instances: [
        { id: "a", service: "radarr", name: "4K", url: "http://radarr-4k:7878", apiKey: "key-4k" },
        { id: "b", service: "sonarr", name: "Anime", url: "http://sonarr-anime:8989", apiKey: "key-anime" },
      ],
    });
    assert.deepEqual(
      out.global_arr_instances?.map((i) => i.apiKey),
      [REDACTED_SECRET, REDACTED_SECRET],
    );
    // Everything the picker needs still comes through.
    assert.deepEqual(
      out.global_arr_instances?.map((i) => i.name),
      ["4K", "Anime"],
    );
  });

  test("every secret-shaped leaf in the schema is covered by one of the two tables", () => {
    // The guard the multi-instance *Arr change needed: a new key whose name
    // says "secret" must be listed somewhere, or it ships to the browser. The
    // failure mode is silent, so the schema is walked rather than trusted.
    // Suffix-anchored: a stored hash (`…_token_hash`) is not a secret, and
    // `maxTokens` is not a token.
    const SECRET_KEY_SHAPED = /(_token|_api_key|_password|_secret|_webhook_url|_user_key)$/i;
    const SECRET_FIELD_SHAPED = /^(apikey|token|bottoken|accesstoken|password|secret|webhookurl)$/;
    const missing: string[] = [];

    for (const [key, shape] of Object.entries(configSchema.shape)) {
      const nested = NESTED_SECRETS.filter((n) => n.key === key);
      if (SECRET_KEY_SHAPED.test(key) && !SECRET_KEYS.has(key as never) && !nested.length) {
        missing.push(key);
      }
      // Object and array values can hide one a level down.
      for (const field of nestedFieldNames(shape)) {
        if (!SECRET_FIELD_SHAPED.test(field.toLowerCase().replaceAll("_", ""))) continue;
        if (!nested.some((n) => n.field === field)) missing.push(`${key}.${field}`);
      }
    }

    assert.deepEqual(
      missing,
      [],
      `these look like secrets but are sent to the browser as stored — add them to ` +
        `SECRET_KEYS or NESTED_SECRETS:\n  ${missing.join("\n  ")}`,
    );
  });

  test("leaves empty strings and missing values alone (don't show a sentinel for unset secrets)", () => {
    const out = redactSecrets({ global_plex_token: "", global_radarr_api_key: undefined as unknown as string });
    assert.equal(out.global_plex_token, "");
    assert.equal(out.global_radarr_api_key, undefined);
  });

  test("doesn't mutate the input object", () => {
    const input = {
      global_plex_token: "tk-secret",
      global_llm: { provider: "anthropic" as const, model: "x", apiKey: "sk-x" },
    };
    redactSecrets(input);
    assert.equal(input.global_plex_token, "tk-secret");
    assert.equal(input.global_llm.apiKey, "sk-x");
  });
});
