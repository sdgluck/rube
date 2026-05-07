import {
  getAllConfigForClient,
  getConfig,
  setConfig,
  configSchema,
  SECRET_KEYS,
  REDACTED_SECRET,
  type ConfigKey,
  type ConfigValue,
} from "@tinkerbell/core";
import { t, procedure } from "./_base.ts";

export const configRouter = t.router({
  get: procedure.query(() => getAllConfigForClient()),

  save: procedure.input(configSchema.partial()).mutation(({ input }) => {
    for (const key of Object.keys(input) as ConfigKey[]) {
      const value = input[key];
      if (value === undefined) continue;
      // The form may echo back the redaction sentinel for secrets the user
      // didn't change. Treat that as "keep the stored value".
      if (SECRET_KEYS.has(key) && value === REDACTED_SECRET) continue;
      if (key === "global_llm") {
        const llm = value as ConfigValue<"global_llm">;
        if (llm.apiKey === REDACTED_SECRET) {
          const existing = getConfig("global_llm");
          setConfig("global_llm", { ...llm, apiKey: existing?.apiKey });
          continue;
        }
      }
      setConfig(key, value);
    }
    return { ok: true };
  }),
});
