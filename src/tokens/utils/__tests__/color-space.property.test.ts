import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import {
  darken,
  hslToRgb,
  lchToRgb,
  lighten,
  mix,
  type ModifierSpace,
  p3ToRgb,
  parseColor,
  type Rgba,
  rgbToHex,
  rgbToHsl,
  rgbToLch,
  rgbToP3
} from '../color-space';

const unit = fc.double({ min: 0, max: 1, noNaN: true });
const rgba = fc.record({ r: unit, g: unit, b: unit, alpha: unit });
const space = fc.constantFrom<ModifierSpace>('srgb', 'hsl', 'p3', 'lch');
const TOLERANCE = 1e-9;
// Greys below a chroma of 0.02 lose their hue in LCH by design, and the
// Bradford matrices from CSS Color 4 are each other's inverse only to ~1e-7
const LCH_TOLERANCE = 1e-3;
const tolerance = (inSpace: ModifierSpace) =>
  inSpace === 'lch' ? LCH_TOLERANCE : TOLERANCE;
const close = (actual: Rgba, expected: Rgba, within: number) => {
  for (const key of ['r', 'g', 'b', 'alpha'] as const)
    assert.ok(
      Math.abs(actual[key] - expected[key]) < within,
      `${key}: got ${actual[key]}, expected ${expected[key]}`
    );
};
const lightness = (rgb: Rgba) => rgbToLch(rgb)[0];

describe('color-space properties', () => {
  it('reads back any 6 digit hex it writes', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^#[\da-fA-F]{6}$/), (hex) => {
        const rgb = parseColor(hex);

        assert.ok(rgb, `could not parse ${hex}`);
        assert.equal(rgbToHex(rgb), hex.toLowerCase());
      })
    );
  });

  it('gets an sRGB colour back from HSL, Display P3 and LCH', () => {
    fc.assert(
      fc.property(rgba, (rgb) => {
        close(hslToRgb(rgbToHsl(rgb), rgb.alpha), rgb, TOLERANCE);
        close(p3ToRgb(rgbToP3(rgb), rgb.alpha), rgb, TOLERANCE);
        close(lchToRgb(rgbToLch(rgb), rgb.alpha), rgb, LCH_TOLERANCE);
      })
    );
  });

  it('mixes to the first colour at 0 and the other at 1, in any space', () => {
    fc.assert(
      fc.property(rgba, rgba, space, (rgb, other, inSpace) => {
        close(mix(rgb, other, inSpace, 0), rgb, tolerance(inSpace));
        close(mix(rgb, other, inSpace, 1), other, tolerance(inSpace));
      })
    );
  });

  it('never darkens with lighten, nor lightens with darken, in any space', () => {
    fc.assert(
      fc.property(rgba, space, unit, (rgb, inSpace, amount) => {
        const before = lightness(rgb);
        const lighter = lightness(lighten(rgb, inSpace, amount));
        const darker = lightness(darken(rgb, inSpace, amount));

        assert.ok(lighter >= before - tolerance(inSpace), `got ${lighter}`);
        assert.ok(darker <= before + tolerance(inSpace), `got ${darker}`);
      })
    );
  });
});
