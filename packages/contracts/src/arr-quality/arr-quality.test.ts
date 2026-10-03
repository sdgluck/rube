/**
 * The preset catalogue, checked against what the *Arrs actually accept.
 *
 * Every name in a preset is a string the *Arr has to recognise. Quality names
 * differ between the apps, specification implementations differ by version,
 * and a typo in any of them surfaces as a 400 from somebody's Radarr halfway
 * through an apply. These tests make it a build failure instead.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { customFormatSchemaFixture, qualityProfileSchemaFixture } from "@tinkerbell/test-support";
import {
  CUSTOM_FORMATS,
  type CustomFormatDef,
  customFormatDef,
  gbForRuntime,
  mbPerMinute,
  minimumMaxGb,
  presetQualityNames,
  QUALITY_PRESETS,
  sizeLimitSchema,
} from "./index.ts";
import { ARR_SERVICES } from "../arr.ts";

function schemaQualityNames(service: "radarr" | "sonarr"): Set<string> {
  const schema = qualityProfileSchemaFixture(service) as { items: Array<Record<string, unknown>> };
  const names = new Set<string>();
  const walk = (items: Array<Record<string, unknown>>) => {
    for (const item of items) {
      const quality = item.quality as { name: string } | undefined;
      if (quality) names.add(quality.name);
      walk((item.items as Array<Record<string, unknown>>) ?? []);
    }
  };
  walk(schema.items);
  return names;
}

describe("quality presets", () => {
  test("ids are unique", () => {
    const ids = QUALITY_PRESETS.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  for (const preset of QUALITY_PRESETS) {
    describe(preset.id, () => {
      const known = schemaQualityNames(preset.service);
      const allowed = presetQualityNames(preset);

      test("every quality exists in the app's schema, once", () => {
        for (const name of allowed) assert.ok(known.has(name), `${name} is not a ${preset.service} quality`);
        assert.equal(new Set(allowed).size, allowed.length, "a quality is listed twice");
      });

      test("group names do not shadow a quality", () => {
        for (const q of preset.qualities) {
          if (typeof q !== "string") assert.ok(!known.has(q.group), `group "${q.group}" is also a quality name`);
        }
      });

      test("the cutoff is one of the allowed entries", () => {
        const entries = preset.qualities.map((q) => (typeof q === "string" ? q : q.group));
        assert.ok(entries.includes(preset.cutoff), `cutoff ${preset.cutoff} is not allowed`);
      });

      test("every custom format exists for this service, with supported specifications", () => {
        const supported = new Set(customFormatSchemaFixture(preset.service).map((s) => s.implementation));
        const names = preset.customFormats.map((f) => f.name);
        assert.equal(new Set(names).size, names.length, "a custom format is scored twice");
        for (const { name } of preset.customFormats) {
          const def = customFormatDef(name);
          assert.ok(def, `unknown custom format ${name}`);
          const specs = def.specs[preset.service];
          assert.ok(specs && specs.length > 0, `${name} has no ${preset.service} specification`);
          for (const spec of specs) {
            assert.ok(supported.has(spec.implementation), `${name}: ${spec.implementation} unsupported`);
          }
        }
      });

      test("every allowed quality has a minimum size", () => {
        assert.deepEqual(Object.keys(preset.minMbPerMin).sort(), [...allowed].sort());
      });

      test("the default limit is valid and reachable", () => {
        sizeLimitSchema.parse(preset.defaultLimit);
        const floor = Math.max(...Object.values(preset.minMbPerMin));
        const { maxGb, basisMinutes, ceilingGb } = preset.defaultLimit;
        assert.ok(maxGb >= minimumMaxGb(floor, basisMinutes), "default limit is below a quality's minimum");
        assert.ok(ceilingGb === null || ceilingGb >= maxGb, "ceiling below the reference size");
      });
    });
  }
});

/**
 * A small model of how the *Arrs evaluate a custom format against a title.
 *
 * Every required specification must match, and of the non-required ones, at
 * least one per implementation must match. Only the two implementations that
 * look at text are modelled. A format using anything else is skipped by the
 * examples test rather than half-evaluated.
 */
function matches(def: CustomFormatDef, service: "radarr" | "sonarr", title: string): boolean | null {
  const specs = def.specs[service] ?? [];
  const group = /-([^-.\s[\]]+)(\[[^\]]*\])?$/.exec(title)?.[1] ?? "";
  const results = new Map<string, boolean[]>();
  for (const spec of specs) {
    let hit: boolean;
    if (spec.implementation === "ReleaseTitleSpecification") {
      hit = new RegExp(String(spec.fields.value), "i").test(title);
    } else if (spec.implementation === "ReleaseGroupSpecification") {
      hit = new RegExp(String(spec.fields.value), "i").test(group);
    } else {
      return null;
    }
    if (spec.negate) hit = !hit;
    if (spec.required && !hit) return false;
    if (!spec.required) results.set(spec.implementation, [...(results.get(spec.implementation) ?? []), hit]);
  }
  return [...results.values()].every((hits) => hits.some(Boolean));
}

describe("custom formats", () => {
  test("names are unique", () => {
    const names = CUSTOM_FORMATS.map((f) => f.name);
    assert.equal(new Set(names).size, names.length);
  });

  test("every pattern compiles", () => {
    for (const def of CUSTOM_FORMATS as readonly CustomFormatDef[]) {
      for (const service of ARR_SERVICES) {
        for (const spec of def.specs[service] ?? []) {
          if (typeof spec.fields.value !== "string") continue;
          assert.doesNotThrow(() => new RegExp(String(spec.fields.value), "i"), `${def.name}: ${spec.name}`);
        }
      }
    }
  });

  for (const def of CUSTOM_FORMATS as readonly CustomFormatDef[]) {
    if (!def.examples) continue;
    test(`${def.name} matches its examples`, () => {
      for (const service of ARR_SERVICES) {
        if (!def.specs[service]) continue;
        for (const title of def.examples!.match) {
          const result = matches(def, service, title);
          if (result !== null) assert.equal(result, true, `${service}: should match ${title}`);
        }
        for (const title of def.examples!.miss) {
          const result = matches(def, service, title);
          if (result !== null) assert.equal(result, false, `${service}: should not match ${title}`);
        }
      }
    });
  }
});

describe("size limits", () => {
  test("a limit becomes a per-minute rate and back", () => {
    const rate = mbPerMinute({ maxGb: 15, basisMinutes: 120 });
    assert.equal(rate, 128);
    assert.equal(gbForRuntime(rate, 120), 15);
    assert.equal(gbForRuntime(rate, 180), 22.5);
  });

  test("the smallest usable limit rounds up to half a gigabyte", () => {
    // 50.4 MB/min for two hours is 5.9 GB.
    assert.equal(minimumMaxGb(50.4, 120), 6);
  });
});
