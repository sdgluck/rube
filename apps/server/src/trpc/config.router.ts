import { getAllConfig, setConfig, configSchema, type ConfigKey } from "#lib/config.ts";
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
