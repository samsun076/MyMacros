/** Hono generics for the whole Worker: bindings come from wrangler.jsonc
 *  (regenerate `worker-configuration.d.ts` with `npm run cf-typegen`). */
export type AppEnv = {
  Bindings: Env;
};
