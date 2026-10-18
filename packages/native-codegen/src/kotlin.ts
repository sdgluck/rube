/**
 * IR → Kotlin: kotlinx.serialization data classes plus a typed endpoint per
 * procedure, for `:core:model`.
 *
 * The same decisions as the Swift emitter, in Kotlin's terms:
 *
 * - String enums decode an unknown value to `UNKNOWN` (keeping the raw string
 *   in `raw` would need a class, not an enum; a picker never offers it, and a
 *   screen showing it shows "Other").
 * - Discriminated unions are sealed interfaces with a hand-rolled serializer
 *   that reads the discriminator first. kotlinx's own `@JsonClassDiscriminator`
 *   needs string tags and forbids the tag as a property, and the contract has
 *   both a boolean tag (`ok: true|false`) and variants that are shared shapes.
 * - Optional (absent-allowed) properties default to `null`, and the client's
 *   `Json` has `explicitNulls = false`, so they are omitted on the way out —
 *   while a required-nullable property has no default and is always written.
 */
import { camel, nestedName, pascal, type IRDocument, type IRProcedure, type IRType } from "./ir.ts";
import { procedureTypeName, variantCaseName } from "./swift.ts";

const KEYWORDS = new Set(
  "as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while".split(
    " ",
  ),
);
const RESERVED_TYPES = new Set([
  "Any",
  "Unit",
  "String",
  "Long",
  "Int",
  "Boolean",
  "Double",
  "List",
  "Map",
  "Set",
  "Nothing",
  "Companion",
  "Serializer",
  "Endpoint",
  "Result",
  "Pair",
]);

const ident = (name: string) => (KEYWORDS.has(name) ? `\`${name}\`` : name);
const PACKAGE = "dev.tinkerbell.model";

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
  taken: Set<string>;
  /** Fully qualified Kotlin path of the enclosing type, e.g. `Portal.MatchStateOutput`. */
  path: string;
}

function uniqueNested(ctx: Ctx, wanted: string): string {
  const last = ctx.path.split(".").at(-1)!;
  let name = RESERVED_TYPES.has(wanted) || wanted === last ? `${last}${wanted}` : wanted;
  for (let i = 2; ctx.taken.has(name); i++) name = `${wanted}${i}`;
  ctx.taken.add(name);
  return name;
}

/** The Kotlin spelling of `t`, declaring inline shapes as nested types. */
function typeRef(t: IRType, ctx: Ctx, hint: string, isArrayItem = false): string {
  switch (t.k) {
    case "string":
      return "String";
    case "int":
      return "Long";
    case "double":
      return "Double";
    case "bool":
      return "Boolean";
    case "json":
      return "JsonElement";
    case "literal":
      return typeof t.value === "string" ? "String" : typeof t.value === "boolean" ? "Boolean" : "Double";
    case "ref":
      return t.name;
    case "nullable": {
      const inner = typeRef(t.of, ctx, hint, isArrayItem);
      return inner.endsWith("?") ? inner : `${inner}?`;
    }
    case "array":
      return `List<${typeRef(t.of, ctx, hint, true)}>`;
    case "record":
      return `Map<String, ${typeRef(t.of, ctx, hint)}>`;
    case "enum":
    case "object":
    case "union": {
      const name = uniqueNested(ctx, nestedName(hint, isArrayItem));
      declare(name, `${ctx.path}.${name}`, t, ctx.out);
      return name;
    }
  }
}

/** A `KSerializer` expression for a type reference written by `typeRef`. */
function serializerOf(type: string): string {
  if (type.endsWith("?")) return `${serializerOf(type.slice(0, -1))}.nullable`;
  const list = /^List<(.+)>$/.exec(type);
  if (list) return `ListSerializer(${serializerOf(list[1])})`;
  const map = /^Map<String, (.+)>$/.exec(type);
  if (map) return `MapSerializer(String.serializer(), ${serializerOf(map[1])})`;
  if (type === "JsonElement") return "JsonElement.serializer()";
  return `${type}.serializer()`;
}

/**
 * Declare `name` for `t`. Returns the Kotlin type to refer to it by, which is
 * `name` itself except for a top-level list or scalar — Kotlin has no nested
 * typealias, so those are spelt out where used.
 */
function declare(name: string, path: string, t: IRType, out: Out): string {
  if (t.k === "object") return (dataClass(name, path, t.props, out), name);
  if (t.k === "enum") return (stringEnum(name, path, t.values, out), name);
  if (t.k === "union") return (union(name, path, t, out), name);
  if (t.k === "array" && (t.of.k === "object" || t.of.k === "enum" || t.of.k === "union")) {
    const item = name.endsWith("Output") ? `${name.slice(0, -"Output".length)}Item` : `${name}Item`;
    const parent = path.split(".").slice(0, -1).join(".");
    declare(item, parent ? `${parent}.${item}` : item, t.of, out);
    return `List<${item}>`;
  }
  return typeRef(t, { out, taken: new Set(), path }, name);
}

function dataClass(
  name: string,
  path: string,
  props: Array<{ key: string; optional: boolean; t: IRType }>,
  out: Out,
): void {
  const ctx: Ctx = { out, taken: new Set(), path };
  // Nested declarations are written into a body after the constructor, so
  // render the fields first into a scratch buffer.
  const body = new Out();
  const fieldCtx: Ctx = { ...ctx, out: body };
  const fields = props.map((p) => {
    let type = typeRef(p.t, fieldCtx, p.key);
    const nullable = type.endsWith("?") || p.optional;
    if (p.optional && !type.endsWith("?")) type += "?";
    return { key: p.key, name: camel(p.key), type, optional: p.optional, nullable };
  });
  const seen = new Map<string, number>();
  for (const f of fields) {
    const n = seen.get(f.name) ?? 0;
    seen.set(f.name, n + 1);
    if (n > 0) f.name = `${f.name}${n + 1}`;
  }

  out.line("@Serializable");
  if (fields.length === 0) {
    out.line(`class ${name} {`);
    out.indent(() => {
      out.line(`override fun equals(other: Any?) = other is ${name}`);
      out.line(`override fun hashCode() = ${JSON.stringify(path)}.hashCode()`);
    });
    out.line("}");
    out.line();
    return;
  }
  out.line(`data class ${name}(`);
  out.indent(() => {
    for (const f of fields) {
      const serial = f.name === f.key ? "" : `@SerialName(${JSON.stringify(f.key)}) `;
      out.line(`${serial}val ${ident(f.name)}: ${f.type}${f.optional ? " = null" : ""},`);
    }
  });
  if (body.lines.length === 0) {
    out.line(")");
  } else {
    out.line(") {");
    out.indent(() => {
      for (const l of body.lines) out.line(l);
    });
    out.line("}");
  }
  out.line();
}

function screaming(v: string): string {
  const s = v
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  if (!s) return "EMPTY";
  return /^[0-9]/.test(s) ? `V_${s}` : s;
}

function stringEnum(name: string, path: string, values: string[], out: Out): void {
  const used = new Set<string>();
  const entries = values.map((v) => {
    let n = screaming(v);
    if (n === "UNKNOWN") n = "UNKNOWN_VALUE";
    for (let i = 2; used.has(n); i++) n = `${screaming(v)}_${i}`;
    used.add(n);
    return n;
  });
  out.line(`@Serializable(with = ${name}.Companion::class)`);
  out.line(`enum class ${name}(val raw: String) {`);
  out.indent(() => {
    values.forEach((v, i) => out.line(`${entries[i]}(${JSON.stringify(v)}),`));
    out.line("/** A value this build doesn't know — a newer server's. */");
    out.line('UNKNOWN("");');
    out.line();
    out.line(`companion object : KSerializer<${name}> {`);
    out.indent(() => {
      out.line(`val known: List<${name}> = ${name}.entries.filter { it != UNKNOWN }`);
      out.line(
        `override val descriptor = PrimitiveSerialDescriptor(${JSON.stringify(`${PACKAGE}.${path}`)}, PrimitiveKind.STRING)`,
      );
      out.line(`override fun deserialize(decoder: Decoder): ${name} {`);
      out.indent(() => {
        out.line("val raw = decoder.decodeString()");
        out.line(`return ${name}.entries.firstOrNull { it != UNKNOWN && it.raw == raw } ?: UNKNOWN`);
      });
      out.line("}");
      out.line(`override fun serialize(encoder: Encoder, value: ${name}) = encoder.encodeString(value.raw)`);
    });
    out.line("}");
  });
  out.line("}");
  out.line();
}

function union(name: string, path: string, t: Extract<IRType, { k: "union" }>, out: Out): void {
  const body = new Out();
  const ctx: Ctx = { out: body, taken: new Set(), path };
  const cases = t.variants.map((v) => {
    const wrapper = uniqueNested(ctx, pascal(variantCaseName(t.discriminator, v.tag)));
    let payload: string;
    if (v.t.k === "ref") payload = v.t.name;
    else {
      payload = uniqueNested(ctx, `${wrapper}Value`);
      declare(payload, `${path}.${payload}`, v.t, body);
    }
    return { wrapper, payload, tag: v.tag };
  });

  out.line(`@Serializable(with = ${name}.Companion::class)`);
  out.line(`sealed interface ${name} {`);
  out.indent(() => {
    for (const c of cases) out.line(`data class ${c.wrapper}(val value: ${c.payload}) : ${name}`);
    out.line();
    for (const l of body.lines) out.line(l);
    out.line(`companion object : KSerializer<${name}> {`);
    out.indent(() => {
      out.line(`override val descriptor = buildClassSerialDescriptor(${JSON.stringify(`${PACKAGE}.${path}`)})`);
      out.line(`override fun deserialize(decoder: Decoder): ${name} {`);
      out.indent(() => {
        out.line("val input = decoder as JsonDecoder");
        out.line("val element = input.decodeJsonElement()");
        out.line(
          `return when (val tag = element.jsonObject[${JSON.stringify(t.discriminator)}]?.jsonPrimitive?.content) {`,
        );
        out.indent(() => {
          for (const c of cases) {
            out.line(
              `${JSON.stringify(String(c.tag))} -> ${c.wrapper}(input.json.decodeFromJsonElement(${c.payload}.serializer(), element))`,
            );
          }
          out.line(`else -> throw SerializationException("Unknown ${name} ${"$"}tag")`);
        });
        out.line("}");
      });
      out.line("}");
      out.line(`override fun serialize(encoder: Encoder, value: ${name}) {`);
      out.indent(() => {
        out.line("val output = encoder as JsonEncoder");
        out.line("when (value) {");
        out.indent(() => {
          for (const c of cases)
            out.line(`is ${c.wrapper} -> output.encodeSerializableValue(${c.payload}.serializer(), value.value)`);
        });
        out.line("}");
      });
      out.line("}");
    });
    out.line("}");
  });
  out.line("}");
  out.line();
}

const NAMESPACE = { portal: "Portal", admin: "Admin" } as const;

export function emitKotlin(doc: IRDocument): string {
  const out = new Out();
  out.line("// Generated by `pnpm native:codegen` from @tinkerbell/contracts/native-api.");
  out.line("// Do not edit — change the schema and regenerate. `pnpm verify` fails if this is stale.");
  out.line('@file:Suppress("unused", "RedundantVisibilityModifier", "ktlint")');
  out.line();
  out.line(`package ${PACKAGE}`);
  out.line();
  for (const imp of [
    "kotlinx.serialization.KSerializer",
    "kotlinx.serialization.SerialName",
    "kotlinx.serialization.Serializable",
    "kotlinx.serialization.SerializationException",
    "kotlinx.serialization.builtins.ListSerializer",
    "kotlinx.serialization.builtins.MapSerializer",
    "kotlinx.serialization.builtins.nullable",
    "kotlinx.serialization.builtins.serializer",
    "kotlinx.serialization.descriptors.PrimitiveKind",
    "kotlinx.serialization.descriptors.PrimitiveSerialDescriptor",
    "kotlinx.serialization.descriptors.buildClassSerialDescriptor",
    "kotlinx.serialization.encoding.Decoder",
    "kotlinx.serialization.encoding.Encoder",
    "kotlinx.serialization.json.JsonDecoder",
    "kotlinx.serialization.json.JsonElement",
    "kotlinx.serialization.json.JsonEncoder",
    "kotlinx.serialization.json.jsonObject",
    "kotlinx.serialization.json.jsonPrimitive",
  ])
    out.line(`import ${imp}`);
  out.line();

  for (const d of doc.defs) declare(d.name, d.name, d.t, out);

  for (const router of ["portal", "admin"] as const) {
    const ns = NAMESPACE[router];
    const procs = doc.procedures.filter((p) => p.router === router);
    const refs = new Map<IRProcedure, { input: string; output: string }>();
    out.line(`object ${ns} {`);
    out.indent(() => {
      for (const p of procs) {
        const input = p.input
          ? declare(procedureTypeName(p, "Input"), `${ns}.${procedureTypeName(p, "Input")}`, p.input, out)
          : null;
        const output = p.output
          ? declare(procedureTypeName(p, "Output"), `${ns}.${procedureTypeName(p, "Output")}`, p.output, out)
          : null;
        const qualify = (type: string) =>
          type.replace(/\b([A-Z][A-Za-z0-9]*)\b/g, (m) =>
            /^(List|Map|String|Long|Double|Boolean|JsonElement)$/.test(m) || doc.defs.some((d) => d.name === m)
              ? m
              : `${ns}.${m}`,
          );
        refs.set(p, { input: input ? qualify(input) : "NoInput", output: output ? qualify(output) : "NoOutput" });
      }
    });
    out.line("}");
    out.line();
    out.line(`object ${ns}Api {`);
    out.indent(() => {
      for (const p of procs) {
        const { input, output } = refs.get(p)!;
        out.line(
          `val ${camel(p.path)} = Endpoint(${JSON.stringify(p.path)}, Endpoint.Kind.${p.kind.toUpperCase()}, ${serializerOf(input)}, ${serializerOf(output)})`,
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
