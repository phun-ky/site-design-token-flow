# Design token pills

Parses [DTCG 2025.10](https://www.designtokens.org/tr/2025.10/) design token files and renders each token as an HTML "pill".

This folder is meant to become its own npm package. Until then, it lives here so it can be refined against the Design Token Flow site.

## Boundary rules

- The app imports this folder only through [`index.ts`](./index.ts) and [`tokens-studio.ts`](./tokens-studio.ts), plus the stylesheet in [`styles/`](./styles). `tokens-studio.ts` is an entry of its own, a subpath export of the package later, so code that only renders pills doesn't load the converter.
- Nothing in here imports app code (flow view, Arclace lines, `site/` pages, app data).
- App-only styling goes in `src/styles/`, not here.

## Public API

| Export                                                    | What it does                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validateTokens(doc)`                                     | Validates a token document and flattens it, collecting every problem: returns `{ tokens, problems }`, the valid tokens and each problem with its token or group `path`, `message` and `error`, in document order. A token that only references a token with a problem is left out, but not reported |
| `flattenTokens(doc)`                                      | Like `validateTokens`, but returns the tokens and throws the first problem, such as a value that doesn't match its `$type`                                                                                                                                                                          |
| `validateTokenValue(name, $type, value, references?)`     | The check `validateTokens` runs per token: `TypeError` for a wrong shape or a reference to a token of the wrong `$type`, `RangeError` for out of range                                                                                                                                              |
| `validateProperties(kind, name, node)`                    | The check `validateTokens` runs per token and group: `$description` a string, `$deprecated` a boolean or string, `$extensions` an object, a group's `$type` from the spec                                                                                                                           |
| `renderDesignToken(token, options?)`                      | HTML string for one pill                                                                                                                                                                                                                                                                            |
| `createDesignTokenElement(token, options?)`               | The same pill as an `HTMLElement`                                                                                                                                                                                                                                                                   |
| `getDesignTokenKind(token)`                               | Which pill variant a token renders as                                                                                                                                                                                                                                                               |
| `toCssValue(token)` and `colorToCss`, `dimensionToCss`, … | Token value to CSS value                                                                                                                                                                                                                                                                            |
| `fitWrappedValues(root?)`                                 | Narrows wrapped pill values to their widest line, after rendering and when fonts load                                                                                                                                                                                                               |
| `getFontFaces(tokens)`                                    | Font faces (family, `src` and descriptors) that `fontFamily` tokens describe                                                                                                                                                                                                                        |
| `DTF_EXTENSION_KEY`, `getExtension(token)`                | This tool's `$extensions` data                                                                                                                                                                                                                                                                      |
| `mergeTokenDocuments(base, incoming)`                     | Merges one document into a copy of another: returns `{ document, added, overwritten, unchanged }`. A token of the same name is overwritten; each incoming token keeps the `$type` its own groups give it                                                                                            |
| Types                                                     | `DTCGDocument`, `FlatDesignToken`, every `$type` value shape                                                                                                                                                                                                                                        |

### Tokens Studio, from [`tokens-studio.ts`](./tokens-studio.ts)

| Export                                | What it does                                                                                                                                                                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isTokensStudio(json)`                | Whether JSON is a Tokens Studio for Figma file: `$themes` or `$metadata`, `value`/`type` keys, a type only Tokens Studio uses, or a colour written as a string                                                                                                  |
| `readTokensStudio(json)`              | Its token sets in order, themes and key style. Top-level keys are sets when the file has `$themes` or `$metadata`; otherwise the whole file is one set                                                                                                          |
| `setsForTheme(file, theme?)`          | Each set's use for a theme: enabled and source sets included, disabled ones left out                                                                                                                                                                            |
| `convertTokensStudio(file, uses)`     | A DTCG 2025.10 document and a report of every token whose math was worked out, references resolved, colour modifier applied, value changed or filled in, overridden by a later set, or left out. What DTCG can't hold is kept in `$extensions` for the way back |
| `toTokensStudio(tokens, root?, set?)` | Tokens as a Tokens Studio file: unchanged tokens from Tokens Studio as they were, in their sets, with the file's themes and the tokens left out; changed and new tokens converted                                                                               |
| `evaluateMath(text)`                  | Tokens Studio's math, such as `8px * 2`, with a parser of its own, never `eval`                                                                                                                                                                                 |

Colour modifiers (lighten, darken, alpha, mix) work in sRGB, HSL, Display P3 and CIE LCH with the matrices of CSS Color 4, and match colorjs.io, which Tokens Studio's sd-transforms uses. Tokens without a DTCG type (`composition`, `asset`, `boolean`, `text`, `textCase`, `textDecoration`, `other`) are left out and reported, and kept for the export.

Styles: [`styles/design-token.css`](./styles/design-token.css), themed with `--dtf-*` custom properties and `:root.theme--light`.

### Font files in tokens

A `fontFamily` token can list its font files, by format, and its `@font-face` descriptors in this tool's extension:

```json
{
  "$type": "fontFamily",
  "$value": "IBM Plex Sans Var",
  "$extensions": {
    "net.phun-ky.design-token-flow": {
      "files": { "woff2": "./fonts/IBM Plex Sans Var-Roman.woff2" },
      "font-face": { "weight": "100 700" }
    }
  }
}
```

`getFontFaces(tokens)` turns such tokens into `{ family, source, descriptors }`, ready for `new FontFace(family, source, descriptors)` or an `@font-face` rule. Formats are tried as `woff2`, `woff`, `ttf`, `otf`, `eot`; `display` defaults to `swap`. Paths are used as given, so relative paths resolve against the page. Font family pills show an "Aa" sample in their family, which uses the font once the page has loaded it.

## Extracting into a package

1. Create the new repo from this folder: `index.ts`, `types/`, `utils/` (with `__tests__/`) and `styles/`.
2. Decide on the package name. If it changes, consider renaming `DTF_EXTENSION_KEY` (`net.phun-ky.design-token-flow`) and the `--dtf-` prefix, and keep reading the old key for existing token files.
3. Build it with Vite library mode (config below), and build the CSS from the Stylus file.
4. Publish, then replace `src/tokens` in this repo with the package.

This library config worked here before the repo became a site:

```ts
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts'; // also needs @microsoft/api-extractor for bundleTypes

export default defineConfig({
  build: {
    sourcemap: true,
    minify: true,
    lib: {
      entry: 'index.ts',
      name: 'DesignTokenPills',
      formats: ['es', 'umd'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.umd.cjs')
    },
    rolldownOptions: {
      // `banner` is stripped by the minifier in the UMD build, `postBanner` is added after it
      output: { postBanner: '/** license header */' }
    }
  },
  plugins: [dts({ exclude: ['**/__tests__/**'], bundleTypes: true })]
});
```

Things learned along the way:

- Don't set `output.exports: 'named'` on an entry without exports: the UMD wrapper then references an undefined `exports` and crashes on load.
- Vite keeps whitespace in ES library output on purpose, so consumers can tree-shake it. Expect it to be bigger than the UMD file.
