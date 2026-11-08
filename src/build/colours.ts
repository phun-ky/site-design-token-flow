/**
 * Finds colours written outside the colour tokens, for `npm run check:colours`.
 * A colour may only be written as the value of a CSS custom property, such as
 * `--app-bg: #1b1b1f`, so each theme can redefine it. Every other use reads a
 * token with `var()`.
 */

export interface Colour {
  /** The line the colour is on, from 1 */
  line: number;
  /** The colour as written */
  colour: string;
}

// The CSS named colours, without transparent and currentColor, which aren't
// part of a theme
const NAMES = [
  'aliceblue',
  'antiquewhite',
  'aqua',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'blue',
  'blueviolet',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'fuchsia',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'gray',
  'green',
  'greenyellow',
  'grey',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'lime',
  'limegreen',
  'linen',
  'magenta',
  'maroon',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'navy',
  'oldlace',
  'olive',
  'olivedrab',
  'orange',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'pink',
  'plum',
  'powderblue',
  'purple',
  'rebeccapurple',
  'red',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'silver',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'teal',
  'thistle',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'whitesmoke',
  'yellow',
  'yellowgreen'
];
// Hex colours, and colour functions with numbers instead of a token, like
// rgb(0 0 0 / 0.2) but not rgb(var(--rgb-shadow) / 0.2)
const HEX = /#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{3,4})\b/;
const FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[\d.][^)]*\)/;
const COLOR_FUNCTION = /\bcolor\(\s*[a-z][\w-]*\s+[\d.][^)]*\)/;
const LITERAL = new RegExp(
  [HEX, FUNCTION, COLOR_FUNCTION].map(({ source }) => source).join('|'),
  'gi'
);
const NAMED = new RegExp(`(?<![-\\w])(?:${NAMES.join('|')})(?![-\\w])`, 'gi');
// Quoted strings and url() in CSS
const TEXT = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|url\([^)]*\)/g;
// Attributes that take a colour in HTML and inline SVG. `content`, which holds
// the colour of <meta name="theme-color">, isn't one: that colour can't come
// from CSS
const ATTRIBUTE_VALUE = String.raw`\s*=\s*(?:"([^"]*)"|'([^']*)')`;
const COLOUR_ATTRIBUTE = new RegExp(
  String.raw`\s(?:fill|stroke|stop-color|flood-color|lighting-color|color|bgcolor)` +
    ATTRIBUTE_VALUE,
  'gi'
);
const STYLE_ATTRIBUTE = new RegExp(String.raw`\sstyle` + ATTRIBUTE_VALUE, 'gi');
const STYLE_ELEMENT = /<style\b[^>]*>([\s\S]*?)<\/style[^>]*>/gi;
/** The line of an offset in a text, from 1 */
const lineAt = (text: string, offset: number): number =>
  text.slice(0, offset).split('\n').length;
/** Replaces each match with spaces, keeping line breaks, so offsets hold */
const blank = (text: string, pattern: RegExp): string =>
  text.replace(pattern, (match) => match.replace(/[^\n]/g, ' '));
/**
 * The colours in a text, with their offsets, in order. In CSS, colour names
 * inside strings and url() are text, such as a font name, so they're skipped.
 */
const coloursIn = (
  text: string,
  css = true
): { offset: number; colour: string }[] => {
  const code = css ? blank(text, TEXT) : text;
  const matches = [...code.matchAll(LITERAL)];

  if (css) matches.push(...code.matchAll(NAMED));

  return matches
    .map((match) => ({ offset: match.index, colour: match[0] }))
    .sort((a, b) => a.offset - b.offset);
};
/** Moves colours found in a part of a text to the text's lines */
const shift = (colours: Colour[], text: string, offset: number): Colour[] =>
  colours.map(({ line, colour }) => ({
    line: line + lineAt(text, offset) - 1,
    colour
  }));

/**
 * Finds the colours in a stylesheet that aren't the value of a custom property.
 *
 * @param {string} css A stylesheet, or the declarations of a style attribute
 * @returns {Colour[]} The colours, with their lines
 * @example
 * findCssColours(':root { --bg: #fff; }\nbody { color: #000; }');
 * // => [{ line: 2, colour: '#000' }]
 */
export const findCssColours = (css: string): Colour[] => {
  const code = blank(css, /\/\*[\s\S]*?\*\//g);
  const found: Colour[] = [];

  // Each part ends at a ;, { or }. One that ends at { is a selector or an
  // at-rule; the others are declarations
  for (const { 0: part, index } of code.matchAll(/[^;{}]+[;{}]?/g)) {
    const colon = part.indexOf(':');

    if (part.endsWith('{') || colon === -1) continue;

    // A custom property defines a token
    if (part.slice(0, colon).trim().startsWith('--')) continue;

    for (const { offset, colour } of coloursIn(part.slice(colon + 1))) {
      found.push({ line: lineAt(code, index + colon + 1 + offset), colour });
    }
  }

  return found;
};

// Comments, strings and regular expression literals in a script
const COMMENT = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y;
const STRING = /(['"`])(?:\\[\s\S]|(?!\1)[^\\])*\1?/y;
const REGEX = /\/(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[a-z]*/y;
const WORD = /[\w$]+/y;
// A / after one of these starts a regular expression; after anything else,
// such as a name or a ), it divides
const BEFORE_REGEX = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const KEYWORDS_BEFORE_REGEX = new Set([
  'return',
  'typeof',
  'case',
  'do',
  'else',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'yield',
  'await'
]);
// A comment with this skips the next line, for a colour that is text, such as
// an example in an error message. Say why after it
const IGNORE = 'check-colours-ignore-next-line';
/** Matches a sticky pattern at an offset */
const at = (pattern: RegExp, text: string, offset: number) => {
  pattern.lastIndex = offset;

  return pattern.exec(text);
};

/**
 * Finds the colours written in a script's strings. Colour names aren't
 * looked for, since words like `black` are also font weights. A comment with
 * `check-colours-ignore-next-line` skips the line after it.
 *
 * @param {string} source A TypeScript or JavaScript module
 * @returns {Colour[]} The colours, with their lines
 * @example
 * findScriptColours("// #fff in a comment\nel.style.color = '#000';");
 * // => [{ line: 2, colour: '#000' }]
 */
export const findScriptColours = (source: string): Colour[] => {
  const found: Colour[] = [];
  const ignored = new Set<number>();

  let previous = '';
  let index = 0;

  // Walk the code, skipping comments and regular expressions, and look in
  // each string
  while (index < source.length) {
    const char = source[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    const comment = at(COMMENT, source, index);

    if (comment) {
      if (comment[0].includes(IGNORE)) {
        ignored.add(lineAt(source, index + comment[0].length) + 1);
      }

      index += comment[0].length;
      continue;
    }

    const regex =
      char === '/' &&
      (previous === '' ||
        BEFORE_REGEX.has(previous) ||
        KEYWORDS_BEFORE_REGEX.has(previous))
        ? at(REGEX, source, index)
        : null;
    const token = regex ?? at(STRING, source, index) ?? at(WORD, source, index);

    if (token === null) {
      previous = char;
      index += 1;
      continue;
    }

    const isString = regex === null && /^['"`]/.test(token[0]);

    if (isString) {
      for (const { offset, colour } of coloursIn(token[0], false)) {
        found.push({ line: lineAt(source, index + offset), colour });
      }
    }

    index += token[0].length;
    // A string or a regular expression is a value, like a name
    previous = regex !== null || isString ? 'a' : token[0];
  }

  return found.filter(({ line }) => !ignored.has(line));
};

/**
 * Finds the colours in a page's `<style>` elements, `style` attributes and
 * colour attributes such as an inline SVG's `fill`. The page's
 * `<meta name="theme-color">` may hold a colour: the browser reads it before
 * any CSS.
 *
 * @param {string} html A page
 * @returns {Colour[]} The colours, with their lines
 * @example
 * findHtmlColours('<meta name="theme-color" content="#fff">\n<p style="color: red">');
 * // => [{ line: 2, colour: 'red' }]
 */
export const findHtmlColours = (html: string): Colour[] => {
  const found: Colour[] = [];

  for (const match of html.matchAll(STYLE_ELEMENT)) {
    const css = match[1];

    found.push(
      ...shift(findCssColours(css), html, match.index + match[0].indexOf(css))
    );
  }

  for (const match of html.matchAll(STYLE_ATTRIBUTE)) {
    const css = match[1] ?? match[2];

    found.push(
      ...shift(findCssColours(css), html, match.index + match[0].indexOf(css))
    );
  }

  for (const match of html.matchAll(COLOUR_ATTRIBUTE)) {
    const value = match[1] ?? match[2];
    const start = match.index + match[0].lastIndexOf(value);

    for (const { offset, colour } of coloursIn(value)) {
      found.push({ line: lineAt(html, start + offset), colour });
    }
  }

  return found.sort((a, b) => a.line - b.line);
};
