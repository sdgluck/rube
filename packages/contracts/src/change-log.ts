/**
 * The vocabulary of the settings change log.
 *
 * Here rather than in `domains/config-history` because the browser needs it —
 * a filter row and a badge want values, not types — and the web app cannot
 * import a domain. The matching *types* live in `@tinkerbell/ports`, which
 * owns the recorder edge and may not depend on this package.
 *
 * That is two declarations of one fact, so `domains/config-history` asserts at
 * compile time that they agree; it imports both and is the only thing that
 * can. A kind added here and not there is a build error rather than a filter
 * button that silently matches nothing.
 */

/**
 * The kinds of thing whose edits are worth keeping.
 *
 * Deliberately not "every table". These are the things a person configures, and
 * can therefore misconfigure; everything else is either derived from Plex or
 * already has a ledger of its own.
 */
export const CHANGE_LOG_ENTITIES = ["rule", "config", "job", "overlay_preset", "preroll", "schedule"] as const;

/**
 * `import` and `restore` are separate from `update` because they answer a
 * different question. "Who changed this?" is usually the source; "was this
 * whole state pulled in from somewhere else?" is what gets asked after a
 * bundle import goes wrong, and it needs to be visible on the row.
 */
export const CHANGE_LOG_ACTIONS = ["create", "update", "delete", "import", "restore"] as const;

export type ChangeLogEntity = (typeof CHANGE_LOG_ENTITIES)[number];
export type ChangeLogAction = (typeof CHANGE_LOG_ACTIONS)[number];
