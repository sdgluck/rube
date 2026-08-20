/**
 * Four hand-written response parsers over four different JSON shapes, and no
 * tests at all.
 *
 * The shapes are not ours and change without notice, so the failure that
 * matters is not "the parser is wrong today" but "the parser stops telling us
 * when it becomes wrong". Each of these providers has a way of returning a 200
 * with nothing usable in it — a refusal with no content, a candidate with no
 * parts, an empty choices array — and the difference between throwing and
 * returning `""` is the difference between a job that fails visibly and a rule
 * that quietly generates an empty collection every night.
 *
 * The three OpenAI-compatible providers all take a base URL, so they are driven
 * against a real server. Anthropic goes through its SDK and Gemini's key is in
 * the query string; both are covered here for configuration and error mapping
 * rather than transport.
 */
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { after, before, beforeEach, describe, test } from "node:test";

import { createLlmClient, getProviderMeta, LlmConfigError, LlmRequestError, PROVIDERS } from "./index.ts";

let server: Server;
let base: string;
let seen: Array<{ path: string; auth?: string; body: unknown }> = [];
let respond: (res: ServerResponse) => void;

before(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      let body: unknown;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = raw;
      }
      seen.push({ path: req.url ?? "", auth: req.headers.authorization as string | undefined, body });
      respond(res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

after(() => {
  server.close();
  server.closeAllConnections();
});

beforeEach(() => {
  seen = [];
  respond = (res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        model: "test-model",
        choices: [{ message: { content: "  a collection idea  " } }],
        usage: { prompt_tokens: 11, completion_tokens: 22 },
      }),
    );
  };
});

const compatible = (over: Record<string, unknown> = {}) =>
  createLlmClient({ provider: "openai-compatible", model: "test-model", baseUrl: base, ...over } as never);

describe("provider selection", () => {
  test("every provider in the metadata can actually be constructed", () => {
    // The Settings page renders from `PROVIDERS`, so a provider listed there
    // but missing from the factory's switch is a dropdown entry that throws
    // "Unknown LLM provider" when it is picked.
    for (const meta of PROVIDERS) {
      const config = {
        provider: meta.id,
        model: meta.defaultModel || "some-model",
        apiKey: meta.fields.apiKey === "hidden" ? undefined : "test-key",
        baseUrl: meta.fields.baseUrl === "required" ? base : undefined,
      };
      assert.doesNotThrow(() => createLlmClient(config as never), meta.id);
    }
  });

  test("an unknown provider is refused rather than silently defaulted", () => {
    assert.throws(() => createLlmClient({ provider: "hal9000", model: "x" } as never), LlmConfigError);
  });

  test("getProviderMeta refuses an unknown id", () => {
    assert.throws(() => getProviderMeta("hal9000" as never), /Unknown LLM provider/);
  });

  test("each provider's metadata is self-consistent", () => {
    const ids = PROVIDERS.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate provider id");

    for (const meta of PROVIDERS) {
      assert.equal(getProviderMeta(meta.id).id, meta.id);
      // A provider that requires a base URL and offers no default leaves the
      // field blank in Settings with nothing to suggest.
      if (meta.fields.baseUrl === "required" && meta.id !== "openai-compatible") {
        assert.ok(meta.defaultBaseUrl, `${meta.id} requires a base URL but suggests none`);
      }
      for (const preset of meta.modelPresets) {
        assert.ok(preset.id.length > 0, `${meta.id} has a nameless model preset`);
      }
    }
  });
});

describe("configuration errors", () => {
  test("a provider that needs a key says so, by name", () => {
    for (const provider of ["anthropic", "openai", "gemini"] as const) {
      assert.throws(
        () => createLlmClient({ provider, model: "m" } as never),
        (err: unknown) => {
          assert.ok(err instanceof LlmConfigError);
          assert.match(err.message.toLowerCase(), new RegExp(provider));
          return true;
        },
        provider,
      );
    }
  });

  test("a provider that needs a model says so", () => {
    assert.throws(
      () => createLlmClient({ provider: "openai-compatible", model: "", baseUrl: base } as never),
      /model/i,
    );
    assert.throws(() => createLlmClient({ provider: "gemini", model: "", apiKey: "k" } as never), /model/i);
  });

  test("openai-compatible needs a base URL", () => {
    assert.throws(
      () => createLlmClient({ provider: "openai-compatible", model: "m", baseUrl: "" } as never),
      /base URL/i,
    );
  });

  test("ollama needs neither a key nor an explicit base URL", () => {
    // It is the self-hosted option; requiring a key would be nonsense.
    assert.doesNotThrow(() => createLlmClient({ provider: "ollama", model: "llama3.1:8b" } as never));
  });
});

describe("the OpenAI-compatible response", () => {
  test("returns the text, trimmed, with usage and model", async () => {
    const result = await compatible().complete({ prompt: "hello" });

    assert.equal(result.text, "a collection idea");
    assert.equal(result.tokensIn, 11);
    assert.equal(result.tokensOut, 22);
    assert.equal(result.model, "test-model");
    assert.equal(result.provider, "openai-compatible");
  });

  test("sends the prompt to /chat/completions", async () => {
    await compatible().complete({ prompt: "hello" });

    assert.equal(seen[0]?.path, "/chat/completions");
    const body = seen[0]?.body as { messages: Array<{ role: string; content: string }> };
    assert.deepEqual(body.messages, [{ role: "user", content: "hello" }]);
  });

  test("a trailing slash on the base URL does not double up", async () => {
    await compatible({ baseUrl: `${base}///` }).complete({ prompt: "hi" });
    assert.equal(seen[0]?.path, "/chat/completions");
  });

  test("a key is sent as a bearer token, and omitted when absent", async () => {
    await compatible({ apiKey: "sk-test" }).complete({ prompt: "hi" });
    assert.equal(seen[0]?.auth, "Bearer sk-test");

    seen = [];
    await compatible().complete({ prompt: "hi" });
    assert.equal(seen[0]?.auth, undefined);
  });

  test("maxTokens and temperature come from the request, then the config, then a default", async () => {
    await compatible({ maxTokens: 100, temperature: 0.2 }).complete({ prompt: "hi" });
    let body = seen[0]?.body as Record<string, number>;
    assert.equal(body.max_tokens, 100);
    assert.equal(body.temperature, 0.2);

    seen = [];
    await compatible({ maxTokens: 100 }).complete({ prompt: "hi", maxTokens: 5, temperature: 0 });
    body = seen[0]?.body as Record<string, number>;
    assert.equal(body.max_tokens, 5, "the request wins");
    assert.equal(body.temperature, 0);

    seen = [];
    await compatible().complete({ prompt: "hi" });
    body = seen[0]?.body as Record<string, number>;
    assert.equal(body.max_tokens, 4096, "the default");
  });

  test("a 200 with no usable content throws rather than returning empty text", async () => {
    // The important one. An empty string flows on to the prompt parser, which
    // finds no collections and writes none — a rule that quietly does nothing
    // every night, with a green run behind it.
    const empties = [
      { model: "m", choices: [] },
      { model: "m", choices: [{ message: {} }] },
      { model: "m", choices: [{ message: { content: null } }] },
      { model: "m", choices: [{ message: { content: "   " } }] },
      {},
    ];

    for (const payload of empties) {
      respond = (res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      await assert.rejects(() => compatible().complete({ prompt: "hi" }), LlmRequestError, JSON.stringify(payload));
    }
  });

  test("missing usage counts read as zero rather than undefined", async () => {
    respond = (res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ model: "m", choices: [{ message: { content: "text" } }] }));
    };

    const result = await compatible().complete({ prompt: "hi" });
    assert.equal(result.tokensIn, 0);
    assert.equal(result.tokensOut, 0);
  });

  test("an error status is surfaced with the provider's own message", async () => {
    respond = (res) => {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Rate limit reached for gpt-4o" } }));
    };

    await assert.rejects(
      () => compatible().complete({ prompt: "hi" }),
      (err: unknown) => {
        assert.ok(err instanceof LlmRequestError);
        assert.equal(err.status, 429);
        assert.match(err.message, /Rate limit reached/);
        return true;
      },
    );
  });

  test("a non-JSON error body still produces a usable error", async () => {
    // A reverse proxy in front of a local model answers with HTML.
    respond = (res) => {
      res.writeHead(502, { "Content-Type": "text/html" });
      res.end("<html>Bad Gateway</html>");
    };

    await assert.rejects(() => compatible().complete({ prompt: "hi" }), LlmRequestError);
  });

  test("a transport failure becomes an LlmRequestError, not a bare fetch error", async () => {
    const unreachable = createLlmClient({
      provider: "openai-compatible",
      model: "m",
      baseUrl: "http://127.0.0.1:1",
    } as never);

    await assert.rejects(() => unreachable.complete({ prompt: "hi" }), LlmRequestError);
  });

  test("the caller's abort signal cancels the request", async () => {
    respond = () => {
      // Never answers — the abort is the only way out.
    };
    const controller = new AbortController();
    const pending = compatible().complete({ prompt: "hi", signal: controller.signal });
    setTimeout(() => controller.abort(), 20);

    await assert.rejects(() => pending, LlmRequestError);
  });
});

describe("ollama", () => {
  test("targets the OpenAI-compatible endpoint under /v1", async () => {
    const client = createLlmClient({ provider: "ollama", model: "llama3.1:8b", baseUrl: base } as never);
    await client.complete({ prompt: "hi" });
    assert.equal(seen[0]?.path, "/v1/chat/completions");
  });

  test("does not add /v1 twice when the user already typed it", async () => {
    const client = createLlmClient({ provider: "ollama", model: "llama3.1:8b", baseUrl: `${base}/v1` } as never);
    await client.complete({ prompt: "hi" });
    assert.equal(seen[0]?.path, "/v1/chat/completions");
  });

  test("reports itself as ollama, not as openai-compatible", async () => {
    // The provider name lands in health reports and the event log; reporting
    // the wrong one sends the user to the wrong settings tab.
    const client = createLlmClient({ provider: "ollama", model: "llama3.1:8b", baseUrl: base } as never);
    assert.equal(client.provider, "ollama");
    assert.equal((await client.complete({ prompt: "hi" })).provider, "ollama");
  });

  test("sends a placeholder key rather than no auth at all", async () => {
    // Ollama ignores it; an OpenAI-compatible proxy in front of it may not.
    const client = createLlmClient({ provider: "ollama", model: "llama3.1:8b", baseUrl: base } as never);
    await client.complete({ prompt: "hi" });
    assert.equal(seen[0]?.auth, "Bearer ollama");
  });
});

describe("gemini", () => {
  const gemini = () =>
    createLlmClient({ provider: "gemini", model: "gemini-2.5-pro", apiKey: "g-key", baseUrl: base } as never);

  test("joins every text part of the first candidate", async () => {
    // Gemini splits a response across parts; taking only the first truncates
    // the answer, which for a prompt asking for JSON means an unparseable one.
    respond = (res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "one " }, { text: "two" }] } }],
          usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
          modelVersion: "gemini-2.5-pro-001",
        }),
      );
    };

    const result = await gemini().complete({ prompt: "hi" });
    assert.equal(result.text, "one two");
    assert.equal(result.tokensIn, 3);
    assert.equal(result.model, "gemini-2.5-pro-001", "the version actually used");
  });

  test("a candidate with no parts throws", async () => {
    // What a safety refusal looks like: 200, a candidate, nothing in it.
    for (const payload of [{ candidates: [] }, { candidates: [{ content: {} }] }, {}]) {
      respond = (res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      await assert.rejects(() => gemini().complete({ prompt: "hi" }), LlmRequestError, JSON.stringify(payload));
    }
  });

  test("an error body's message is preferred over the status line", async () => {
    respond = (res) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "API key not valid" } }));
    };

    await assert.rejects(() => gemini().complete({ prompt: "hi" }), /API key not valid/);
  });

  test("the model name is URL-encoded into the path", async () => {
    respond = (res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: "x" }] } }] }));
    };

    const client = createLlmClient({
      provider: "gemini",
      model: "models/weird one",
      apiKey: "g-key",
      baseUrl: base,
    } as never);
    await client.complete({ prompt: "hi" });

    assert.match(seen[0]?.path ?? "", /models%2Fweird%20one/);
  });

  test("falls back to the configured model when the response omits one", async () => {
    respond = (res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: "x" }] } }] }));
    };

    assert.equal((await gemini().complete({ prompt: "hi" })).model, "gemini-2.5-pro");
  });
});

describe("ping", () => {
  test("asks for a single token, so a health check costs nothing", async () => {
    await compatible().ping();
    const body = seen[0]?.body as Record<string, number>;
    assert.equal(body.max_tokens, 1);
  });
});
