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

import { createLlmClient, getProviderMeta, listModels, LlmConfigError, LlmRequestError, PROVIDERS } from "./index.ts";

let server: Server;
let base: string;
let seen: Array<{ path: string; auth?: string; body: unknown }> = [];
let respond: (res: ServerResponse, req: IncomingMessage) => void;

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
      // An aborted request can still emit "end" after the test that made it has
      // finished, which would land in the *next* test's freshly cleared `seen`
      // and make it assert against the wrong request.
      if (req.destroyed) return;
      seen.push({ path: req.url ?? "", auth: req.headers.authorization as string | undefined, body });
      respond(res, req);
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
    // Reasoning models reject any temperature but their default, and qwen's
    // recommended sampling lives in its Modelfile: unset means unsent.
    assert.equal("temperature" in body, false, "no temperature unless one was set");
  });

  test("the cacheable prefix goes first, so a provider's prefix cache can match it", async () => {
    await compatible().complete({ cacheablePrefix: "LIBRARY", prompt: "which?" });
    const body = seen[0]?.body as { messages: Array<{ content: string }> };
    assert.equal(body.messages[0]?.content, "LIBRARY\n\nwhich?");
  });

  test("reports cached prompt tokens where the server does", async () => {
    respond = (res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "x" } }],
          usage: { prompt_tokens: 100, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 80 } },
        }),
      );
    };
    const result = await compatible().complete({ prompt: "hi" });
    assert.equal(result.tokensIn, 100, "every prompt token, cached or not");
    assert.equal(result.tokensInCached, 80);
  });

  test("OpenAI's reasoning models get max_completion_tokens with headroom, and no temperature", async () => {
    const client = createLlmClient({
      provider: "openai",
      model: "gpt-5",
      apiKey: "k",
      baseUrl: base,
      temperature: 0.3,
    } as never);
    await client.complete({ prompt: "hi", maxTokens: 200 });
    const body = seen[0]?.body as Record<string, unknown>;
    assert.equal(body.max_tokens, undefined);
    assert.equal(body.max_completion_tokens, 200 + 4096);
    assert.equal(body.reasoning_effort, "low");
    assert.equal("temperature" in body, false);
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
    // Abort only once the server has the request in hand: a timer would race
    // the request's arrival, and an abort that lands first leaves the server
    // recording it during a later test.
    let arrived: () => void = () => {};
    const onServer = new Promise<void>((resolve) => (arrived = resolve));
    respond = () => {
      // Never answers — the abort is the only way out.
      arrived();
    };
    const controller = new AbortController();
    const pending = compatible().complete({ prompt: "hi", signal: controller.signal });
    await onServer;
    controller.abort();

    await assert.rejects(() => pending, LlmRequestError);
  });
});

describe("ollama", () => {
  // `/api/show` is cached per base URL and model for the length of a run, so
  // each test names its own model to see its own capabilities.
  let n = 0;
  const fresh = (prefix = "m") => `${prefix}${++n}:8b`;

  type Chunk = Record<string, unknown>;
  const answer = (model: string): Chunk[] => [
    { model, message: { role: "assistant", content: "a coll" }, done: false },
    { model, message: { role: "assistant", content: "ection " }, done: false },
    {
      model,
      message: { role: "assistant", content: "" },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 40,
      eval_count: 3,
    },
  ];

  function ollama(opts: { capabilities?: string[]; contextLength?: number; chunks?: Chunk[]; tags?: string[] } = {}) {
    respond = (res, req) => {
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.url === "/api/show") {
        return json(200, {
          capabilities: opts.capabilities ?? ["completion"],
          model_info: { "general.architecture": "llama", "llama.context_length": opts.contextLength ?? 131072 },
        });
      }
      if (req.url === "/api/tags") return json(200, { models: (opts.tags ?? []).map((name) => ({ name })) });
      if (req.url === "/api/chat") {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        for (const chunk of opts.chunks ?? answer("x")) res.write(`${JSON.stringify(chunk)}\n`);
        return res.end();
      }
      json(404, { error: "not found" });
    };
  }
  const client = (model: string, over: Record<string, unknown> = {}) =>
    createLlmClient({ provider: "ollama", model, baseUrl: base, ...over } as never);
  const chatBody = () => seen.find((s) => s.path === "/api/chat")?.body as Record<string, any>;

  test("talks to the native /api/chat, not the /v1 shim", async () => {
    // The shim cannot set the context window, so long prompts were truncated
    // silently. Everything below depends on being on the native API.
    ollama();
    await client(fresh()).complete({ prompt: "hi" });
    assert.deepEqual(
      seen.map((s) => s.path),
      ["/api/show", "/api/chat"],
    );
    assert.equal(chatBody().stream, true);
  });

  test("strips a /v1 the user pasted from an OpenAI-shim guide", async () => {
    ollama();
    await client(fresh(), { baseUrl: `${base}/v1/` }).complete({ prompt: "hi" });
    assert.equal(seen.at(-1)?.path, "/api/chat");
  });

  test("reassembles the streamed answer and reports itself as ollama", async () => {
    ollama();
    const result = await client(fresh()).complete({ prompt: "hi" });
    assert.equal(result.text, "a collection");
    assert.equal(result.tokensIn, 40);
    assert.equal(result.tokensOut, 3);
    assert.equal(result.provider, "ollama");
  });

  test("sizes the context window to the prompt, in steps that keep the model loaded", async () => {
    ollama();
    await client(fresh()).complete({ prompt: "short" });
    assert.equal(chatBody().options.num_ctx, 8192, "a short prompt gets the floor");

    // ~4,000 film titles: the because-you-watched prompt that used to be cut
    // to the server's default window without a word.
    seen = [];
    const library = "Some Film Title (1999)\n".repeat(4000);
    await client(fresh()).complete({ cacheablePrefix: library, prompt: "which?" });
    const ctx = chatBody().options.num_ctx as number;
    assert.ok(ctx >= Buffer.byteLength(library) / 3 + 4096, `num_ctx ${ctx} cannot hold the prompt`);
    assert.equal(Math.log2(ctx) % 1, 0, "a power of two, so runs reuse a handful of sizes");
  });

  test("never asks for more context than the model has", async () => {
    ollama({ contextLength: 40960 });
    await client(fresh()).complete({ prompt: "x".repeat(90_000) });
    assert.equal(chatBody().options.num_ctx, 40960);
  });

  test("refuses a prompt the model cannot hold, before sending it", async () => {
    // Sending it would be a 200 with an answer to whatever survived truncation.
    ollama({ contextLength: 8192 });
    await assert.rejects(
      () => client(fresh()).complete({ prompt: "x".repeat(60_000) }),
      (err: Error) => err instanceof LlmRequestError && /context/.test(err.message),
    );
    assert.equal(chatBody(), undefined, "nothing was sent to /api/chat");
  });

  test("turns thinking off where the model allows it, and budgets for it", async () => {
    ollama({ capabilities: ["completion", "thinking"] });
    await client(fresh("qwen3-")).complete({ prompt: "hi", maxTokens: 200 });
    assert.equal(chatBody().think, false);
    assert.equal(chatBody().options.num_predict, 200 + 4096);
  });

  test("gpt-oss cannot stop thinking, so it is asked to think less", async () => {
    ollama({ capabilities: ["completion", "thinking"] });
    await client(fresh("gpt-oss-")).complete({ prompt: "hi" });
    assert.equal(chatBody().think, "low");
  });

  test("a model that does not think is not sent the parameter at all", async () => {
    ollama();
    await client(fresh()).complete({ prompt: "hi", maxTokens: 200 });
    assert.equal("think" in chatBody(), false);
    assert.equal(chatBody().options.num_predict, 200);
  });

  test("an answer lost to reasoning fails, and says so", async () => {
    ollama({
      capabilities: ["completion", "thinking"],
      chunks: [
        { message: { content: "", thinking: "Let me consider" }, done: false },
        { message: { content: "" }, done: true, done_reason: "length", eval_count: 4296 },
      ],
    });
    await assert.rejects(() => client(fresh("gpt-oss-")).complete({ prompt: "hi" }), /reasoning/);
  });

  test("passes a JSON schema through as format", async () => {
    ollama();
    const schema = { type: "array", items: { type: "string" } };
    await client(fresh()).complete({ prompt: "hi", jsonSchema: schema });
    assert.deepEqual(chatBody().format, schema);
  });

  test("puts the cacheable prefix first, where Ollama's KV cache can reuse it", async () => {
    ollama();
    await client(fresh()).complete({ cacheablePrefix: "LIBRARY", prompt: "which?" });
    assert.equal(chatBody().messages[0].content, "LIBRARY\n\nwhich?");
  });

  test("only sends a temperature that was configured", async () => {
    ollama();
    await client(fresh()).complete({ prompt: "hi" });
    assert.equal("temperature" in chatBody().options, false);
  });

  test("an error mid-stream is surfaced", async () => {
    ollama({ chunks: [{ error: "model requires more system memory (12.1 GiB) than is available" }] });
    await assert.rejects(() => client(fresh()).complete({ prompt: "hi" }), /system memory/);
  });

  test("a model that isn't pulled says how to fix it", async () => {
    respond = (res) => {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "model not found" }));
    };
    await assert.rejects(() => client(fresh()).complete({ prompt: "hi" }), /ollama pull/);
  });

  test("sends a placeholder key rather than no auth at all", async () => {
    // Ollama ignores it; an authenticating proxy in front of it may not.
    ollama();
    await client(fresh()).complete({ prompt: "hi" });
    assert.equal(seen.at(-1)?.auth, "Bearer ollama");
  });

  test("ping lists the pulled models and generates nothing", async () => {
    // A generation every minute kept a 13GB model resident on the GPU.
    ollama({ tags: ["llama3.1:latest", "gpt-oss:20b"] });
    await client("gpt-oss:20b").ping();
    await client("llama3.1").ping(); // `:latest` is implied
    assert.deepEqual(new Set(seen.map((s) => s.path)), new Set(["/api/tags"]));
  });

  test("ping fails on a model that isn't pulled, naming the ones that are", async () => {
    ollama({ tags: ["qwen3:14b"] });
    await assert.rejects(
      () => client("gpt-oss:20b").ping(),
      (err: Error) => /qwen3:14b/.test(err.message) && /ollama pull gpt-oss:20b/.test(err.message),
    );
  });

  test("listModels returns what the server has pulled", async () => {
    ollama({ tags: ["qwen3:14b", "gemma3:12b"] });
    assert.deepEqual(await listModels({ provider: "ollama", baseUrl: base }), ["qwen3:14b", "gemma3:12b"]);
    assert.equal(await listModels({ provider: "anthropic" }), null, "hosted providers keep their presets");
  });
});

describe("anthropic", () => {
  // The real SDK, pointed at the local server.
  const message = (over: Record<string, unknown> = {}) => ({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-5-20250929",
    content: [{ type: "text", text: "  an answer  " }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 50, output_tokens: 7, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    ...over,
  });
  const anthropic = (model = "claude-sonnet-4-5-20250929", over: Record<string, unknown> = {}) =>
    createLlmClient({ provider: "anthropic", model, apiKey: "sk-ant-test", baseUrl: base, ...over } as never);
  const answerWith = (body: unknown) => {
    respond = (res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
  };

  test("marks the cacheable prefix as its own cached block", async () => {
    // The fix for the nightly bill: because-you-watched sends the same
    // library once per watched title, and only a cached prefix stops each of
    // those calls paying for it in full.
    answerWith(message());
    await anthropic().complete({ cacheablePrefix: "LIBRARY", prompt: "which?" });
    const body = seen[0]?.body as { messages: Array<{ content: Array<Record<string, unknown>> }> };
    assert.deepEqual(body.messages[0]?.content, [
      { type: "text", text: "LIBRARY", cache_control: { type: "ephemeral" } },
      { type: "text", text: "which?" },
    ]);
  });

  test("counts cached prompt tokens as sent, and reports how many were cached", async () => {
    answerWith(
      message({
        usage: { input_tokens: 20, output_tokens: 7, cache_read_input_tokens: 25_000, cache_creation_input_tokens: 0 },
      }),
    );
    const result = await anthropic().complete({ cacheablePrefix: "LIBRARY", prompt: "which?" });
    assert.equal(result.text, "an answer");
    assert.equal(result.tokensIn, 25_020);
    assert.equal(result.tokensInCached, 25_000);
  });

  test("a Claude 5 model gets reasoning headroom, low effort and no temperature", async () => {
    // Sampling parameters are a 400 on this family, and thinking comes out of
    // max_tokens: the summary's 200 would be spent before any answer.
    answerWith(message({ model: "claude-opus-5-5" }));
    await anthropic("claude-opus-5-5", { temperature: 0.5 }).complete({ prompt: "hi", maxTokens: 200 });
    const body = seen[0]?.body as Record<string, unknown>;
    assert.equal(body.max_tokens, 200 + 4096);
    assert.deepEqual(body.output_config, { effort: "low" });
    assert.equal("temperature" in body, false);
  });

  test("a 4.x model gets the plain budget, and a temperature only when one is set", async () => {
    answerWith(message());
    await anthropic().complete({ prompt: "hi", maxTokens: 200 });
    let body = seen[0]?.body as Record<string, unknown>;
    assert.equal(body.max_tokens, 200);
    assert.equal("temperature" in body, false);
    assert.equal("output_config" in body, false);

    seen = [];
    await anthropic(undefined, { temperature: 0.4 }).complete({ prompt: "hi" });
    body = seen[0]?.body as Record<string, unknown>;
    assert.equal(body.temperature, 0.4);
  });

  test("an answer cut off by the token limit says so", async () => {
    answerWith(message({ content: [], stop_reason: "max_tokens" }));
    await assert.rejects(() => anthropic().complete({ prompt: "hi" }), /token limit/);
  });

  test("ping looks the model up rather than generating", async () => {
    answerWith({ type: "model", id: "claude-sonnet-4-5-20250929", display_name: "Claude Sonnet 4.5" });
    await anthropic().ping();
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.path, "/v1/models/claude-sonnet-4-5-20250929");
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
  // The health check pings every minute. A ping that generates is a billed
  // request a minute on a hosted provider, and on a reasoning model a one-token
  // generation comes back empty — which is how a working gpt-oss setup failed
  // "Test connection".
  const models = (ids: string[]) => (res: ServerResponse, req: IncomingMessage) => {
    if (req.url !== "/models") {
      res.writeHead(500);
      return res.end();
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: ids.map((id) => ({ id, object: "model" })) }));
  };

  test("lists models and generates nothing", async () => {
    respond = models(["other", "test-model"]);
    await compatible().ping();
    assert.deepEqual(
      seen.map((s) => s.path),
      ["/models"],
    );
  });

  test("fails on a model the server doesn't have, naming some it does", async () => {
    respond = models(["llama-3.3-70b", "qwen3-32b"]);
    await assert.rejects(
      () => compatible().ping(),
      (err: Error) => err instanceof LlmRequestError && /test-model/.test(err.message) && /qwen3-32b/.test(err.message),
    );
  });

  test("passes a server that answers but doesn't enumerate its models", async () => {
    respond = models([]);
    await compatible().ping();
  });

  test("an auth failure on the listing is a failure", async () => {
    respond = (res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Incorrect API key provided" } }));
    };
    await assert.rejects(() => compatible().ping(), /Incorrect API key/);
  });

  // What a reasoning model returns for `max_tokens: 1`: the one token went to
  // reasoning, so `content` is empty.
  const reasoningOnly = (res: ServerResponse) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        model: "gpt-oss:20b",
        choices: [{ message: { role: "assistant", content: "", reasoning: "We" }, finish_reason: "length" }],
        usage: { prompt_tokens: 68, completion_tokens: 1 },
      }),
    );
  };
  const noModelsEndpoint = (then: (res: ServerResponse) => void) => (res: ServerResponse, req: IncomingMessage) => {
    if (req.url === "/models") {
      res.writeHead(404);
      return res.end();
    }
    then(res);
  };

  test("without /models, falls back to one token — and a reasoning model's empty answer still passes", async () => {
    respond = noModelsEndpoint(reasoningOnly);
    await compatible().ping();
    assert.deepEqual(
      seen.map((s) => s.path),
      ["/models", "/chat/completions"],
    );
    assert.equal((seen[1]!.body as Record<string, number>).max_tokens, 1);
  });

  test("the fallback still fails a 200 with no choice in it", async () => {
    respond = noModelsEndpoint((res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [] }));
    });
    await assert.rejects(() => compatible().ping(), LlmRequestError);
  });

  test("a real completion that ran out thinking still fails, and says why", async () => {
    // Only the ping is lenient: an empty answer to a rule's prompt has to fail
    // the run, not build an empty collection.
    respond = reasoningOnly;
    await assert.rejects(
      () => compatible().complete({ prompt: "hi" }),
      (err: Error) => err instanceof LlmRequestError && /reasoning/.test(err.message),
    );
  });

  test("Gemini looks the model up, and a missing one is named", async () => {
    const gemini = createLlmClient({
      provider: "gemini",
      model: "gemini-2.5-pro",
      apiKey: "g-key",
      baseUrl: base,
    } as never);
    respond = (res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ name: "models/gemini-2.5-pro" }));
    };
    await gemini.ping();
    assert.match(seen[0]?.path ?? "", /^\/v1beta\/models\/gemini-2\.5-pro\?key=/);

    respond = (res) => {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
    };
    await assert.rejects(() => gemini.ping(), /gemini-2\.5-pro" was not found/);
  });

  test("a Gemini thinking model's answer lost to the token limit says why", async () => {
    respond = (res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ candidates: [{ content: { role: "model" }, finishReason: "MAX_TOKENS" }] }));
    };
    const gemini = createLlmClient({
      provider: "gemini",
      model: "gemini-2.5-pro",
      apiKey: "g-key",
      baseUrl: base,
    } as never);
    await assert.rejects(() => gemini.complete({ prompt: "hi" }), /token limit/);
  });
});
