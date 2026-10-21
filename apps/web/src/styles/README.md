# Styles

Three layers. Almost everything you want already exists in one of them, and the
lint rules exist to make you look before you type.

| Layer          | Where                                             | What belongs there                                                               |
| -------------- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Tokens**     | `App.css`                                         | Every colour, radius, type face and z-index the app may use. Both themes.        |
| **Primitives** | `styles/controls.module.css`, `shared.module.css` | Buttons, inputs, selects; tables, panels, chips, toolbars, empty states.         |
| **Page**       | `pages/*.module.css`, `components/*.module.css`   | What is genuinely local to one screen: a grid template, a max-width, a stacking. |

A page module should be mostly layout. If it is setting a colour, a border, a
control height or a font, it is usually reimplementing something.

## Using a primitive

```css
.headerBtn {
  composes: btn btnSecondary btnSm from "../../styles/controls.module.css";
}

/* Composed, then narrowed — the local part is the only part that is local. */
.table {
  composes: table from "../../styles/shared.module.css";
  max-width: 72ch;
}
```

`rube/no-shadowed-primitive` fails the build if a module _declares_ a
class named after a primitive instead of composing it. That rule exists because
`.table` was once declared in four stylesheets, each with a different row
height, and nobody noticed for months — you don't open four files at once.

If your thing genuinely isn't the shared thing, give it a different name. A
pack card is `.packCard`, a login box is `.loginCard`. Same name, same thing.

### Size is the primitive's

`rube/primitive-geometry` is the other half. Composing a primitive and
then overriding its size is how drift came back after `.table` stopped being
redeclared: Backup and Watchlist composed `.table` and re-padded its cells to
~28px rows, the Overlays bar built 30px buttons, and new pages looked squashed
beside old ones. So, in a page module:

- A class composing `btn`, `input`/`select`/`textarea`, `segmented*`, `table`
  or `compactTable` may not set `height`, `padding`, `font-size`/`font`,
  `line-height` or `border-radius`. Colour, width, margin and layout are
  yours. (A field may set a side inset for an adornment; a textarea may set
  `min-height`.)
- `th`/`td` geometry belongs to the table primitive, whatever class it hangs
  off. A table inside a card or modal is `compactTable`; row headers
  (`<th scope="row">`) are styled by the primitive.
- A class named like a button (`saveBtn`, `refreshButton`) must be built from
  one, and composing a colour (`btnGhost`) without `btn` is an error — that is
  a button with no height.
- Anything `cursor: pointer` at a literal 24–48px height is a control with a
  height of its own: use `var(--control-h)` or compose.

The same holds in JSX: `className={controls.btnPrimary}` on its own is a
button with no height, and `scripts/check-button-classes.mjs` (part of
`pnpm lint`) fails on it. A page-level list is `shared.table` inside
`<div className="table-scroll">`, which is the card around it.

Need a different size? Pick a modifier — `btnSm`, `btnIcon` (square, for a
glyph), `btnLink` (a button that reads as a link), `inputSm`, `compactTable` —
and if none fits, add one to `styles/` rather than overriding locally.

## Using a token

```css
color: var(--ink-2);
background: var(--surface-sunken);
border: 1px solid var(--line);

/* A tint of a token, rather than an rgba() nobody can trace back: */
background: color-mix(in srgb, var(--danger) 8%, transparent);
```

Colour literals are rejected — `color-no-hex`, `color-named`, and no
`rgb()`/`rgba()`/`hsl()`. Every rgba in the app was an exact alpha of a colour
that already had a token; `color-mix()` says the same thing and says _which_
colour. `var(--x)` naming a token nothing defines is rejected too, which is how
`var(--border)` and `var(--warn)` were found quietly falling back to their
literals on the Registry page.

Naming, roughly: `--ink*` text, `--surface*` backgrounds, `--line*` borders,
`--fill-*` the fill of a control, `--on-*` ink that sits on a surface which is
dark in _both_ themes (`--on-accent`, `--on-dark`, `--on-inverse`, `--on-plex`),
`--status-*` the ok/warn/error/info/neutral/special families, `--r-*` radii,
`--t-*` type, `--z-*` stacking.

### Adding a token

Add it when the app has a role it didn't have, not when you want a shade. Give
it a value in **both** `:root` and the `:root[data-theme="dark"]` block, and a
comment saying when to reach for it. If the answer is "one element on one
page", you want a local value in that module, not a token.

The dark block is keyed off an attribute rather than `prefers-color-scheme`
because the scheme is a user choice — System / Light / Dark, in Settings ›
Appearance and in the app bar. `src/theme.ts` resolves the choice (consulting
the media query only in System mode) and writes the answer to `<html>`; a boot
script in `index.html` does the same before first paint. Style against
`:root[data-theme="dark"]`, never against the media query — a media-query rule
would ignore a pinned scheme.

## Exceptions

Some things really aren't ours. Say so on the line, with a reason —
`reportDescriptionlessDisables` rejects a bare disable:

```css
/* stylelint-disable-next-line color-no-hex -- letterbox behind a video, black in every theme */
background: #000;
```

Whole-file, at the top, is right when the file is a different visual domain —
`pages/Preview.module.css` is a facsimile of the Plex web client and uses Plex's
palette on purpose.

`pnpm lint:css:report` lists disables that no longer suppress anything, so the
set of exceptions stays honest instead of accumulating.

## Commands

```sh
pnpm lint          # everything, including CSS
pnpm lint:css      # just the stylesheets
pnpm lint:css:report   # find stale/invalid disables
```

Config is `stylelint.config.mjs` at the repo root; the primitive rules are
`stylelint-plugins/no-shadowed-primitive.mjs` and
`stylelint-plugins/primitive-geometry.mjs`. The marketing site and the portal
are exempt — separate products, their own palettes, no path to these tokens.
