import { getAllConfig, setConfig, configSchema, type ConfigKey } from "@tinkerbell/core";
import { t, procedure } from "./_base.ts";

export const configRouter = t.router({
  get: procedure.query(() => getAllConfig()),

  save: procedure.input(configSchema.partial()).mutation(({ input }) => {
    for (const key of Object.keys(input) as ConfigKey[]) {
      const value = input[key];
      if (value !== undefined) {
        setConfig(key, value);
      }
    }
    return { ok: true };
  }),
});
