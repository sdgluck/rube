/**
 * Keeps the app's styles speaking one language.
 *
 * The design system is three layers, and these rules exist so a stylesheet
 * can't quietly skip one:
 *
 *   1. Tokens        apps/web/src/App.css — every colour, radius and face the
 *                    app may use, defined once and themed once.
 *   2. Primitives    styles/controls.module.css (buttons, inputs, selects) and
 *                    styles/shared.module.css (tables, panels, chips,
 *                    toolbars). A page reaches these with `composes:`.
 *   3. Page modules  what is genuinely local to one screen — a grid template,
 *                    a max-width, one page's stacking order.
 *
 * Drift never arrives as a redesign. It arrives as one `#e8ecec` typed because
 * the token name wasn't to hand, and then copied into the next stylesheet by
 * someone who assumes it was deliberate.
 *
 * Deliberately NOT extending stylelint-config-standard: it enforces kebab-case
 * class names and rejects `composes`, and both are load-bearing here. The rules
 * below are the ones that encode a decision this codebase has actually made.
 *
 * Escape hatch, with the reason required (`reportDescriptionlessDisables`):
 *
 *   /* stylelint-disable-next-line color-no-hex -- Plex's palette, not ours *\/
 *
 * `pnpm lint:css:report` lists disables that no longer suppress anything, so
 * the set of exceptions stays honest instead of accumulating.
 */

import strictValue from "stylelint-declaration-strict-value";
import unknownCustomProperties from "stylelint-value-no-unknown-custom-properties";
import noShadowedPrimitive from "./stylelint-plugins/no-shadowed-primitive.mjs";
import breakpointScale from "./stylelint-plugins/breakpoint-scale.mjs";

/** Where the vocabulary is defined, for the token-exists rule. */
const TOKEN_FILES = ["apps/web/src/App.css"];

/**
 * The portal's own vocabulary.
 *
 * It keeps a separate one on purpose — it ships without the app's stylesheet —
 * but "separate vocabulary" is not the same as "no vocabulary", and it was
 * being linted as neither. Its stylesheet is now held to the same rules
 * against its own tokens: no literals, no unknown custom properties.
 */
const PORTAL_TOKEN_FILES = ["apps/portal/src/tokens.css"];

export default {
  plugins: [strictValue, unknownCustomProperties, noShadowedPrimitive, breakpointScale],

  reportDescriptionlessDisables: true,
  reportInvalidScopeDisables: true,

  rules: {
    /* A colour in a stylesheet is a colour that can't be themed. Both themes
       live in App.css; a literal here only ever gets one of them right. */
    "color-no-hex": true,
    "color-named": "never",
    "function-disallowed-list": ["rgb", "rgba", "hsl", "hsla"],

    /* The properties where a literal is nearly always drift. `border-radius`
       is on the list because the radius scale is a design decision (every step
       is 2px right now, and that has to be changeable in one place). */
    "scale-unlimited/declaration-strict-value": [
      /* `/color$/` covers color, background-color, border-color and the
         per-side variants. The `border` and `background` shorthands are
         deliberately absent: their values are mostly widths, styles, gradients
         and urls, so requiring the whole value to be a token is noise — and a
         literal colour inside one is already caught by the two rules above. */
      ["/color$/", "border-radius", "font-family", "fill"],
      {
        ignoreValues: [
          "currentColor",
          "inherit",
          "initial",
          "none",
          "transparent",
          "unset",
          "0",
          /* Circles are not on the radius scale — squaring a spinner or an
             avatar reads as broken, not as square. */
          "50%",
          "100%",
        ],
        /* `ignoreFunctions` defaults to true, so a gradient or color-mix()
           passes this rule. That is deliberate: their *contents* are covered by
           color-no-hex and function-disallowed-list, which is where a literal
           inside one actually shows up. */
        disableFix: true,
        message: "Use a token from App.css (--ink*, --surface*, --line*, --r-*, --font-*) rather than a literal.",
      },
    ],

    /* Catches both typos and tokens that were deleted out from under a
       stylesheet. `var(--border)` and `var(--warn)` had been silently falling
       back to their literals on the Registry page for months. */
    "csstools/value-no-unknown-custom-properties": [true, { importFrom: TOKEN_FILES }],

    "tinkerbell/no-shadowed-primitive": true,

    /* One responsive scale rather than a breakpoint per panel. */
    "tinkerbell/breakpoint-scale": true,
  },

  overrides: [
    {
      /* The token files define the vocabulary, so they are where the literals
         are supposed to be. */
      files: TOKEN_FILES.concat(
        PORTAL_TOKEN_FILES,
        "apps/web/src/styles/fonts.css",
        "apps/portal/src/fonts.css",
      ),
      rules: {
        "color-no-hex": null,
        "color-named": null,
        "function-disallowed-list": null,
        "scale-unlimited/declaration-strict-value": null,
      },
    },
    {
      /* The marketing site is a separate product: its own palette, its own
         components, no import path to the app's tokens or primitives. Every
         rule here would be measuring it against a design system it isn't part
         of. It is linted as CSS, not as this app. */
      files: ["apps/tinkerbell.dev/**/*.css"],
      rules: {
        "color-no-hex": null,
        "color-named": null,
        "function-disallowed-list": null,
        "scale-unlimited/declaration-strict-value": null,
        "csstools/value-no-unknown-custom-properties": null,
        "tinkerbell/no-shadowed-primitive": null,
        "tinkerbell/breakpoint-scale": null,
      },
    },
    {
      /* The portal is the surface end users actually see, and it was the least
         governed thing in the repo: its own palette, no lint at all, and a
         hardcoded `#e5a00d` of exactly the kind the app forbids. It is held to
         the same rules now, against its own vocabulary in tokens.css.

         Two stay off. `no-shadowed-primitive` checks class names against the
         app's primitive stylesheets, which the portal has no import path to.
         The strict-value rule wants the app's radius and font token names; the
         portal has its own --radius-* and --font-sans, and pointing the rule at
         the app's names would demand tokens that don't exist here. */
      files: ["apps/portal/**/*.css"],
      rules: {
        "csstools/value-no-unknown-custom-properties": [true, { importFrom: PORTAL_TOKEN_FILES }],
        "scale-unlimited/declaration-strict-value": null,
        "tinkerbell/no-shadowed-primitive": null,
      },
    },
  ],

  ignoreFiles: ["**/node_modules/**", "**/dist/**", "**/.turbo/**"],
};
