/**
 * What a native app asks a URL before it trusts it with a sign-in.
 *
 * The apps bundle their own UI, so a server picker can't tell from a page load
 * whether the address it was given is a Tinkerbell at all, which of the two
 * ports it is (people paste the portal address into the admin app and vice
 * versa), or a release too old for the bundled UI to talk to. One public
 * procedure on each router answers all three.
 *
 * The version is this package's own. The release script bumps every workspace
 * package in step, so it is the app version — the same value `server.ts` reads
 * from `apps/server`, without this package reaching into an app.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const VERSION: string = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")).version;

export type ServerProduct = "tinkerbell-admin" | "tinkerbell-portal";

export function serverInfo(product: ServerProduct): { product: ServerProduct; version: string } {
  return { product, version: VERSION };
}
