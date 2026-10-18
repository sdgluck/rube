/**
 * IR → Swift: `Codable, Sendable, Hashable` value types plus a typed endpoint
 * per procedure, for `TinkerbellModels`.
 *
 * Choices that matter on a phone:
 *
 * - **String enums keep an `unknown(String)` case.** The server adds a problem
 *   kind or a trigger in a minor release; an app built against last month's
 *   list must still decode the screen rather than fail it whole.
 * - **Discriminated unions are enums with associated values**, decoded by
 *   peeking at the discriminator, so a `switch` over them is exhaustive.
 * - **Encoding is written out** rather than synthesized, because synthesized
 *   `Encodable` drops a `nil` — and a required-nullable input (`match.vote`'s
 *   `ratingKey: null`, "withdraw my vote") has to be sent as `null`.
 * - Inline objects become nested types named after their property, so
 *   `MatchStateOutput.Member` reads like something a person named.
 *
 * Support types (`Endpoint`, `NoInput`, `NoOutput`, `JSONValue`,
 * `AnyCodingKey`) are hand-written beside the generated file.
 */
import { camel, nestedName, pascal, type IRDocument, type IRProcedure, type IRType } from "./ir.ts";

const KEYWORDS = new Set(
  "associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private precedencegroup protocol public rethrows static struct subscript typealias var break case catch continue default defer do else fallthrough for guard if in repeat return throw switch where while Any as await false is nil self Self super throws true try".split(
    " ",
  ),
);
/** Names a nested type can't take without shadowing something every file uses. */
const RESERVED_TYPES = new Set([
  "Type",
  "Self",
  "Protocol",
  "Any",
  "String",
  "Int",
  "Bool",
  "Double",
  "Data",
  "Date",
  "Error",
  "Result",
  "Optional",
  "Array",
  "Set",
  "Dictionary",
  "Element",
  "CodingKeys",
  "Endpoint",
  "JSONValue",
]);

const ident = (name: string) => (KEYWORDS.has(name) ? `\`${name}\`` : name);

class Out {
  lines: string[] = [];
  private depth = 0;
  line(s = "") {
    this.lines.push(s ? "    ".repeat(this.depth) + s : "");
  }
  indent<T>(fn: () => T): T {
    this.depth++;
    try {
      return fn();
    } finally {
      this.depth--;
    }
  }
}

interface Ctx {
  out: Out;
  /** Names already declared in the scope being written, so siblings don't collide. */
  taken: Set<string>;
  /** The enclosing type's name, which a nested type may not repeat. */
  parent: string;
}

function uniqueNested(ctx: Ctx, wanted: string): string {
  let name = RESERVED_TYPES.has(wanted) || wanted === ctx.parent ? `${ctx.parent}${wanted}` : wanted;
  for (let i = 2; ctx.taken.has(name); i++) name = `${wanted}${i}`;
  ctx.taken.add(name);
  return name;
}

/**
 * The Swift spelling of `t`. Inline shapes are declared into `ctx` as nested
 * types and referred to by name.
 */
function typeRef(t: IRType, ctx: Ctx, hint: string, isArrayItem = false): string {
  switch (t.k) {
    case "string":
      return "String";
    case "int":
      return "Int";
    case "double":
      return "Double";
    case "bool":
      return "Bool";
    case "json":
      return "JSONValue";
    case "literal":
      return typeof t.value === "string" ? "String" : typeof t.value === "boolean" ? "Bool" : "Double";
    case "ref":
      return t.name;
    case "nullable": {
      const inner = typeRef(t.of, ctx, hint, isArrayItem);
      return inner.endsWith("?") ? inner : `${inner}?`;
    }
    case "array":
      return `[${typeRef(t.of, ctx, hint, true)}]`;
    case "record":
      return `[String: ${typeRef(t.of, ctx, hint)}]`;
    case "enum":
    case "object":
    case "union": {
      const name = uniqueNested(ctx, nestedName(hint, isArrayItem));
      declare(name, t, ctx.out);
      return name;
    }
  }
}

/** Declare a named type for `t`: a struct, an enum, or a typealias. */
function declare(name: string, t: IRType, out: Out): void {
  if (t.k === "object") return struct(name, t.props, out);
  if (t.k === "enum") return stringEnum(name, t.values, out);
  if (t.k === "union") return union(name, t, out);
  // A top-level output that is a list or a scalar: name its element if it
  // needs one, and alias the rest.
  if (t.k === "array" && (t.of.k === "object" || t.of.k === "enum" || t.of.k === "union")) {
    const item = name.endsWith("Output") ? `${name.slice(0, -"Output".length)}Item` : `${name}Item`;
    declare(item, t.of, out);
    out.line(`public typealias ${name} = [${item}]`);
    return;
  }
  const ctx: Ctx = { out, taken: new Set(), parent: name };
  out.line(`public typealias ${name} = ${typeRef(t, ctx, name)}`);
}

function struct(name: string, props: Array<{ key: string; optional: boolean; t: IRType }>, out: Out): void {
  out.line(`public struct ${name}: Codable, Sendable, Hashable {`);
  out.indent(() => {
    const ctx: Ctx = { out, taken: new Set(), parent: name };
    const fields = props.map((p) => {
      let type = typeRef(p.t, ctx, p.key);
      if (p.optional && !type.endsWith("?")) type += "?";
      const swiftName = camel(p.key);
      return { key: p.key, name: swiftName, type, optional: type.endsWith("?") };
    });
    // Two keys that camelCase alike (`a-b`, `a_b`) — keep both, distinctly.
    const seen = new Map<string, number>();
    for (const f of fields) {
      const n = seen.get(f.name) ?? 0;
      seen.set(f.name, n + 1);
      if (n > 0) f.name = `${f.name}${n + 1}`;
    }
    if (fields.length > 0) out.line();
    for (const f of fields) out.line(`public var ${ident(f.name)}: ${f.type}`);

    out.line();
    const params = fields.map((f) => `${ident(f.name)}: ${f.type}${f.optional ? " = nil" : ""}`).join(", ");
    out.line(`public init(${params}) {`);
    out.indent(() => {
      for (const f of fields) out.line(`self.${f.name} = ${ident(f.name)}`);
    });
    out.line("}");

    if (fields.length > 0) {
      out.line();
      out.line("enum CodingKeys: String, CodingKey {");
      out.indent(() => {
        for (const f of fields)
          out.line(f.name === f.key ? `case ${ident(f.name)}` : `case ${ident(f.name)} = ${JSON.stringify(f.key)}`);
      });
      out.line("}");
    }

    out.line();
    out.line("public func encode(to encoder: Encoder) throws {");
    out.indent(() => {
      if (fields.length === 0) {
        out.line("_ = encoder.container(keyedBy: AnyCodingKey.self)");
        return;
      }
      out.line("var c = encoder.container(keyedBy: CodingKeys.self)");
      for (const p of props) {
        const f = fields[props.indexOf(p)];
        // Absent-allowed → omit nil; required (even if nullable) → always written.
        out.line(`try c.${p.optional ? "encodeIfPresent" : "encode"}(${f.name}, forKey: .${ident(f.name)})`);
      }
    });
    out.line("}");
  });
  out.line("}");
  out.line();
}

export function enumCaseNames(values: string[]): string[] {
  const used = new Set<string>();
  return values.map((v) => {
    let n = camel(v);
    if (n === "unknown") n = "unknownValue";
    for (let i = 2; used.has(n); i++) n = `${camel(v)}${i}`;
    used.add(n);
    return n;
  });
}

function stringEnum(name: string, values: string[], out: Out): void {
  const cases = enumCaseNames(values);
  out.line(`public enum ${name}: Codable, Sendable, Hashable, RawRepresentable {`);
  out.indent(() => {
    for (const c of cases) out.line(`case ${ident(c)}`);
    out.line("/** A value this build doesn't know — a newer server's. */");
    out.line("case unknown(String)");
    out.line();
    out.line(`public static let known: [${name}] = [${cases.map((c) => `.${ident(c)}`).join(", ")}]`);
    out.line();
    out.line("public init(rawValue: String) {");
    out.indent(() => {
      out.line("switch rawValue {");
      values.forEach((v, i) => out.line(`case ${JSON.stringify(v)}: self = .${ident(cases[i])}`));
      out.line("default: self = .unknown(rawValue)");
      out.line("}");
    });
    out.line("}");
    out.line();
    out.line("public var rawValue: String {");
    out.indent(() => {
      out.line("switch self {");
      values.forEach((v, i) => out.line(`case .${ident(cases[i])}: ${JSON.stringify(v)}`));
      out.line("case .unknown(let raw): raw");
      out.line("}");
    });
    out.line("}");
    out.line();
    out.line("public init(from decoder: Decoder) throws {");
    out.indent(() => out.line("self.init(rawValue: try decoder.singleValueContainer().decode(String.self))"));
    out.line("}");
    out.line();
    out.line("public func encode(to encoder: Encoder) throws {");
    out.indent(() => {
      out.line("var c = encoder.singleValueContainer()");
      out.line("try c.encode(rawValue)");
    });
    out.line("}");
  });
  out.line("}");
  out.line();
}

export function variantCaseName(discriminator: string, tag: string | number | boolean): string {
  if (typeof tag === "boolean") return `${camel(discriminator)}${tag ? "True" : "False"}`;
  return camel(String(tag));
}

function union(name: string, t: Extract<IRType, { k: "union" }>, out: Out): void {
  const tagType =
    typeof t.variants[0].tag === "string" ? "String" : typeof t.variants[0].tag === "boolean" ? "Bool" : "Double";
  out.line(`public enum ${name}: Codable, Sendable, Hashable {`);
  out.indent(() => {
    const ctx: Ctx = { out, taken: new Set(), parent: name };
    const cases = t.variants.map((v) => {
      const caseName = variantCaseName(t.discriminator, v.tag);
      const payload = v.t.k === "ref" ? v.t.name : uniqueNested(ctx, pascal(caseName));
      if (v.t.k !== "ref") declare(payload, v.t, out);
      return { caseName, payload, tag: v.tag };
    });
    for (const c of cases) out.line(`case ${ident(c.caseName)}(${c.payload})`);
    out.line();
    out.line("public init(from decoder: Decoder) throws {");
    out.indent(() => {
      out.line("let c = try decoder.container(keyedBy: AnyCodingKey.self)");
      out.line(`let key = AnyCodingKey(${JSON.stringify(t.discriminator)})`);
      out.line(`switch try c.decode(${tagType}.self, forKey: key) {`);
      for (const c of cases)
        out.line(`case ${JSON.stringify(c.tag)}: self = .${ident(c.caseName)}(try ${c.payload}(from: decoder))`);
      out.line("case let other:");
      out.indent(() =>
        out.line(
          `throw DecodingError.dataCorruptedError(forKey: key, in: c, debugDescription: "Unknown ${name} \\(other)")`,
        ),
      );
      out.line("}");
    });
    out.line("}");
    out.line();
    out.line("public func encode(to encoder: Encoder) throws {");
    out.indent(() => {
      out.line("switch self {");
      for (const c of cases) out.line(`case .${ident(c.caseName)}(let value): try value.encode(to: encoder)`);
      out.line("}");
    });
    out.line("}");
  });
  out.line("}");
  out.line();
}

const NAMESPACE = { portal: "Portal", admin: "Admin" } as const;

export function procedureTypeName(p: IRProcedure, which: "Input" | "Output"): string {
  return `${pascal(p.path)}${which}`;
}

export function emitSwift(doc: IRDocument): string {
  const out = new Out();
  out.line("// Generated by `pnpm native:codegen` from @tinkerbell/contracts/native-api.");
  out.line("// Do not edit — change the schema and regenerate. `pnpm verify` fails if this is stale.");
  out.line("// swiftlint:disable all");
  out.line();
  out.line("import Foundation");
  out.line();

  for (const d of doc.defs) declare(d.name, d.t, out);

  for (const router of ["portal", "admin"] as const) {
    const ns = NAMESPACE[router];
    const procs = doc.procedures.filter((p) => p.router === router);
    out.line(`public enum ${ns} {}`);
    out.line();
    out.line(`extension ${ns} {`);
    out.indent(() => {
      for (const p of procs) {
        if (p.input) declare(procedureTypeName(p, "Input"), p.input, out);
        if (p.output) declare(procedureTypeName(p, "Output"), p.output, out);
      }
    });
    out.line("}");
    out.line();
    out.line(`public enum ${ns}API {`);
    out.indent(() => {
      for (const p of procs) {
        const input = p.input ? `${ns}.${procedureTypeName(p, "Input")}` : "NoInput";
        const output = p.output ? `${ns}.${procedureTypeName(p, "Output")}` : "NoOutput";
        out.line(
          `public static let ${camel(p.path)} = Endpoint<${input}, ${output}>(path: ${JSON.stringify(p.path)}, kind: .${p.kind})`,
        );
      }
    });
    out.line("}");
    out.line();
  }
  return (
    out.lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
}
