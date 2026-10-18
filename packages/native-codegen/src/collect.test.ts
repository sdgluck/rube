/**
 * What native-codegen adds on top of zod-to-swift / zod-to-kotlin: procedure
 * names, the namespaces, and a typed endpoint per procedure. The emitters'
 * own shape handling is tested in their repos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { emitKotlin, emitSwift, type ProcedureSource } from "./collect.ts";

const sources: ProcedureSource[] = [
  {
    router: "portal",
    path: "leavingSoon",
    kind: "query",
    input: undefined,
    output: z.array(z.object({ title: z.string() })),
  },
  { router: "portal", path: "match.leave", kind: "mutation", input: z.object({ code: z.string() }), output: null },
  { router: "admin", path: "auth.server", kind: "query", input: undefined, output: z.object({ version: z.string() }) },
];

test("each procedure gets a typed Swift endpoint, NoInput/NoOutput where it takes or answers nothing", () => {
  const swift = emitSwift(sources);
  assert.match(swift, /public typealias LeavingSoonOutput = \[LeavingSoonItem\]/);
  assert.match(
    swift,
    /static let leavingSoon = Endpoint<NoInput, Portal\.LeavingSoonOutput>\(path: "leavingSoon", kind: \.query\)/,
  );
  assert.match(
    swift,
    /static let matchLeave = Endpoint<Portal\.MatchLeaveInput, NoOutput>\(path: "match\.leave", kind: \.mutation\)/,
  );
  assert.match(
    swift,
    /public enum AdminAPI \{\n {4}public static let authServer = Endpoint<NoInput, Admin\.AuthServerOutput>/,
  );
  // TinkerbellModels' Support.swift defines these; a second copy wouldn't compile.
  assert.doesNotMatch(swift, /enum JSONValue/);
});

test("each procedure gets a Kotlin endpoint with its serializers", () => {
  const kotlin = emitKotlin(sources);
  assert.match(kotlin, /^package dev\.tinkerbell\.model$/m);
  assert.match(
    kotlin,
    /val leavingSoon = Endpoint\("leavingSoon", Endpoint\.Kind\.QUERY, NoInput\.serializer\(\), ListSerializer\(Portal\.LeavingSoonItem\.serializer\(\)\)\)/,
  );
  assert.match(
    kotlin,
    /val matchLeave = Endpoint\("match\.leave", Endpoint\.Kind\.MUTATION, Portal\.MatchLeaveInput\.serializer\(\), NoOutput\.serializer\(\)\)/,
  );
});
