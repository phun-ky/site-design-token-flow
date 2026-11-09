import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  darken,
  hslToRgb,
  lchToRgb,
  lighten,
  mix,
  p3ToRgb,
  parseColor,
  rgbToDtcg,
  rgbToHex,
  rgbToHsl,
  rgbToLch,
  rgbToP3,
  withAlpha,
  type ModifierSpace,
  type Rgba
} from '../color-space';

// Computed with colorjs.io 0.5.2, the library Tokens Studio's sd-transforms
// uses, with sd-transforms' own lighten and darken: sRGB channels and alpha
const REFERENCE: Record<string, Record<string, number[]>> = {
  '#3366cc': {
    lch: [44.121, 60.0926, 280.5032],
    p3: [0.249851, 0.39524, 0.773562],
    hsl: [220, 60, 50],
    'lighten-lch': [0.407891, 0.510086, 0.842805, 1],
    'darken-lch': [0.180394, 0.318276, 0.625591, 1],
    'mix-lch': [0.949287, 0.322367, 0.697638, 1],
    'lighten-hsl': [0.36, 0.52, 0.84, 1],
    'darken-hsl': [0.16, 0.32, 0.64, 1],
    'mix-hsl': [0.12, 0.88, 0.5152, 1],
    'lighten-p3': [0.367259, 0.520384, 0.842374, 1],
    'darken-p3': [0.16077, 0.32003, 0.640156, 1],
    'mix-p3': [0.531944, 0.561167, 0.57525, 1],
    'lighten-srgb': [0.36, 0.52, 0.84, 1],
    'darken-srgb': [0.16, 0.32, 0.64, 1],
    'mix-srgb': [0.52, 0.56, 0.48, 1]
  },
  '#c14242': {
    lch: [47.1066, 59.3501, 29.7038],
    p3: [0.700199, 0.294145, 0.277657],
    hsl: [0, 50.5976, 50.7843],
    'lighten-lch': [0.824721, 0.418304, 0.392606, 1],
    'darken-lch': [0.595251, 0.215252, 0.209794, 1],
    'mix-lch': [0.910305, 0.453024, 0.206294, 1],
    'lighten-hsl': [0.80549, 0.407059, 0.407059, 1],
    'darken-hsl': [0.61184, 0.200709, 0.200709, 1],
    'mix-hsl': [0.853188, 0.379252, 0.156224, 1],
    'lighten-p3': [0.811704, 0.414171, 0.410662, 1],
    'darken-p3': [0.605901, 0.207751, 0.207407, 1],
    'mix-p3': [0.858212, 0.480799, 0.218273, 1],
    'lighten-srgb': [0.80549, 0.407059, 0.407059, 1],
    'darken-srgb': [0.60549, 0.207059, 0.207059, 1],
    'mix-srgb': [0.854118, 0.475294, 0.155294, 1]
  }
};
// Red at half opacity mixed with blue, halfway
const MIX_ALPHA = [0.5, 0, 0.5, 0.75];
const SPACES: ModifierSpace[] = ['lch', 'hsl', 'p3', 'srgb'];
const close = (actual: number[], expected: number[], tolerance = 1e-4) =>
  assert.ok(
    actual.every(
      (value, index) => Math.abs(value - expected[index]) < tolerance
    ),
    `${JSON.stringify(actual)} is not close to ${JSON.stringify(expected)}`
  );
const channels = ({ r, g, b, alpha }: Rgba) => [r, g, b, alpha];
const parse = (value: string) => parseColor(value) as Rgba;

describe('parseColor', () => {
  it('reads every colour string Tokens Studio writes', () => {
    close(channels(parse('#36c')), [0.2, 0.4, 0.8, 1]);
    close(channels(parse('#3366cc80')), [0.2, 0.4, 0.8, 128 / 255]);
    close(channels(parse('#36c8')), [0.2, 0.4, 0.8, 136 / 255]);
    close(channels(parse('rgb(51, 102, 204)')), [0.2, 0.4, 0.8, 1]);
    close(channels(parse('rgba(51, 102, 204, 0.5)')), [0.2, 0.4, 0.8, 0.5]);
    close(channels(parse('rgb(51 102 204 / 50%)')), [0.2, 0.4, 0.8, 0.5]);
    close(channels(parse('rgba(#3366cc, 0.25)')), [0.2, 0.4, 0.8, 0.25]);
    close(channels(parse('hsl(220, 60%, 50%)')), [0.2, 0.4, 0.8, 1]);
    close(channels(parse('hsla(220deg 60% 50% / 0.5)')), [0.2, 0.4, 0.8, 0.5]);
  });

  it('returns null for anything else', () => {
    assert.equal(parseColor('red'), null);
    assert.equal(parseColor('linear-gradient(red, blue)'), null);
    assert.equal(parseColor('#12345'), null);
  });
});

describe('conversions', () => {
  for (const hex of ['#3366cc', '#c14242']) {
    const rgb = parse(hex);

    it(`converts ${hex} to LCH, Display P3 and HSL as colorjs.io does`, () => {
      close(rgbToLch(rgb), REFERENCE[hex].lch, 1e-3);
      close(rgbToP3(rgb), REFERENCE[hex].p3);
      close(rgbToHsl(rgb), REFERENCE[hex].hsl, 1e-3);
    });

    it(`converts ${hex} back again`, () => {
      close(channels(lchToRgb(rgbToLch(rgb))), channels(rgb));
      close(channels(p3ToRgb(rgbToP3(rgb))), channels(rgb));
      close(channels(hslToRgb(rgbToHsl(rgb))), channels(rgb));
    });
  }

  it('gives greys no hue', () => {
    assert.equal(rgbToLch(parse('#808080'))[2], 0);
    assert.deepEqual(rgbToHsl(parse('#808080')), [0, 0, 50.19607843137255]);
  });
});

describe('modifiers', () => {
  for (const hex of ['#3366cc', '#c14242']) {
    for (const space of SPACES) {
      it(`lightens, darkens and mixes ${hex} in ${space} as Tokens Studio does`, () => {
        close(
          channels(lighten(parse(hex), space, 0.2)),
          REFERENCE[hex][`lighten-${space}`]
        );
        close(
          channels(darken(parse(hex), space, 0.2)),
          REFERENCE[hex][`darken-${space}`]
        );
        close(
          channels(mix(parse(hex), parse('#ffcc00'), space, 0.4)),
          REFERENCE[hex][`mix-${space}`]
        );
      });
    }
  }

  it('mixes alpha on its own, not premultiplied', () => {
    close(
      channels(mix(parse('rgb(255 0 0 / 0.5)'), parse('#0000ff'), 'srgb', 0.5)),
      MIX_ALPHA
    );
  });

  it('sets alpha, within 0 and 1', () => {
    assert.equal(withAlpha(parse('#3366cc'), 0.3).alpha, 0.3);
    assert.equal(withAlpha(parse('#3366cc'), 2).alpha, 1);
  });
});

describe('rgbToDtcg', () => {
  it('writes a DTCG colour with its hex, and alpha only when it is not 1', () => {
    assert.deepEqual(rgbToDtcg(parse('#3366cc')), {
      colorSpace: 'srgb',
      components: [0.2, 0.4, 0.8],
      hex: '#3366cc'
    });
    assert.deepEqual(rgbToDtcg(parse('rgba(51, 102, 204, 0.5)')), {
      colorSpace: 'srgb',
      components: [0.2, 0.4, 0.8],
      alpha: 0.5,
      hex: '#3366cc'
    });
  });

  it('clips colours out of the sRGB gamut', () => {
    assert.equal(rgbToHex({ r: 1.2, g: -0.1, b: 0.5, alpha: 1 }), '#ff0080');
  });
});
