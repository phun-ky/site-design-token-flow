import type { DTCGColorValue, DTCGDocument, DTCGType } from '../types/tokens';

import {
  darken,
  lighten,
  mix,
  parseColor,
  rgbToDtcg,
  rgbToHex,
  withAlpha,
  type ModifierSpace,
  type Rgba
} from './color-space';
import { colorToCss, colorToHex, DTF_EXTENSION_KEY } from './design-tokens';
import { evaluateMath, isMath } from './token-math';
import { FONT_WEIGHT_KEYWORDS } from './validate-token';

/**
 * Converts Tokens Studio for Figma's JSON to DTCG 2025.10, and back (#113,
 * #115). Based on the plugin's own source and sd-transforms:
 *
 * - A file's top-level keys are token sets when it has `$themes` or
 *   `$metadata`; otherwise the whole file is one set.
 * - Tokens use `value`/`type`/`description`, or `$value`/`$type`/
 *   `$description` with the "W3C DTCG" setting; the values have Tokens
 *   Studio's shapes either way.
 * - Sets apply in order, later ones winning by token name. A theme marks
 *   each set enabled, source (only resolves references) or disabled.
 * - References may sit inside text and math (`{space.base} * 2`), and colour
 *   tokens may carry a modifier in `$extensions["studio.tokens"].modify`.
 *
 * What DTCG can't hold is kept in this tool's `$extensions`, per token and on
 * the document, so the export restores the file.
 */

type Json = Record<string, unknown>;

/** How a set is used: its tokens added, only resolving references, or not at all */
export type SetUse = 'included' | 'reference' | 'left-out';

export interface TokensStudioTheme {
  id: string;
  name: string;
  group?: string;
  selectedTokenSets: Record<string, 'enabled' | 'source' | 'disabled'>;
}

export interface TokensStudioSet {
  name: string;
  tokens: Json;
  /** Tokens in the set */
  count: number;
}

export interface TokensStudioFile {
  /** `value`/`type`, or `$value`/`$type` */
  keyStyle: 'legacy' | 'dtcg';
  /** In the order they apply */
  sets: TokensStudioSet[];
  themes: TokensStudioTheme[];
  /** Whether the file had sets (`$themes` or `$metadata`), or was one set */
  hasSets: boolean;
}

export type NoteKind =
  | 'math'
  | 'modified'
  | 'resolved'
  | 'changed'
  | 'defaulted'
  | 'overridden'
  | 'left-out';

export interface ConversionNote {
  /** The token's name, such as `color.primary` */
  name: string;
  kind: NoteKind;
  detail: string;
}

export interface Conversion {
  document: DTCGDocument;
  /** Tokens in the document */
  converted: number;
  notes: ConversionNote[];
}

/** What a converted token keeps for the export */
export interface TokensStudioOrigin {
  set: string;
  /** The token as it was in the file */
  original: Json;
  /** A hash of the DTCG `$value` it was converted to, to tell a changed token */
  hash: string;
  $type: DTCGType;
}

/** What the document keeps for the export: the rest of the file */
export interface TokensStudioDocument {
  keyStyle: 'legacy' | 'dtcg';
  hasSets: boolean;
  order: string[];
  themes: TokensStudioTheme[];
  /** Tokens not converted, per set: other sets, overridden and left out */
  remainder: Record<string, Json>;
  /** Each group's own properties, such as its type, per set and path */
  groups: Record<string, Record<string, Json>>;
}

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isToken = (node: Json) => 'value' in node || '$value' in node;
const valueOf = (node: Json) => ('$value' in node ? node.$value : node.value);
const typeOf = (node: Json) => (node.$type ?? node.type) as string | undefined;
const ALIAS = /^\{([^{}]+)\}$/;
const REFERENCE = /\{([^{}]+)\}/g;
const HAS_REFERENCE = /\{[^{}]+\}/;
// Types Tokens Studio writes, by the name it normalises them to
// (src/utils/tokensStudio/normalizeTokenType.ts in the plugin)
const TYPE_ALIASES: Record<string, string> = {
  fontWeight: 'fontWeights',
  fontFamily: 'fontFamilies',
  fontSize: 'fontSizes',
  lineHeight: 'lineHeights',
  shadow: 'boxShadow'
};
const DIMENSION_TYPES = new Set([
  'dimension',
  'sizing',
  'spacing',
  'borderRadius',
  'borderWidth',
  'fontSizes',
  'letterSpacing',
  'paragraphSpacing',
  'paragraphIndent'
]);
// Tokens Studio types that only it uses, which tell its files apart
const STUDIO_TYPES = new Set([
  // dimension is a DTCG type too
  ...[...DIMENSION_TYPES].filter((type) => type !== 'dimension'),
  'fontWeights',
  'fontFamilies',
  'lineHeights',
  'boxShadow',
  'opacity',
  'composition',
  'asset',
  'text',
  'textCase',
  'textDecoration',
  'other',
  'boolean'
]);
// No DTCG type: kept for the export, and reported
const UNSUPPORTED_TYPES = new Set([
  'boolean',
  'text',
  'content',
  'textCase',
  'textDecoration',
  'asset',
  'composition',
  'other'
]);
const STROKE_STYLES = new Set([
  'solid',
  'dashed',
  'dotted',
  'double',
  'groove',
  'ridge',
  'outset',
  'inset'
]);
// Figma's style names for weights, as Tokens Studio writes them
const WEIGHT_NAMES: Record<string, number> = {
  ...FONT_WEIGHT_KEYWORDS,
  'ultra light': 200,
  regular: 400,
  book: 400,
  'semi bold': 600,
  semibold: 600,
  'demi bold': 600,
  'extra bold': 800,
  extrabold: 800,
  'ultra bold': 800,
  heavy: 900
};
const normaliseType = (type: string | undefined) =>
  type ? (TYPE_ALIASES[type] ?? type) : undefined;
/** Walks a set's tokens: name, the token, and its type inherited from groups */
const walk = (
  node: Json,
  visit: (name: string, token: Json, type: string | undefined) => void,
  path: string[] = [],
  inherited?: string
) => {
  const type = normaliseType(typeOf(node)) ?? inherited;

  Object.entries(node).forEach(([key, child]) => {
    if (key.startsWith('$') || !isObject(child)) return;

    if (isToken(child))
      visit(
        [...path, key].join('.'),
        child,
        normaliseType(typeOf(child)) ?? type
      );
    else walk(child, visit, [...path, key], type);
  });
};

/**
 * Whether JSON is a Tokens Studio file: it has `$themes` or `$metadata`,
 * tokens with `value` instead of `$value`, a type only Tokens Studio uses,
 * or a colour written as a string.
 *
 * @param {unknown} json The parsed file
 * @returns {boolean} Whether to convert it
 */
export const isTokensStudio = (json: unknown): boolean => {
  if (!isObject(json)) return false;

  if ('$themes' in json || '$metadata' in json) return true;

  let found = false;

  walk(json, (_name, token, type) => {
    if (found) return;

    const value = valueOf(token);

    found =
      !('$value' in token) ||
      STUDIO_TYPES.has(type ?? '') ||
      (type === 'color' && typeof value === 'string' && !ALIAS.test(value));
  });

  return found;
};

/**
 * Reads a Tokens Studio file's sets, themes and key style.
 *
 * @param {Json} json The parsed file
 * @returns {TokensStudioFile} Its sets, in order, and themes
 */
export const readTokensStudio = (json: Json): TokensStudioFile => {
  const hasSets = '$themes' in json || '$metadata' in json;
  const metadata = isObject(json.$metadata) ? json.$metadata : {};
  const listed = Array.isArray(metadata.tokenSetOrder)
    ? (metadata.tokenSetOrder as unknown[]).filter(
        (name): name is string =>
          typeof name === 'string' && isObject(json[name])
      )
    : [];
  const names = hasSets
    ? [
        ...listed,
        ...Object.keys(json).filter(
          (key) =>
            !key.startsWith('$') && isObject(json[key]) && !listed.includes(key)
        )
      ]
    : ['global'];
  const sets = names.map((name) => {
    const tokens = (hasSets ? json[name] : json) as Json;

    let count = 0;

    walk(tokens, () => (count += 1));

    return { name, tokens, count };
  });

  let dtcg = false;

  sets.forEach(({ tokens }) =>
    walk(tokens, (_name, token) => (dtcg ||= '$value' in token))
  );

  return {
    keyStyle: dtcg ? 'dtcg' : 'legacy',
    sets,
    themes: Array.isArray(json.$themes)
      ? (json.$themes as unknown[]).filter(
          (theme): theme is TokensStudioTheme =>
            isObject(theme) &&
            typeof theme.name === 'string' &&
            isObject(theme.selectedTokenSets)
        )
      : [],
    hasSets
  };
};

/**
 * How each set is used for a theme: enabled sets are included, disabled ones
 * left out. Source sets only resolve references in Tokens Studio; here they
 * are included too, so the flow shows the values the theme's tokens end at.
 * Without a theme, every set is included.
 *
 * @param {TokensStudioFile} file The file
 * @param {TokensStudioTheme} [theme] The theme
 * @returns {Record<string, SetUse>} Each set's use
 */
export const setsForTheme = (
  file: TokensStudioFile,
  theme?: TokensStudioTheme
): Record<string, SetUse> =>
  Object.fromEntries(
    file.sets.map(({ name }) => {
      const status = theme
        ? (theme.selectedTokenSets[name] ?? 'disabled')
        : 'enabled';

      return [name, status === 'disabled' ? 'left-out' : 'included'];
    })
  );

/** FNV-1a: a short hash of a value, to tell a changed token on export */
export const hashValue = (value: unknown): string => {
  let hash = 0x811c9dc5;

  for (const char of JSON.stringify(value) ?? '') {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
};

interface Entry {
  name: string;
  set: string;
  use: SetUse;
  token: Json;
  type: string | undefined;
}

class Unsupported extends Error {}

/** A colour as hex, with 8 digits when it has alpha */
const hexOf = (rgb: Rgba) => {
  const alpha = Math.round(rgb.alpha * 255)
    .toString(16)
    .padStart(2, '0');

  return rgb.alpha < 1 ? `${rgbToHex(rgb)}${alpha}` : rgbToHex(rgb);
};
const round = (value: number, digits = 4) =>
  Math.round(value * 10 ** digits) / 10 ** digits;
const toNumber = (value: unknown, what: string): number => {
  const number = typeof value === 'number' ? value : Number(value);

  if (typeof value === 'boolean' || value === '' || !Number.isFinite(number))
    throw new Unsupported(`${what} ${JSON.stringify(value)} is not a number`);

  return number;
};
const dimension = (value: unknown, what = 'Dimension') => {
  if (isObject(value) && 'value' in value && 'unit' in value)
    return dimension(`${value.value}${value.unit}`, what);

  if (typeof value === 'number') return { value, unit: 'px' as const };

  const match = String(value)
    .trim()
    .match(/^(-?\d*\.?\d+)(px|rem)?$/);

  if (!match)
    throw new Unsupported(
      `${what} ${JSON.stringify(value)}: DTCG dimensions are px or rem`
    );

  return { value: Number(match[1]), unit: (match[2] ?? 'px') as 'px' | 'rem' };
};
const duration = (value: unknown) => {
  if (isObject(value) && 'value' in value)
    return duration(`${value.value}${value.unit ?? 'ms'}`);

  if (typeof value === 'number') return { value, unit: 'ms' as const };

  const match = String(value)
    .trim()
    .match(/^(\d*\.?\d+)(ms|s)?$/);

  if (!match)
    throw new Unsupported(`Duration ${JSON.stringify(value)} is not ms or s`);

  return { value: Number(match[1]), unit: (match[2] ?? 'ms') as 'ms' | 's' };
};
const color = (value: unknown): DTCGColorValue => {
  if (isObject(value) && 'colorSpace' in value)
    return value as unknown as DTCGColorValue;

  const rgb = typeof value === 'string' ? parseColor(value) : null;

  if (!rgb)
    throw new Unsupported(
      `Colour ${JSON.stringify(value)} is not one DTCG can hold`
    );

  return rgbToDtcg(rgb);
};
const fontWeight = (value: unknown, notes: string[]): number => {
  if (typeof value === 'number') return value;

  const text = String(value).trim().toLowerCase();

  if (/^\d+$/.test(text)) return Number(text);

  const upright = text.replace(/\s*italic$/, '');

  if (upright !== text)
    notes.push('italic dropped: DTCG font weights have no style');

  const weight =
    WEIGHT_NAMES[upright] ?? WEIGHT_NAMES[upright.replace(/\s+/g, '-')];

  if (weight === undefined)
    throw new Unsupported(
      `Font weight ${JSON.stringify(value)} is not one DTCG knows`
    );

  return weight;
};
const fontFamily = (value: unknown) =>
  Array.isArray(value)
    ? value.map(String)
    : String(value).includes(',')
      ? String(value)
          .split(',')
          .map((name) => name.trim().replace(/^["']|["']$/g, ''))
      : String(value);
/** A line height as a multiplier: `150%`, a plain number in em, or px over a font size */
const lineHeight = (
  value: unknown,
  fontSize?: { value: number; unit: string }
) => {
  const text = String(value).trim();

  if (text.endsWith('%')) return round(parseFloat(text) / 100);

  const px = text.match(/^(\d*\.?\d+)(px)?$/);

  // Tokens Studio reads a bare number as px, as Figma does
  if (px && fontSize?.unit === 'px')
    return round(Number(px[1]) / fontSize.value);

  throw new Unsupported(
    `Line height ${JSON.stringify(value)} needs a font size in px to become a multiplier`
  );
};
const cubicBezier = (value: unknown) => {
  const numbers = (Array.isArray(value) ? value : String(value).split(',')).map(
    (part) => toNumber(String(part).trim(), 'Cubic bezier part')
  );

  if (numbers.length !== 4)
    throw new Unsupported(
      `Cubic bezier ${JSON.stringify(value)} needs 4 numbers`
    );

  return numbers;
};
const shadow = (value: unknown, notes: string[]) =>
  (Array.isArray(value) ? value : [value]).map((layer) => {
    if (!isObject(layer))
      throw new Unsupported(`Shadow ${JSON.stringify(layer)} is not an object`);

    if (layer.blendMode && layer.blendMode !== 'normal')
      notes.push(`blend mode "${layer.blendMode}" dropped`);

    return {
      color: color(layer.color),
      offsetX: dimension(layer.x ?? layer.offsetX ?? 0, 'Shadow x'),
      offsetY: dimension(layer.y ?? layer.offsetY ?? 0, 'Shadow y'),
      blur: dimension(layer.blur ?? 0, 'Shadow blur'),
      spread: dimension(layer.spread ?? 0, 'Shadow spread'),
      ...(layer.type === 'innerShadow' || layer.inset === true
        ? { inset: true }
        : {})
    };
  });
/**
 * Converts a resolved Tokens Studio value to its DTCG type and value.
 * Throws `Unsupported` for what DTCG can't hold; `notes` gathers what was
 * changed or filled in on the way.
 */
const convertValue = (
  type: string | undefined,
  value: unknown,
  notes: string[]
): { $type: DTCGType; $value: unknown } => {
  if (!type) throw new Unsupported('It has no type');

  if (UNSUPPORTED_TYPES.has(type))
    throw new Unsupported(`Type "${type}" has no DTCG equivalent`);

  if (DIMENSION_TYPES.has(type))
    return { $type: 'dimension', $value: dimension(value) };

  switch (type) {
    case 'color':
      return { $type: 'color', $value: color(value) };
    case 'opacity': {
      const text = String(value).trim();

      return {
        $type: 'number',
        $value: text.endsWith('%')
          ? parseFloat(text) / 100
          : toNumber(value, 'Opacity')
      };
    }
    case 'number':
      return { $type: 'number', $value: toNumber(value, 'Number') };
    case 'lineHeights': {
      const text = String(value).trim();

      if (text.endsWith('%'))
        return { $type: 'number', $value: lineHeight(text) };

      if (typeof value === 'number' || /px$/.test(text))
        return { $type: 'dimension', $value: dimension(value, 'Line height') };

      throw new Unsupported(
        `Line height ${JSON.stringify(value)} has no DTCG equivalent`
      );
    }
    case 'fontWeights':
      return { $type: 'fontWeight', $value: fontWeight(value, notes) };
    case 'fontFamilies':
      return { $type: 'fontFamily', $value: fontFamily(value) };
    case 'duration':
      return { $type: 'duration', $value: duration(value) };
    case 'cubicBezier':
      return { $type: 'cubicBezier', $value: cubicBezier(value) };
    case 'strokeStyle':
      return { $type: 'strokeStyle', $value: value };
    case 'boxShadow':
      return { $type: 'shadow', $value: shadow(value, notes) };
    case 'border': {
      if (!isObject(value)) throw new Unsupported('Border is not an object');

      const style = String(value.style ?? 'solid');

      if (!STROKE_STYLES.has(style))
        throw new Unsupported(
          `Border style "${style}" is not a DTCG stroke style`
        );

      return {
        $type: 'border',
        $value: {
          color: color(value.color),
          width: dimension(value.width, 'Border width'),
          style
        }
      };
    }
    case 'transition': {
      if (!isObject(value))
        throw new Unsupported('Transition is not an object');

      if (value.property)
        notes.push('property dropped: DTCG transitions have none');

      return {
        $type: 'transition',
        $value: {
          duration: duration(value.duration),
          delay: duration(value.delay ?? 0),
          timingFunction: cubicBezier(value.timingFunction)
        }
      };
    }
    case 'gradient': {
      if (!isObject(value) || !Array.isArray(value.stops))
        throw new Unsupported(
          'Gradient strings have no DTCG equivalent; only stops do'
        );

      if (value.angle !== undefined || value.kind !== undefined)
        notes.push('kind and angle dropped: DTCG gradients are stops only');

      return {
        $type: 'gradient',
        $value: (value.stops as Json[]).map((stop) => ({
          color: color(stop.color),
          position: toNumber(stop.position, 'Gradient position')
        }))
      };
    }
    case 'typography': {
      if (!isObject(value))
        throw new Unsupported('Typography is not an object');

      const fontSize = dimension(value.fontSize ?? 16, 'Font size');
      const dropped = [
        'paragraphSpacing',
        'paragraphIndent',
        'textCase',
        'textDecoration'
      ].filter(
        (key) =>
          value[key] !== undefined &&
          value[key] !== 'none' &&
          value[key] !== '0'
      );

      if (dropped.length)
        notes.push(`${dropped.join(', ')} dropped: DTCG typography has none`);

      if (value.fontSize === undefined)
        notes.push('font size filled in as 16px');

      if (value.letterSpacing === undefined)
        notes.push('letter spacing filled in as 0px');

      if (
        value.lineHeight === undefined ||
        /^(auto|normal)$/i.test(String(value.lineHeight))
      )
        notes.push('line height filled in as 1.2');

      return {
        $type: 'typography',
        $value: {
          fontFamily: fontFamily(value.fontFamily ?? 'sans-serif'),
          fontWeight: fontWeight(value.fontWeight ?? 400, notes),
          fontSize,
          letterSpacing: dimension(value.letterSpacing ?? 0, 'Letter spacing'),
          lineHeight:
            value.lineHeight === undefined ||
            /^(auto|normal)$/i.test(String(value.lineHeight))
              ? 1.2
              : lineHeight(value.lineHeight, fontSize)
        }
      };
    }
    default:
      throw new Unsupported(`Type "${type}" is not one this converter knows`);
  }
};
// The DTCG type each part of a composite takes, to keep a reference in it
const PART_TYPES: Record<string, Record<string, DTCGType>> = {
  typography: {
    fontFamily: 'fontFamily',
    fontWeight: 'fontWeight',
    fontSize: 'dimension',
    letterSpacing: 'dimension',
    lineHeight: 'number'
  },
  border: { color: 'color', width: 'dimension', style: 'strokeStyle' },
  transition: {
    duration: 'duration',
    delay: 'duration',
    timingFunction: 'cubicBezier'
  }
};
const setAt = (root: Json, path: string[], value: unknown) => {
  let node = root;

  path.slice(0, -1).forEach((key) => {
    if (!isObject(node[key])) node[key] = {};

    node = node[key] as Json;
  });
  node[path[path.length - 1]] = value;
};

/**
 * Converts a Tokens Studio file to a DTCG 2025.10 document, with the sets
 * used as given, and reports what it did.
 *
 * @param {TokensStudioFile} file The file, from `readTokensStudio`
 * @param {Record<string, SetUse>} uses How each set is used
 * @returns {Conversion} The document, how many tokens it has, and notes
 * @example
 * const file = readTokensStudio(json);
 * convertTokensStudio(file, setsForTheme(file, file.themes[0]));
 */
export const convertTokensStudio = (
  file: TokensStudioFile,
  uses: Record<string, SetUse>
): Conversion => {
  const notes: ConversionNote[] = [];
  const note = (name: string, kind: NoteKind, detail: string) =>
    notes.push({ name, kind, detail });
  const entries = new Map<string, Entry>();
  const remainder: Record<string, Json> = {};
  // A group's type and other properties come back from `groups`, so a
  // token kept here is written as it was
  const keep = (set: string, name: string, token: Json) =>
    setAt((remainder[set] ??= {}), name.split('.'), token);
  const groups: Record<string, Record<string, Json>> = {};
  const collectGroups = (set: string, node: Json, path: string[]) => {
    const own = Object.fromEntries(
      Object.entries(node).filter(
        ([key, value]) => key.startsWith('$') || !isObject(value)
      )
    );

    if (Object.keys(own).length) (groups[set] ??= {})[path.join('.')] = own;

    Object.entries(node).forEach(([key, child]) => {
      if (!key.startsWith('$') && isObject(child) && !isToken(child))
        collectGroups(set, child, [...path, key]);
    });
  };

  file.sets.forEach(({ name, tokens }) => collectGroups(name, tokens, []));

  // Merge the sets in order: a later set's token replaces an earlier one
  file.sets.forEach(({ name: set, tokens }) => {
    const use = uses[set] ?? 'left-out';

    walk(tokens, (name, token, type) => {
      if (use === 'left-out') return keep(set, name, token);

      const earlier = entries.get(name);

      if (earlier) {
        note(name, 'overridden', `"${earlier.set}" is overridden by "${set}"`);
        keep(earlier.set, name, earlier.token);
      }

      entries.set(name, { name, set, use, token, type });
    });
  });

  const resolved = new Map<string, unknown>();
  const failed = new Map<string, string>();
  /** A token's value with references, math and modifiers worked out */
  const resolve = (name: string, stack: string[] = []): unknown => {
    if (resolved.has(name)) return resolved.get(name);

    if (failed.has(name)) throw new Unsupported(failed.get(name));

    if (stack.includes(name))
      throw new Unsupported(
        `Circular reference: ${[...stack, name].join(' → ')}`
      );

    const entry = entries.get(name);

    if (!entry)
      throw new Unsupported(
        `It references "{${name}}", which is not in the sets used`
      );

    try {
      const deep = (value: unknown): unknown => {
        if (typeof value === 'string') {
          const whole = value.match(ALIAS);

          if (whole) return resolve(whole[1], [...stack, name]);

          let text = value;

          if (HAS_REFERENCE.test(value)) {
            text = value.replace(REFERENCE, (_match, ref: string) => {
              const target = resolve(ref, [...stack, name]);

              if (isObject(target) || Array.isArray(target))
                throw new Unsupported(
                  `"{${ref}}" is a composite value inside text`
                );

              // A colour goes in as hex, as Tokens Studio does, so that
              // rgba({colour}, 0.5) reads as rgba(#hex, 0.5)
              const rgb =
                entries.get(ref)?.type === 'color' && typeof target === 'string'
                  ? parseColor(target)
                  : null;

              if (rgb) return hexOf(rgb);

              return String(target);
            });
            note(name, 'resolved', `${value} → ${text}`);
          }

          if (isMath(text)) {
            const { value: number, unit } = evaluateMath(text);
            const result = unit ? `${number}${unit}` : number;

            note(name, 'math', `${value} → ${result}`);

            return result;
          }

          return text;
        }

        if (Array.isArray(value)) return value.map(deep);

        if (isObject(value))
          return Object.fromEntries(
            Object.entries(value).map(([key, part]) => [key, deep(part)])
          );

        return value;
      };

      let value = deep(valueOf(entry.token));

      const studio = (entry.token.$extensions as Json | undefined)?.[
        'studio.tokens'
      ];
      const modify =
        isObject(studio) && isObject(studio.modify) ? studio.modify : undefined;

      if (modify && entry.type === 'color') {
        const base = typeof value === 'string' ? parseColor(value) : null;

        if (!base)
          throw new Unsupported(
            `The colour to modify, ${JSON.stringify(value)}, cannot be read`
          );

        const amount = Number(deep(String(modify.value)));
        const space = (
          ['lch', 'hsl', 'p3', 'srgb'].includes(String(modify.space))
            ? modify.space
            : 'srgb'
        ) as ModifierSpace;

        let result: Rgba;

        switch (modify.type) {
          case 'lighten':
            result = lighten(base, space, amount);
            break;
          case 'darken':
            result = darken(base, space, amount);
            break;
          case 'alpha':
            result = withAlpha(base, amount);
            break;
          case 'mix': {
            const other = parseColor(String(deep(modify.color)));

            if (!other)
              throw new Unsupported('The colour to mix with cannot be read');

            result = mix(base, other, space, amount);
            break;
          }
          default:
            throw new Unsupported(
              `Modifier "${String(modify.type)}" is not one Tokens Studio has`
            );
        }

        value = `rgb(${result.r * 255} ${result.g * 255} ${result.b * 255} / ${result.alpha})`;
        note(name, 'modified', `${modify.type} ${amount} in ${space}`);
      }

      resolved.set(name, value);

      return value;
    } catch (error) {
      const message = (error as Error).message;

      failed.set(name, message);
      throw error instanceof Unsupported ? error : new Unsupported(message);
    }
  };
  const document: Json = {};
  const types = new Map<string, DTCGType>();

  let converted = 0;

  entries.forEach((entry) => {
    const { name, set, use, token, type } = entry;

    if (use === 'reference') return keep(set, name, token);

    const changes: string[] = [];

    try {
      const { $type, $value } = convertValue(type, resolve(name), changes);

      changes.forEach((change) =>
        note(
          name,
          change.includes('filled in') ? 'defaulted' : 'changed',
          change
        )
      );
      types.set(name, $type);

      const description = token.$description ?? token.description;
      const deprecated = token.$deprecated;
      const extensions = isObject(token.$extensions)
        ? { ...token.$extensions }
        : {};

      delete extensions['studio.tokens'];
      setAt(document, name.split('.'), {
        $type,
        $value,
        ...(typeof description === 'string' &&
          description && { $description: description }),
        ...(deprecated !== undefined && {
          $deprecated: isObject(deprecated)
            ? String(deprecated.message ?? true)
            : deprecated
        }),
        $extensions: {
          ...extensions,
          [DTF_EXTENSION_KEY]: {
            tokensStudio: {
              set,
              original: token,
              hash: hashValue($value),
              $type
            }
          }
        }
      });
      converted += 1;
    } catch (error) {
      note(name, 'left-out', (error as Error).message);
      keep(set, name, token);
    }
  });

  // References to tokens in the document stay references, so the flow shows
  // the line between them: a whole value, or a part of a composite
  const tokenAt = (name: string) =>
    name
      .split('.')
      .reduce<unknown>(
        (node, key) => (isObject(node) ? node[key] : undefined),
        document
      ) as Json | undefined;

  entries.forEach(({ name, token, type }) => {
    const out = tokenAt(name);

    if (!out || !types.has(name)) return;

    const studio = (token.$extensions as Json | undefined)?.['studio.tokens'];
    const raw = valueOf(token);
    const whole = typeof raw === 'string' ? raw.match(ALIAS) : null;

    if (
      whole &&
      !(isObject(studio) && studio.modify) &&
      types.get(whole[1]) === types.get(name)
    ) {
      out.$value = raw;
      ((out.$extensions as Json)[DTF_EXTENSION_KEY] as Json).tokensStudio = {
        ...(((out.$extensions as Json)[DTF_EXTENSION_KEY] as Json)
          .tokensStudio as Json),
        hash: hashValue(raw)
      };

      return;
    }

    const parts = PART_TYPES[type ?? ''];

    if (!parts || !isObject(raw) || !isObject(out.$value)) return;

    let changed = false;

    Object.entries(parts).forEach(([key, partType]) => {
      const part = raw[key];
      const ref = typeof part === 'string' ? part.match(ALIAS) : null;

      if (ref && types.get(ref[1]) === partType) {
        (out.$value as Json)[key] = part;
        changed = true;
      }
    });

    if (changed)
      ((out.$extensions as Json)[DTF_EXTENSION_KEY] as Json).tokensStudio = {
        ...(((out.$extensions as Json)[DTF_EXTENSION_KEY] as Json)
          .tokensStudio as Json),
        hash: hashValue(out.$value)
      };
  });

  document.$extensions = {
    [DTF_EXTENSION_KEY]: {
      tokensStudio: {
        keyStyle: file.keyStyle,
        hasSets: file.hasSets,
        order: file.sets.map(({ name }) => name),
        themes: file.themes,
        remainder,
        groups
      } satisfies TokensStudioDocument
    }
  };

  return { document: document as DTCGDocument, converted, notes };
};

/** A DTCG value as Tokens Studio writes it */
const toStudioValue = (
  $type: DTCGType,
  value: unknown
): { type: string; value: unknown } => {
  if (typeof value === 'string' && ALIAS.test(value)) {
    const type: Record<string, string> = {
      fontWeight: 'fontWeights',
      fontFamily: 'fontFamilies',
      shadow: 'boxShadow',
      strokeStyle: 'other'
    };

    return { type: type[$type] ?? $type, value };
  }

  const css = (part: unknown) => {
    if (typeof part === 'string') return part;

    if (!isObject(part) || typeof part.colorSpace !== 'string')
      return JSON.stringify(part);

    const colour = part as unknown as DTCGColorValue;
    const hex = colorToHex(colour);

    if (hex && (colour.alpha ?? 1) === 1) return hex;

    if (hex) {
      const alpha = Math.round((colour.alpha ?? 1) * 255)
        .toString(16)
        .padStart(2, '0');

      return `${hex}${alpha}`;
    }

    return colorToCss(colour);
  };
  const length = (part: unknown) =>
    isObject(part) ? `${part.value}${part.unit}` : part;

  switch ($type) {
    case 'color':
      return { type: 'color', value: css(value) };
    case 'dimension':
      return { type: 'dimension', value: length(value) };
    case 'duration':
      return { type: 'duration', value: length(value) };
    case 'fontFamily':
      return {
        type: 'fontFamilies',
        value: Array.isArray(value) ? value.join(', ') : value
      };
    case 'fontWeight':
      return { type: 'fontWeights', value };
    case 'shadow':
      return {
        type: 'boxShadow',
        value: (Array.isArray(value) ? value : [value]).map((layer: Json) =>
          isObject(layer)
            ? {
                x: length(layer.offsetX),
                y: length(layer.offsetY),
                blur: length(layer.blur),
                spread: length(layer.spread),
                color: css(layer.color),
                type: layer.inset ? 'innerShadow' : 'dropShadow'
              }
            : layer
        )
      };
    case 'border': {
      const border = value as Json;

      return {
        type: 'border',
        value: {
          color: css(border.color),
          width: length(border.width),
          style: border.style
        }
      };
    }
    case 'transition': {
      const transition = value as Json;

      return {
        type: 'transition',
        value: {
          duration: length(transition.duration),
          delay: length(transition.delay),
          timingFunction: transition.timingFunction
        }
      };
    }
    case 'typography': {
      const typography = value as Json;
      const line = typography.lineHeight;

      return {
        type: 'typography',
        value: {
          fontFamily: Array.isArray(typography.fontFamily)
            ? typography.fontFamily.join(', ')
            : typography.fontFamily,
          fontWeight: typography.fontWeight,
          fontSize: length(typography.fontSize),
          letterSpacing: length(typography.letterSpacing),
          // A bare number is px in Tokens Studio, so a multiplier becomes %
          lineHeight:
            typeof line === 'number' ? `${round(line * 100, 2)}%` : line
        }
      };
    }
    case 'gradient':
      return {
        type: 'color',
        value: `linear-gradient(90deg, ${(value as Json[])
          .map(
            (stop) =>
              `${css(stop.color)} ${round(Number(stop.position) * 100, 2)}%`
          )
          .join(', ')})`
      };
    case 'strokeStyle':
      return { type: 'other', value };
    default:
      return { type: $type, value };
  }
};

/** A flat DTCG token, as the export needs it */
export interface ExportToken {
  name: string;
  $type: DTCGType;
  $value: unknown;
  /** The value with references resolved, for what Tokens Studio can't refer to */
  value?: unknown;
  $description?: string;
  $extensions?: Record<string, unknown>;
}

/** Whether a value holds a JSON Pointer reference, which Tokens Studio lacks */
const hasPointer = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.some(hasPointer)
    : isObject(value) &&
      ('$ref' in value || Object.values(value).some(hasPointer));

/**
 * Writes tokens as a Tokens Studio file (#115). Tokens that came from
 * Tokens Studio and haven't changed go back as they were, to their set;
 * changed and new tokens are converted, into their set or `set`. The rest of
 * the original file (other sets, themes, tokens left out) comes back from
 * the document's `$extensions`.
 *
 * @param {ExportToken[]} tokens The tokens, with their type resolved
 * @param {Json} [root] The document's own `$extensions`
 * @param {string} [set] The set for new tokens: by default the last set used, or `global`
 * @returns {Json} The Tokens Studio file
 */
export const toTokensStudio = (
  tokens: ExportToken[],
  root?: Json,
  set?: string
): Json => {
  const origin = (root?.[DTF_EXTENSION_KEY] as Json | undefined)
    ?.tokensStudio as TokensStudioDocument | undefined;
  const sets: Record<string, Json> = structuredClone(origin?.remainder ?? {});
  const dtcg = origin?.keyStyle === 'dtcg';
  const usedSets = new Set<string>();

  tokens.forEach((token) => {
    const from = (token.$extensions?.[DTF_EXTENSION_KEY] as Json | undefined)
      ?.tokensStudio as TokensStudioOrigin | undefined;

    if (from) usedSets.add(from.set);
  });

  // New tokens go in the last set used, in the file's order
  const target =
    set ??
    (origin?.order.filter((name) => usedSets.has(name)).at(-1) ||
      origin?.order.at(-1) ||
      'global');

  tokens.forEach((token) => {
    const from = (token.$extensions?.[DTF_EXTENSION_KEY] as Json | undefined)
      ?.tokensStudio as TokensStudioOrigin | undefined;
    const path = token.name.split('.');

    if (
      from &&
      from.hash === hashValue(token.$value) &&
      from.$type === token.$type
    ) {
      setAt((sets[from.set] ??= {}), path, from.original);

      return;
    }

    // Tokens Studio has no $ref: such a value goes as it resolves
    const { type, value } = toStudioValue(
      token.$type,
      hasPointer(token.$value) && token.value !== undefined
        ? token.value
        : token.$value
    );
    const extensions = { ...(token.$extensions ?? {}) };

    delete extensions[DTF_EXTENSION_KEY];
    setAt((sets[from?.set ?? target] ??= {}), path, {
      [dtcg ? '$value' : 'value']: value,
      [dtcg ? '$type' : 'type']: type,
      ...(token.$description && {
        [dtcg ? '$description' : 'description']: token.$description
      }),
      ...(Object.keys(extensions).length && { $extensions: extensions })
    });
  });

  // Each group's own properties, such as a type its tokens inherit
  Object.entries(origin?.groups ?? {}).forEach(([name, paths]) =>
    Object.entries(paths).forEach(([path, own]) => {
      const node = path
        ? path
            .split('.')
            .reduce<unknown>(
              (group, key) => (isObject(group) ? group[key] : undefined),
              sets[name]
            )
        : (sets[name] ??= {});

      if (isObject(node)) Object.assign(node, own);
    })
  );

  const order = [
    ...(origin?.order ?? []).filter((name) => name in sets),
    ...Object.keys(sets).filter((name) => !origin?.order.includes(name))
  ];

  return {
    ...Object.fromEntries(order.map((name) => [name, sets[name]])),
    $themes: origin?.themes ?? [],
    $metadata: { tokenSetOrder: order }
  };
};
