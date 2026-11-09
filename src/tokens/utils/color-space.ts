import type { DTCGColorValue } from '../types/tokens';

/**
 * Colour maths for converting Tokens Studio tokens (#113): parsing the CSS
 * colour strings Tokens Studio writes, converting between sRGB, HSL, Display
 * P3 and CIE LCH, and its colour modifiers. The matrices are the ones in CSS
 * Color 4, which colorjs.io (used by Tokens Studio's sd-transforms) uses too,
 * so the results match.
 */

/** sRGB channels, 0 to 1, and alpha */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

/** The spaces Tokens Studio's colour modifiers work in */
export type ModifierSpace = 'srgb' | 'hsl' | 'p3' | 'lch';

type Vector = [number, number, number];
type Matrix = [Vector, Vector, Vector];

const multiply = (m: Matrix, [x, y, z]: Vector): Vector => [
  m[0][0] * x + m[0][1] * y + m[0][2] * z,
  m[1][0] * x + m[1][1] * y + m[1][2] * z,
  m[2][0] * x + m[2][1] * y + m[2][2] * z
];
// CSS Color 4, section 18 (sample code for color conversions)
const LINEAR_SRGB_TO_XYZ: Matrix = [
  [0.41239079926595934, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559182, 0.11919477979462598, 0.9505321522496607]
];
const XYZ_TO_LINEAR_SRGB: Matrix = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786]
];
const LINEAR_P3_TO_XYZ: Matrix = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976]
];
const XYZ_TO_LINEAR_P3: Matrix = [
  [2.493496911941425, -0.9313836179191239, -0.40271078445071684],
  [-0.8294889695615747, 1.7626640603183463, 0.023624685841943577],
  [0.03584583024378447, -0.07617238926804182, 0.9568845240076872]
];
// Bradford chromatic adaptation between the D65 and D50 white points
const D65_TO_D50: Matrix = [
  [1.0479298208405488, 0.022946793341019088, -0.05019222954313557],
  [0.029627815688159344, 0.990434484573249, -0.01707382502938514],
  [-0.009243058152591178, 0.015055144896577895, 0.7518742899580008]
];
const D50_TO_D65: Matrix = [
  [0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
  [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
  [0.012314001688319899, -0.020507696433477912, 1.3303659366080753]
];
const D50_WHITE: Vector = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;
// The sRGB transfer function, which Display P3 shares
const toLinear = (channel: number) => {
  const abs = Math.abs(channel);

  return abs <= 0.04045
    ? channel / 12.92
    : Math.sign(channel) * ((abs + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (channel: number) => {
  const abs = Math.abs(channel);

  return abs > 0.0031308
    ? Math.sign(channel) * (1.055 * abs ** (1 / 2.4) - 0.055)
    : 12.92 * channel;
};
const rgbToXyz = ({ r, g, b }: Rgba) =>
  multiply(LINEAR_SRGB_TO_XYZ, [toLinear(r), toLinear(g), toLinear(b)]);
const xyzToRgb = (xyz: Vector, alpha: number): Rgba => {
  const [r, g, b] = multiply(XYZ_TO_LINEAR_SRGB, xyz).map(fromLinear);

  return { r, g, b, alpha };
};

/** sRGB to Display P3 channels, 0 to 1 */
export const rgbToP3 = (rgb: Rgba): Vector =>
  multiply(XYZ_TO_LINEAR_P3, rgbToXyz(rgb)).map(fromLinear) as Vector;

/** Display P3 channels to sRGB, which may be out of the sRGB gamut */
export const p3ToRgb = (p3: Vector, alpha = 1): Rgba =>
  xyzToRgb(multiply(LINEAR_P3_TO_XYZ, p3.map(toLinear) as Vector), alpha);

/** sRGB to CIE LCH, D50: lightness 0 to 100, chroma, hue in degrees */
export const rgbToLch = (rgb: Rgba): Vector => {
  const xyz = multiply(D65_TO_D50, rgbToXyz(rgb));
  const [fx, fy, fz] = xyz.map((value, index) => {
    const scaled = value / D50_WHITE[index];

    return scaled > EPSILON ? Math.cbrt(scaled) : (KAPPA * scaled + 16) / 116;
  });
  const l = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);
  const c = Math.sqrt(a * a + b * b);
  // Hue is undefined for greys: colorjs.io reports NaN below a chroma of
  // 0.02, here it is 0
  const h = c < 0.02 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;

  return [l, c, h];
};

/** CIE LCH, D50, to sRGB, which may be out of the sRGB gamut */
export const lchToRgb = ([l, c, h]: Vector, alpha = 1): Rgba => {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const xyz = [
    fx ** 3 > EPSILON ? fx ** 3 : (116 * fx - 16) / KAPPA,
    l > KAPPA * EPSILON ? fy ** 3 : l / KAPPA,
    fz ** 3 > EPSILON ? fz ** 3 : (116 * fz - 16) / KAPPA
  ].map((value, index) => value * D50_WHITE[index]) as Vector;

  return xyzToRgb(multiply(D50_TO_D65, xyz), alpha);
};

/** sRGB to HSL: hue in degrees, saturation and lightness 0 to 100 */
export const rgbToHsl = ({ r, g, b }: Rgba): Vector => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return [0, 0, l * 100];

  const s = l === 0 || l === 1 ? 0 : (max - l) / Math.min(l, 1 - l);
  const h =
    max === r
      ? (g - b) / d + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;

  return [h * 60, s * 100, l * 100];
};

/** HSL to sRGB */
export const hslToRgb = ([h, s, l]: Vector, alpha = 1): Rgba => {
  const sat = s / 100;
  const light = l / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;

    return (
      light -
      sat * Math.min(light, 1 - light) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    );
  };

  return { r: f(0), g: f(8), b: f(4), alpha };
};

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));
const byte = (channel: number) =>
  Math.round(clamp(channel) * 255)
    .toString(16)
    .padStart(2, '0');

/** The 6 digit hex of an sRGB colour, clipped to the gamut */
export const rgbToHex = ({ r, g, b }: Rgba): string =>
  `#${byte(r)}${byte(g)}${byte(b)}`;

const number = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
const HEX = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;
const FUNCTION = new RegExp(
  String.raw`^(rgba?|hsla?)\(\s*(${number}(?:deg|%)?)\s*[,\s]\s*(${number}%?)\s*[,\s]\s*(${number}%?)\s*(?:[,/]\s*(${number}%?)\s*)?\)$`,
  'i'
);
// Tokens Studio writes rgba(#hex, alpha), after resolving rgba({ref}, alpha)
const HEX_ALPHA = new RegExp(
  String.raw`^rgba?\(\s*(#[\da-f]{3,8})\s*,\s*(${number}%?)\s*\)$`,
  'i'
);
const fraction = (value: string, scale: number) =>
  value.endsWith('%') ? parseFloat(value) / 100 : parseFloat(value) / scale;

/**
 * Parses the colour strings Tokens Studio writes: hex with 3, 4, 6 or 8
 * digits, `rgb()`, `rgba()`, `hsl()` and `hsla()`, with commas or spaces,
 * and `rgba(#hex, alpha)`.
 *
 * @param {string} value The colour
 * @returns {Rgba | null} sRGB, or null when it isn't one of those
 * @example
 * parseColor('rgba(255, 0, 0, 0.5)'); // => { r: 1, g: 0, b: 0, alpha: 0.5 }
 */
export const parseColor = (value: string): Rgba | null => {
  const text = value.trim();
  const hex = text.match(HEX);

  if (hex) {
    const digits =
      hex[1].length <= 4
        ? [...hex[1]].map((digit) => digit + digit).join('')
        : hex[1];
    const channel = (index: number) =>
      parseInt(digits.slice(index * 2, index * 2 + 2), 16) / 255;

    return {
      r: channel(0),
      g: channel(1),
      b: channel(2),
      alpha: digits.length === 8 ? channel(3) : 1
    };
  }

  const hexAlpha = text.match(HEX_ALPHA);

  if (hexAlpha) {
    const base = parseColor(hexAlpha[1]);

    return base && { ...base, alpha: clamp(fraction(hexAlpha[2], 1)) };
  }

  const fn = text.match(FUNCTION);

  if (!fn) return null;

  const [, name, first, second, third, alphaText] = fn;
  const alpha = alphaText === undefined ? 1 : clamp(fraction(alphaText, 1));

  if (name.toLowerCase().startsWith('rgb'))
    return {
      r: fraction(first, 255),
      g: fraction(second, 255),
      b: fraction(third, 255),
      alpha
    };

  return hslToRgb(
    [parseFloat(first), parseFloat(second), parseFloat(third)],
    alpha
  );
};

/**
 * A DTCG colour value for sRGB: components rounded to 4 decimals, the hex
 * fallback, and alpha when it isn't 1. Out of gamut channels are clipped.
 *
 * @param {Rgba} rgb The colour
 * @returns {DTCGColorValue} The DTCG colour
 */
export const rgbToDtcg = (rgb: Rgba): DTCGColorValue => {
  const round = (value: number) => Math.round(clamp(value) * 10000) / 10000;

  return {
    colorSpace: 'srgb',
    components: [round(rgb.r), round(rgb.g), round(rgb.b)],
    ...(rgb.alpha < 1 && { alpha: round(rgb.alpha) }),
    hex: rgbToHex(rgb)
  };
};

/**
 * Tokens Studio's lighten: each channel, or the lightness, moves toward
 * white by `amount`, 0 to 1; in LCH the chroma also falls by `amount`.
 * As in sd-transforms' color-modifiers/lighten.ts.
 */
export const lighten = (
  rgb: Rgba,
  space: ModifierSpace,
  amount: number
): Rgba => {
  switch (space) {
    case 'lch': {
      const [l, c, h] = rgbToLch(rgb);

      return lchToRgb(
        [Math.min(100, l + (100 - l) * amount), Math.max(0, c - amount * c), h],
        rgb.alpha
      );
    }
    case 'hsl': {
      const [h, s, l] = rgbToHsl(rgb);

      return hslToRgb([h, s, Math.min(100, l + (100 - l) * amount)], rgb.alpha);
    }
    case 'p3':
      return p3ToRgb(
        rgbToP3(rgb).map((channel) =>
          Math.min(1, channel + amount * (1 - channel))
        ) as Vector,
        rgb.alpha
      );
    default:
      return {
        r: Math.min(1, rgb.r + amount * (1 - rgb.r)),
        g: Math.min(1, rgb.g + amount * (1 - rgb.g)),
        b: Math.min(1, rgb.b + amount * (1 - rgb.b)),
        alpha: rgb.alpha
      };
  }
};

/**
 * Tokens Studio's darken: each channel, or the lightness, moves toward black
 * by `amount`, 0 to 1; in LCH the chroma also falls by `amount`.
 * As in sd-transforms' color-modifiers/darken.ts.
 */
export const darken = (
  rgb: Rgba,
  space: ModifierSpace,
  amount: number
): Rgba => {
  switch (space) {
    case 'lch': {
      const [l, c, h] = rgbToLch(rgb);

      return lchToRgb(
        [Math.max(0, l - l * amount), Math.max(0, c - amount * c), h],
        rgb.alpha
      );
    }
    case 'hsl': {
      const [h, s, l] = rgbToHsl(rgb);

      return hslToRgb([h, s, Math.max(0, l - l * amount)], rgb.alpha);
    }
    case 'p3':
      return p3ToRgb(
        rgbToP3(rgb).map((channel) =>
          Math.max(0, channel - amount * channel)
        ) as Vector,
        rgb.alpha
      );
    default:
      return {
        r: Math.max(0, rgb.r - amount * rgb.r),
        g: Math.max(0, rgb.g - amount * rgb.g),
        b: Math.max(0, rgb.b - amount * rgb.b),
        alpha: rgb.alpha
      };
  }
};

/** Tokens Studio's alpha: sets the opacity, 0 to 1 */
export const withAlpha = (rgb: Rgba, amount: number): Rgba => ({
  ...rgb,
  alpha: clamp(amount)
});

const coordinates = (rgb: Rgba, space: ModifierSpace): Vector => {
  switch (space) {
    case 'lch':
      return rgbToLch(rgb);
    case 'hsl':
      return rgbToHsl(rgb);
    case 'p3':
      return rgbToP3(rgb);
    default:
      return [rgb.r, rgb.g, rgb.b];
  }
};
const fromCoordinates = (
  values: Vector,
  space: ModifierSpace,
  alpha: number
): Rgba => {
  switch (space) {
    case 'lch':
      return lchToRgb(values, alpha);
    case 'hsl':
      return hslToRgb(values, alpha);
    case 'p3':
      return p3ToRgb(values, alpha);
    default:
      return { r: values[0], g: values[1], b: values[2], alpha };
  }
};

/**
 * Tokens Studio's mix: `amount` of the way from `rgb` to `other`, 0 to 1,
 * interpolated in `space` as colorjs.io 0.5 does: the shorter way round the
 * hue in HSL and LCH, and alpha mixed on its own, not premultiplied.
 */
export const mix = (
  rgb: Rgba,
  other: Rgba,
  space: ModifierSpace,
  amount: number
): Rgba => {
  const t = clamp(amount);
  const hueIndex = space === 'hsl' ? 0 : space === 'lch' ? 2 : -1;
  const from = coordinates(rgb, space);
  const to = coordinates(other, space);

  if (hueIndex !== -1) {
    const difference = to[hueIndex] - from[hueIndex];

    if (difference > 180) from[hueIndex] += 360;
    else if (difference < -180) to[hueIndex] += 360;
  }

  const alpha = rgb.alpha + (other.alpha - rgb.alpha) * t;
  const mixed = from.map((value, index) => {
    const result = value + (to[index] - value) * t;

    return index === hueIndex ? ((result % 360) + 360) % 360 : result;
  }) as Vector;

  return fromCoordinates(mixed, space, alpha);
};
