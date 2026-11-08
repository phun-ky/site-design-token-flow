import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findCssColours, findHtmlColours, findScriptColours } from '../colours';

describe('findCssColours', () => {
  it('allows colours as the values of custom properties', () => {
    const css = `:root {
  --bg: #1b1b1f;
  --text: rgba(255, 255, 245, 0.86);
  --shadow:
    0 1px 2px rgba(0, 0, 0, 0.04),
    0 1px 2px black;
}
:root.theme--light { --bg: #fff; --ring: oklch(0.6 0.02 260); }`;

    assert.deepEqual(findCssColours(css), []);
  });

  it('finds colours used directly, on their own lines', () => {
    const css = `.a {
  color: #000;
  background: rgb(0 84 240 / 0.5);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.04),
    0 0 0 1px white;
}
.b { border-color: hsl(210, 10%, 40%) }`;

    assert.deepEqual(findCssColours(css), [
      { line: 2, colour: '#000' },
      { line: 3, colour: 'rgb(0 84 240 / 0.5)' },
      { line: 5, colour: 'rgba(0, 0, 0, 0.04)' },
      { line: 6, colour: 'white' },
      { line: 8, colour: 'hsl(210, 10%, 40%)' }
    ]);
  });

  it('finds every colour notation', () => {
    const values = [
      '#abc',
      '#abcd',
      '#aabbcc',
      '#aabbccdd',
      'rgba(0, 0, 0, 0.5)',
      'hsla(0, 0%, 0%, 0.5)',
      'hwb(0 0% 0%)',
      'lab(50% 0 0)',
      'lch(50% 0 0)',
      'oklab(0.5 0 0)',
      'oklch(0.5 0.1 260)',
      'color(display-p3 1 0 0)',
      'RebeccaPurple'
    ];
    const css = values.map((value) => `.a { color: ${value}; }`).join('\n');

    assert.deepEqual(
      findCssColours(css).map(({ colour }) => colour),
      values
    );
  });

  it('allows tokens, keywords and colours made from tokens', () => {
    const css = `.a {
  color: var(--app-text);
  background: transparent;
  border-color: currentColor;
  outline-color: rgb(var(--rgb-brand) / 0.2);
  fill: color-mix(in srgb, var(--a), var(--b));
  white-space: nowrap;
}`;

    assert.deepEqual(findCssColours(css), []);
  });

  it('skips comments, selectors, strings and urls', () => {
    const css = `/* Darker than #8b98ff: 4.66:1 on white */
#face:hover, #add { font-family: "Black Han Sans", serif; }
.a { background: url("data:image/svg+xml,<svg fill='red'/>"); content: 'red'; }
@media (prefers-color-scheme: dark) { .b { color: var(--x); } }`;

    assert.deepEqual(findCssColours(css), []);
  });

  it('checks the declarations of a style attribute', () => {
    assert.deepEqual(findCssColours('--x: red; color: tomato'), [
      { line: 1, colour: 'tomato' }
    ]);
  });
});

describe('findScriptColours', () => {
  it('finds colours in strings, on their own lines', () => {
    const source = `const a = '#000';
const b = "rgb(0, 0, 0)";
element.style.boxShadow = \`0 0 0 1px #fff\`;`;

    assert.deepEqual(findScriptColours(source), [
      { line: 1, colour: '#000' },
      { line: 2, colour: 'rgb(0, 0, 0)' },
      { line: 3, colour: '#fff' }
    ]);
  });

  it('skips comments, code, colour names and colours made in code', () => {
    const source = `// e.g. #0054f0
/**
 * @example
 * toCss(value); // => 'rgb(0 84 240 / 0.5)'
 */
const weight = 'black';
const hex = 0xfff;
const css = \`rgb(\${channels} / \${alpha})\`;
const hash = \`#\${hex}\`;
const id = document.querySelector('#groups');`;

    assert.deepEqual(findScriptColours(source), []);
  });

  it('keeps going after escaped quotes', () => {
    const source = `const a = 'it\\'s #fff';\nconst b = "#000";`;

    assert.deepEqual(findScriptColours(source), [
      { line: 1, colour: '#fff' },
      { line: 2, colour: '#000' }
    ]);
  });
  it('reads quotes in regular expressions as part of them, not as strings', () => {
    const source = `const text = /"(?:[^"])*"|'[^']*'/g;
/** A comment with "quotes" and #fff */
const half = width / 2 / scale;
const b = '#000';
if (x) return /\`/.test(y) ? '#123' : z;`;

    assert.deepEqual(findScriptColours(source), [
      { line: 4, colour: '#000' },
      { line: 5, colour: '#123' }
    ]);
  });

  it('skips the line after a check-colours-ignore-next-line comment', () => {
    const source = `// check-colours-ignore-next-line: an example in the error message
fail('a 6 digit hex color like #0054f0');
/* check-colours-ignore-next-line: also in a block comment */
const a = '#aaa';
const b = '#bbb';`;

    assert.deepEqual(findScriptColours(source), [{ line: 5, colour: '#bbb' }]);
  });
});

describe('findHtmlColours', () => {
  it('allows the theme colour meta and links to ids', () => {
    const html = `<meta name="theme-color" content="#1b1b1f" media="(prefers-color-scheme: dark)">
<a href="#add">Add</a>
<svg><path fill="currentColor" stroke="var(--app-brand)"/></svg>
<p style="--accent: #fff; color: var(--accent)">Text</p>`;

    assert.deepEqual(findHtmlColours(html), []);
  });

  it('finds colours in style elements, style attributes and colour attributes', () => {
    const html = `<!doctype html>
<style>
  .a { color: #000; }
</style>
<p style="color: red">Text</p>
<svg><path fill='#fff'/><stop stop-color="rgb(0, 0, 0)"/></svg>
<STYLE media="print">.b { color: navy }</STYLE >`;

    assert.deepEqual(findHtmlColours(html), [
      { line: 3, colour: '#000' },
      { line: 5, colour: 'red' },
      { line: 6, colour: '#fff' },
      { line: 6, colour: 'rgb(0, 0, 0)' },
      { line: 7, colour: 'navy' }
    ]);
  });
});
