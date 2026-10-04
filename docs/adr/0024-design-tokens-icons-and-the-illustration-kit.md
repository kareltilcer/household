# 0024 — The tokens are resolved values emitted three ways from one source, a drawing is data both clients draw, and Lucide and the fonts are pinned packages

- **Status:** Accepted
- **Date:** 2026-10-04
- **Plan item:** 23
- **Decides for:** [06-clients](../prd/06-clients.md) §1, §3, §4, §8; design [01-foundations](../design/01-foundations.md) §1, §2, §8, §10; DD-1, DD-5, DD-10; D-36, D-152; PL-11, PL-13; the plan's Q13

## Context

Plan item 23 ports `design/v1`'s tokens, icons and illustration kit into `@household/tokens` and
`@household/icons`, the two packages every screen of both clients is built from. The port is
mechanical (PL-11), and these questions were not:

1. **Q13: resolved values, or primitives.** 01-foundations §1 has three layers, primitives →
   semantic → component, and the prototype's 47 semantic and component tokens name a "primitive
   trail" each. Twenty-two of them sit off the ramp: `surface-raised` in dark is `neutral-900+`,
   `text-muted` is `neutral-500−`, and `focus` names an `indigo-500` the ramp does not have.
2. **What a theme scope is.** 01-foundations §2 puts the light palette on the root and dark's
   changes in a block. Item 24's twelve-state harness draws both themes on one page, so a theme is
   also set on an element inside a page of the other one, and a custom property that is
   `var(--positive)` on the root is computed there.
3. **Where the stylesheet comes from.** Both clients need the tokens before anything renders, and
   a design review needs to see a token change.
4. **What the two clients share of an icon.** D-36: no component. The web draws SVG in the DOM;
   React Native draws through react-native-svg, has no cascade to take `currentColor` from and no
   custom properties. The item's Done-when is that a composition renders the same on both.
5. **How the status set's greyscale gate is measured outside a browser.** The design rasterises
   each glyph on a canvas at 16 px and compares every pair as ink, with a floor of 0.40.
6. **Where Lucide and the fonts come from.** PL-13: Lucide vendored, IBM Plex self-hosted, neither
   fetched at runtime (N8).
7. **Where the illustration kit lives.** PL-1 lays out seven packages and names none for it.
8. **What the lint is made of.** 06-clients §8 lists it among the custom rules; item 23 named
   stylelint and ESLint, and stylelint cannot be installed: it reaches `braces` through
   micromatch (GHSA-vfj7-8cjw-p6xm, no patched version), which `pnpm audit` fails.

## Decision

**The semantic and component tokens are resolved values.** `color.ts` holds each token as its
light and its dark value, and the trail in its comment says where the value came from. The ramps
are `@household/tokens/primitives`: reference data that no stylesheet declares and application
code may not import (D-152). Seven tokens are another's value under their own name (`sameAs`), two
component backgrounds are a tested surface's value in each theme (`drawnAs`), and a test holds each
to that, so that one moving alone is a decision. Every colour token is in a declared pair, takes
the value of one that is, or is exempt with its reason: a test fails a token that is none of the
three. `hold-track` is the one exemption the design did not list: its value is `border-subtle`'s,
which is in no pair, so it carries a reason of its own.

**One source, three outputs.**

- `tokens.css`, from `src/css.ts`: **generated and committed**, written by
  `pnpm --filter @household/tokens css` (`pnpm run gen` runs it), and a test fails a committed one
  that is not what the emitter writes. It is committed so that both clients find it without a
  build and a token's change is a line of a diff.
- The TypeScript object, with `cssVar` for a custom property's name. `CustomProperty` is the union
  the emitter's declarations are typed by, so a name the stylesheet does not declare does not
  compile.
- `@household/tokens/native`: a theme per theme, with rem at 16 px, a line height as size times
  its multiplier, tracking as em times size, and a family per weight. It imports nothing of React
  Native's.

**A theme's block declares every colour name as a resolved value**, the thirteen statuses and the
sixteen module accents among them, and `data-theme` takes `light`, `dark` or `system` on the root
or on any element. The light block is `:root, [data-theme='light'], [data-theme='system']`; the
dark block redeclares only what changes, and the `system` block repeats it under
`prefers-color-scheme: dark`. `--dens-rule`, whose colour is a theme's, is the one reference: it is
declared on `:root, [data-theme]`, so each theme scope computes its own, and a compact scope and a
theme scope inside one take the divider. Reduced motion zeroes the three durations, under the
media query and under `data-motion='reduced'`, and leaves the thresholds: the 2000 ms hold is not a
duration token. `data-scale='200'` on the root doubles the root font size.

**A glyph or a composition is a drawing** (`svg.ts`): a tree of shapes whose attribute names are
the camel-cased ones React's SVG elements and react-native-svg's components both take.
`@household/icons/web` draws it with React DOM and `@household/icons/native` with
react-native-svg, each a few lines, and each typechecked in its own project against its library's
own prop types. The native components are given what the web inherits: an icon its colour, an
illustration its theme. A test draws the native components through a stand-in for
react-native-svg whose every element is the SVG element of the same name, and holds the markup to
the web's, element for element.

**The greyscale gate is measured by the stroke's own geometry** (`raster.ts`): path data flattened
to segments, and a pixel marked where more than 40/255 of it lies within half the stroke of one.
Round caps and joins make that exact, and it is the same on every machine. A pixel's cover is
counted on a 16 × 16 lattice: on 4 × 4, a pixel near the threshold lands on the wrong side, and
`conflict` and `private`, drawn on the same grid lines, measured 0.397 where they are 0.505.

**Lucide is a pinned devDependency, and what ships of it is committed.** `scripts/vendor.ts` reads
the manifest's 55 glyphs out of `lucide-static` into `src/lucide.json` as the drawing model's
shapes, and writes Lucide's licence beside it; a test fails a committed file that is not what the
pin gives. Seven glyphs Lucide has renamed keep the design's name (`lucideNames`). **The fonts are
pinned dependencies** of `@household/tokens`, `@fontsource-variable/ibm-plex-sans` and
`@fontsource/ibm-plex-mono`, which `fonts.css` imports and a bundler serves from the app's own
origin. A test opens the files: all of Latin Extended-A, Romanian's letters of Latin Extended-B,
digits of one width, and a Vite build whose stylesheet names no other origin. A native app
registers one static file per weight under the families `fonts.ts` names, which item 28 bundles.

**The illustration kit is part of `@household/icons`**: it draws through the same model and the
same two components, and it is spent with the icons.

**The lint is an ESLint rule and a check of the workspace's own.** `household/semantic-tokens`
holds `apps/**`'s TypeScript, and `tooling/src/stylesheets.ts` holds `apps/**/*.css`: it parses
a stylesheet with PostCSS, which Vite already brings, and each value with postcss-value-parser,
and reports a raw colour or a primitive (`pnpm run lint:css`, which `pnpm run lint` and CI run).
Both read one list of ramps, of colour names and of a hex colour's digits (`tooling/colours.js`),
and `tooling/src/token-lint.test.ts` holds both to their cases and the list to the package's ramps.
A stylesheet's value is a colour's wherever a name of one stands in it; a string of TypeScript is
looked at for a colour's name only where it is the value of a prop or a property that takes a
colour, however that value is chosen or built, so a colour's name held in a variable is a review's
to catch.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Semantic tokens as references to primitives (`--surface: var(--neutral-50)`), with a primitive added for each value off the ramp | Twenty-two primitives that exist for one token each are not a ramp. A reference computed on the root does not follow a theme set on an element inside it. And every primitive would be a custom property application code can reach |
| `tokens.css` generated on every build and not committed, as `@household/api`'s client is | A token's change would show in no diff, which is the review the design handoff asks for, and a client could not start before a `gen` had run |
| Aliases as `var()` references (`--status-synced: var(--positive)`), as the prototype emits | Computed where they are declared: a dark scope inside a light page would keep the light status colours. The harness of item 24 is that page |
| Shared components through React Native Web | D-36 |
| `lucide-react` and `lucide-react-native` as dependencies | Two packages, two renderers and 1 850 glyphs for 55. The glyphs' names would move under the screens when Lucide renames, as seven already have |
| A canvas or resvg for the greyscale test | A native binary per platform to measure thirteen glyphs, and antialiasing that differs between them |
| The font files committed to the repository | 440 kB of web fonts in 22 files, and the native files beside them, with nothing to diff. The packages are pinned, carry the licence, and the test reads the files that ship |
| A blanket `* { transition-duration: 0ms !important }`, as the prototype's stylesheet has | It would stop the hold's stepped fill, which reduced motion keeps. A component that animates by the duration tokens is already instant; a third party's animation is its screen's to handle |
| A package of its own for the illustration kit | It would share the drawing model and both components with the icons, and PL-1 names none |
| stylelint, as the plan named it | Its globbing reaches `braces` at every version, an advisory with no patched release, and `pnpm audit` gates CI. Item 18 met the same advisory through Metro and left the dependency out rather than the advisory out of the audit; the same choice here costs a hundred lines. When item 28 settles the advisory for a tree that runs Metro, stylelint can take the check over |

## Consequences

- A design change is a change to `packages/tokens/src`, then `pnpm --filter @household/tokens css`:
  the diff shows the value and the stylesheet, and the contrast test runs over it.
- A new status, a new module or a new token is a compile error or a failing test until it has its
  alias, its glyph, its label in five languages and its pair or exemption.
- An application names a colour only as a token: `var(--text-primary)` in a stylesheet,
  `cssVar('text-primary')` or a theme's value in TypeScript.
- The web stylesheet declares each colour name three times, about 230 declarations in all. That is
  the cost of a theme scope that works anywhere, and it compresses.
- The variable sans is measured at the instance its file opens at. That its digits keep one width
  at the weights between is IBM Plex's design and is not measured here: fontkit applies no
  variation to a WOFF2.
- A Lucide upgrade is a pin and `pnpm --filter @household/icons vendor`; the snapshot of each
  glyph's markup shows what moved.
- Item 24 imports `fonts.css` and `tokens.css`, sets `data-theme`, and hides an illustration at
  200 % text, which the kit's first rule leaves to the screen. Item 28 registers the font files.
