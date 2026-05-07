import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { REDACTED_SECRET, redactSecrets } from "./config.ts";

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
