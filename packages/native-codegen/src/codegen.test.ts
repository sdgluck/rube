/**
 * The emitters on hand-made schemas, one per shape the contract uses.
 *
 * These assert on the generated source because that is the artifact — the
 * Swift side is also compiled and decoded against in `TinkerbellModelsTests`,
 * which is where "it actually parses JSON" is proven. Here the question is
 * narrower: did each zod shape become the native construct it should?
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { buildDocument, type ProcedureSource } from "./collect.ts";
import { fromJsonSchema, SchemaError } from "./ir.ts";
import { emitKotlin } from "./kotlin.ts";
import { emitSwift } from "./swift.ts";

const int = () => z.number().meta({ format: "int64" });

function emit(sources: Array<Partial<ProcedureSource> & { output: z.ZodType | null }>) {
  const doc = buildDocument(
    sources.map((s, i) => ({ router: "portal", path: `p${i}`, kind: "query", input: undefined, ...s })),
  );
  return { doc, swift: emitSwift(doc), kotlin: emitKotlin(doc) };
}

describe("numbers", () => {
  test("int() is an integer natively, a plain number is a double", () => {
    const { swift, kotlin } = emit([{ output: z.object({ count: int(), rating: z.number() }) }]);
    assert.match(swift, /public var count: Int\n/);
    assert.match(swift, /public var rating: Double\n/);
    assert.match(kotlin, /val count: Long,/);
    assert.match(kotlin, /val rating: Double,/);
  });

  test("z.number().int() on an input is an integer too", () => {
    const { swift } = emit([{ input: z.object({ limit: z.number().int() }), output: null }]);
    assert.match(swift, /public var limit: Int\n/);
  });
});

describe("absence and null", () => {
  const out = z.object({ a: z.string().optional(), b: z.string().nullable(), c: z.string().nullable().optional() });

  test("all three are optional in Swift, but only the absent-allowed ones are omitted when encoding", () => {
    const { swift } = emit([{ output: out }]);
    assert.match(swift, /public var a: String\?\n/);
    assert.match(swift, /public var b: String\?\n/);
    assert.match(swift, /try c\.encodeIfPresent\(a, forKey: \.a\)/);
    // Required-nullable: always written, so "clear my vote" sends null.
    assert.match(swift, /try c\.encode\(b, forKey: \.b\)/);
    assert.match(swift, /try c\.encodeIfPresent\(c, forKey: \.c\)/);
  });

  test("in Kotlin only absent-allowed properties default to null", () => {
    const { kotlin } = emit([{ output: out }]);
    assert.match(kotlin, /val a: String\? = null,/);
    assert.match(kotlin, /val b: String\?,/);
    assert.match(kotlin, /val c: String\? = null,/);
  });
});

describe("enums", () => {
  test("keep an unknown case, so a newer server's value still decodes", () => {
    const { swift, kotlin } = emit([{ output: z.object({ state: z.enum(["item-added", "new_to_me", "3d"]) }) }]);
    assert.match(swift, /case itemAdded\n/);
    assert.match(swift, /case newToMe\n/);
    assert.match(swift, /case v3d\n/);
    assert.match(swift, /case unknown\(String\)/);
    assert.match(swift, /case "item-added": self = \.itemAdded/);
    assert.match(kotlin, /ITEM_ADDED\("item-added"\),/);
    assert.match(kotlin, /V_3D\("3d"\),/);
    assert.match(kotlin, /\?: UNKNOWN/);
  });

  test("a value literally called unknown doesn't collide with the fallback", () => {
    const { swift } = emit([{ output: z.enum(["known", "unknown"]) }]);
    assert.match(swift, /case unknownValue\n/);
  });
});

describe("discriminated unions", () => {
  const signedIn = z.object({ status: z.literal("ok"), token: z.string() }).meta({ id: "SignedInFixture" });
  const exchange = z.discriminatedUnion("status", [z.object({ status: z.literal("open") }), signedIn]);

  test("become an enum with a case per tag, reusing a shared shape as a payload", () => {
    const { swift, kotlin, doc } = emit([{ output: exchange }]);
    assert.deepEqual(
      doc.defs.map((d) => d.name),
      ["SignedInFixture"],
    );
    assert.match(swift, /case `open`\(Open\)/);
    assert.match(swift, /case ok\(SignedInFixture\)/);
    assert.match(swift, /case "ok": self = \.ok\(try SignedInFixture\(from: decoder\)\)/);
    assert.match(kotlin, /data class Ok\(val value: SignedInFixture\) : P0Output/);
    assert.match(
      kotlin,
      /"ok" -> Ok\(input\.json\.decodeFromJsonElement\(SignedInFixture\.serializer\(\), element\)\)/,
    );
  });

  test("a boolean tag gets readable case names", () => {
    const rescan = z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), runId: z.string() }),
      z.object({ ok: z.literal(false), reason: z.string() }),
    ]);
    const { swift } = emit([{ output: rescan }]);
    assert.match(swift, /case okTrue\(OkTrue\)/);
    assert.match(swift, /case okFalse\(OkFalse\)/);
    assert.match(swift, /switch try c\.decode\(Bool\.self, forKey: key\)/);
  });

  test("a union with nothing to tell its members apart is refused, not guessed", () => {
    const json = z.toJSONSchema(z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]));
    assert.throws(() => fromJsonSchema(json as Record<string, unknown>, "fixture"), SchemaError);
  });
});

describe("naming", () => {
  test("inline objects nest under their property, singular for lists", () => {
    const { swift, kotlin } = emit([
      { output: z.object({ members: z.array(z.object({ name: z.string() })), me: z.object({ name: z.string() }) }) },
    ]);
    assert.match(swift, /public struct Member: Codable/);
    assert.match(swift, /public var members: \[Member\]/);
    assert.match(swift, /public struct Me: Codable/);
    assert.match(kotlin, /val members: List<Member>,/);
  });

  test("a top-level list of objects names its element Item", () => {
    const { swift, kotlin } = emit([{ path: "leavingSoon", output: z.array(z.object({ title: z.string() })) }]);
    assert.match(swift, /public struct LeavingSoonItem: Codable/);
    assert.match(swift, /public typealias LeavingSoonOutput = \[LeavingSoonItem\]/);
    assert.match(kotlin, /ListSerializer\(Portal\.LeavingSoonItem\.serializer\(\)\)/);
  });

  test("dotted keys become camelCase properties that still decode their key", () => {
    const { swift, kotlin } = emit([{ output: z.object({ "tab.match": z.boolean(), default: z.boolean() }) }]);
    assert.match(swift, /case tabMatch = "tab\.match"/);
    assert.match(swift, /public var `default`: Bool/);
    assert.match(kotlin, /@SerialName\("tab\.match"\) val tabMatch: Boolean,/);
  });

  test("a record is a dictionary, unknown is a JSON value", () => {
    const { swift, kotlin } = emit([
      { output: z.object({ pins: z.record(z.string(), z.array(z.string())), meta: z.unknown() }) },
    ]);
    assert.match(swift, /public var pins: \[String: \[String\]\]/);
    assert.match(swift, /public var meta: JSONValue\?/);
    assert.match(kotlin, /val pins: Map<String, List<String>>,/);
  });
});

describe("endpoints", () => {
  test("each procedure gets one, with NoInput/NoOutput where it takes or answers nothing", () => {
    const { swift, kotlin } = emit([
      {
        path: "match.deck",
        kind: "query",
        input: z.object({ code: z.string() }),
        output: z.object({ remaining: int() }),
      },
      { path: "match.leave", kind: "mutation", input: z.object({ code: z.string() }), output: null },
    ]);
    assert.match(
      swift,
      /static let matchDeck = Endpoint<Portal\.MatchDeckInput, Portal\.MatchDeckOutput>\(path: "match\.deck", kind: \.query\)/,
    );
    assert.match(
      swift,
      /static let matchLeave = Endpoint<Portal\.MatchLeaveInput, NoOutput>\(path: "match\.leave", kind: \.mutation\)/,
    );
    assert.match(
      kotlin,
      /val matchLeave = Endpoint\("match\.leave", Endpoint\.Kind\.MUTATION, Portal\.MatchLeaveInput\.serializer\(\), NoOutput\.serializer\(\)\)/,
    );
  });

  test("output is stable, so the drift check only fires on a real change", () => {
    const a = emit([{ output: z.object({ a: z.string(), b: z.enum(["x", "y"]) }) }]);
    const b = emit([{ output: z.object({ a: z.string(), b: z.enum(["x", "y"]) }) }]);
    assert.equal(a.swift, b.swift);
    assert.equal(a.kotlin, b.kotlin);
  });
});
