import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DTCGDocument } from '../../types/tokens';
import { DTF_EXTENSION_KEY, validateTokens } from '../design-tokens';
import {
  convertTokensStudio,
  hashValue,
  isTokensStudio,
  readTokensStudio,
  setsForTheme,
  toTokensStudio,
  type ExportToken
} from '../tokens-studio';

// Modelled on the plugin's storage schemas and sd-transforms' README:
// three sets, two themes in one group, and a value of every shape
const FILE = {
  core: {
    color: {
      type: 'color',
      red: { value: '#C14242' },
      blue: { value: 'rgb(51, 102, 204)', description: 'Brand blue' },
      grey: { value: 'hsl(0, 0%, 50%)' }
    },
    space: {
      base: { value: '8', type: 'spacing' },
      large: { value: '{space.base} * 2', type: 'spacing' },
      rem: { value: '1.5rem', type: 'sizing' }
    },
    font: {
      family: {
        value: 'Inter, "Helvetica Neue", sans-serif',
        type: 'fontFamilies'
      },
      bold: { value: 'Bold', type: 'fontWeights' },
      boldItalic: { value: 'Bold Italic', type: 'fontWeights' },
      size: { value: '16', type: 'fontSizes' },
      tall: { value: '150%', type: 'lineHeights' }
    },
    opacity: { half: { value: '50%', type: 'opacity' } },
    motion: {
      fast: { value: '120ms', type: 'duration' },
      ease: { value: '0.4, 0, 0.2, 1', type: 'cubicBezier' }
    }
  },
  light: {
    bg: {
      value: '{color.red}',
      type: 'color',
      $extensions: {
        'studio.tokens': {
          modify: { type: 'lighten', value: '0.2', space: 'srgb' }
        }
      }
    },
    overlay: { value: 'rgba({color.blue}, 0.5)', type: 'color' },
    accent: { value: '{color.blue}', type: 'color' },
    gap: { value: '{space.base} * 2', type: 'spacing' },
    body: {
      value: {
        fontFamily: '{font.family}',
        fontWeight: '{font.bold}',
        fontSize: '16px',
        lineHeight: '24',
        paragraphSpacing: '8'
      },
      type: 'typography'
    },
    raised: {
      value: [
        {
          x: 0,
          y: 2,
          blur: 4,
          spread: 0,
          color: 'rgba(0, 0, 0, 0.2)',
          type: 'dropShadow'
        },
        {
          x: '0',
          y: '1',
          blur: '2',
          spread: '0',
          color: '#00000033',
          type: 'innerShadow'
        }
      ],
      type: 'boxShadow'
    },
    outline: {
      value: { color: '{accent}', width: '1px', style: 'dashed' },
      type: 'border'
    },
    swap: {
      value: { duration: '{motion.fast}', timingFunction: [0.4, 0, 0.2, 1] },
      type: 'transition'
    },
    stack: { value: { padding: '{space.base}' }, type: 'composition' },
    fade: {
      value: 'linear-gradient(90deg, #fff 0%, #000 100%)',
      type: 'color'
    },
    color: { red: { value: '#d63a3a', type: 'color' } }
  },
  dark: {
    bg: { value: '{color.red}', type: 'color' }
  },
  $themes: [
    {
      id: 't-light',
      name: 'light',
      group: 'mode',
      selectedTokenSets: { core: 'source', light: 'enabled', dark: 'disabled' }
    },
    {
      id: 't-dark',
      name: 'dark',
      group: 'mode',
      selectedTokenSets: { core: 'source', dark: 'enabled', light: 'disabled' }
    }
  ],
  $metadata: { tokenSetOrder: ['core', 'light', 'dark'] }
};
const file = readTokensStudio(FILE);
const light = convertTokensStudio(file, setsForTheme(file, file.themes[0]));
const doc = light.document as Record<string, any>;
const ext = (token: Record<string, any>) =>
  token.$extensions[DTF_EXTENSION_KEY].tokensStudio;

describe('isTokensStudio', () => {
  it('tells Tokens Studio files from DTCG files', () => {
    assert.equal(isTokensStudio(FILE), true);
    assert.equal(isTokensStudio({ a: { value: '#fff', type: 'color' } }), true);
    assert.equal(isTokensStudio({ $metadata: {} }), true);
    // The "W3C DTCG" setting: $-keys, Tokens Studio's values and types
    assert.equal(
      isTokensStudio({ a: { $value: '#fff', $type: 'color' } }),
      true
    );
    assert.equal(
      isTokensStudio({ a: { $value: '8px', $type: 'spacing' } }),
      true
    );
    assert.equal(
      isTokensStudio({
        a: {
          $type: 'color',
          $value: { colorSpace: 'srgb', components: [1, 1, 1] }
        }
      }),
      false
    );
    assert.equal(
      isTokensStudio({ a: { $value: '{b}', $type: 'color' } }),
      false
    );
    assert.equal(isTokensStudio([]), false);
  });
});

describe('readTokensStudio', () => {
  it('reads the sets in tokenSetOrder, the themes and the key style', () => {
    assert.deepEqual(
      file.sets.map(({ name, count }) => [name, count]),
      [
        ['core', 14],
        ['light', 11],
        ['dark', 1]
      ]
    );
    assert.equal(file.themes.length, 2);
    assert.equal(file.keyStyle, 'legacy');
    assert.equal(file.hasSets, true);
  });

  it('reads a file without $themes or $metadata as one set', () => {
    const one = readTokensStudio({
      color: { red: { $value: '#f00', $type: 'color' } }
    });

    assert.deepEqual(
      one.sets.map(({ name, count }) => [name, count]),
      [['global', 1]]
    );
    assert.equal(one.keyStyle, 'dtcg');
    assert.equal(one.hasSets, false);
  });

  it('puts sets missing from tokenSetOrder after the listed ones', () => {
    const order = readTokensStudio({
      b: {},
      a: {},
      $metadata: { tokenSetOrder: ['a', 'missing'] }
    }).sets.map(({ name }) => name);

    assert.deepEqual(order, ['a', 'b']);
  });
});

describe('setsForTheme', () => {
  it('includes enabled and source sets, and leaves out disabled ones', () => {
    assert.deepEqual(setsForTheme(file, file.themes[1]), {
      core: 'included',
      light: 'left-out',
      dark: 'included'
    });
    assert.deepEqual(setsForTheme(file), {
      core: 'included',
      light: 'included',
      dark: 'included'
    });
  });
});

describe('convertTokensStudio', () => {
  it('gives a DTCG document without problems', () => {
    const { tokens, problems } = validateTokens(light.document);

    assert.deepEqual(problems, []);
    assert.equal(tokens.length, light.converted);
  });

  it('converts colours, with a group type, hex, rgb and hsl', () => {
    assert.deepEqual(doc.color.blue.$value, {
      colorSpace: 'srgb',
      components: [0.2, 0.4, 0.8],
      hex: '#3366cc'
    });
    assert.equal(doc.color.blue.$description, 'Brand blue');
    assert.equal(doc.color.grey.$value.hex, '#808080');
  });

  it('lets a later set override an earlier one, and reports it', () => {
    assert.equal(doc.color.red.$value.hex, '#d63a3a');
    assert.equal(ext(doc.color.red).set, 'light');
    assert.ok(
      light.notes.some(
        ({ name, kind }) => name === 'color.red' && kind === 'overridden'
      )
    );
  });

  it('works out math, keeping the unit', () => {
    assert.deepEqual(doc.space.base.$value, { value: 8, unit: 'px' });
    assert.deepEqual(doc.space.large.$value, { value: 16, unit: 'px' });
    assert.deepEqual(doc.space.rem.$value, { value: 1.5, unit: 'rem' });
    assert.ok(
      light.notes.some(({ name, kind }) => name === 'gap' && kind === 'math')
    );
  });

  it('applies colour modifiers, after resolving the colour', () => {
    // #d63a3a lightened by 0.2 in sRGB
    assert.equal(doc.bg.$value.hex, '#de6161');
    assert.ok(
      light.notes.some(({ name, kind }) => name === 'bg' && kind === 'modified')
    );
  });

  it('resolves references inside text', () => {
    assert.deepEqual(doc.overlay.$value, {
      colorSpace: 'srgb',
      components: [0.2, 0.4, 0.8],
      alpha: 0.5,
      hex: '#3366cc'
    });
  });

  it('keeps references to tokens in the document, whole and inside composites', () => {
    assert.equal(doc.accent.$value, '{color.blue}');
    assert.equal(doc.body.$value.fontFamily, '{font.family}');
    assert.equal(doc.body.$value.fontWeight, '{font.bold}');
    assert.equal(doc.outline.$value.color, '{accent}');
    assert.equal(doc.swap.$value.duration, '{motion.fast}');
  });

  it('converts the other types', () => {
    assert.deepEqual(doc.font.family.$value, [
      'Inter',
      'Helvetica Neue',
      'sans-serif'
    ]);
    assert.equal(doc.font.bold.$value, 700);
    assert.equal(doc.font.boldItalic.$value, 700);
    assert.equal(doc.font.tall.$value, 1.5);
    assert.equal(doc.font.tall.$type, 'number');
    assert.equal(doc.opacity.half.$value, 0.5);
    assert.deepEqual(doc.motion.fast.$value, { value: 120, unit: 'ms' });
    assert.deepEqual(doc.motion.ease.$value, [0.4, 0, 0.2, 1]);
    assert.equal(doc.raised.$value[1].inset, true);
    assert.deepEqual(doc.raised.$value[1].offsetY, { value: 1, unit: 'px' });
    assert.equal(doc.outline.$value.style, 'dashed');
    assert.deepEqual(doc.swap.$value.delay, { value: 0, unit: 'ms' });
    // A bare line height is px in Tokens Studio: 24px over 16px
    assert.equal(doc.body.$value.lineHeight, 1.5);
  });

  it('reports what changed, was filled in or left out', () => {
    const kinds = (name: string) =>
      light.notes.filter((note) => note.name === name).map(({ kind }) => kind);

    assert.deepEqual(kinds('font.boldItalic'), ['changed']);
    assert.ok(kinds('body').includes('changed'));
    assert.ok(kinds('body').includes('defaulted'));
    assert.deepEqual(kinds('stack'), ['left-out']);
    assert.deepEqual(kinds('fade'), ['left-out']);
    assert.equal(doc.stack, undefined);
  });

  it("keeps each token's original, and the rest of the file, for the export", () => {
    assert.deepEqual(ext(doc.gap).original, FILE.light.gap);
    assert.equal(ext(doc.gap).hash, hashValue(doc.gap.$value));

    const rest = doc.$extensions[DTF_EXTENSION_KEY].tokensStudio;

    assert.deepEqual(rest.order, ['core', 'light', 'dark']);
    assert.equal(rest.themes.length, 2);
    assert.deepEqual(rest.remainder.dark, FILE.dark);
    assert.deepEqual(rest.remainder.light.stack, FILE.light.stack);
    // The overridden core red, as it was, and its group's type
    assert.deepEqual(rest.remainder.core.color.red, { value: '#C14242' });
    assert.deepEqual(rest.groups.core.color, { type: 'color' });
  });

  it('leaves out a token whose reference is missing, or circular', () => {
    const broken = readTokensStudio({
      a: { value: '{missing}', type: 'color' },
      b: { value: '{c}', type: 'color' },
      c: { value: '{b}', type: 'color' },
      d: { value: '8px + 1rem', type: 'spacing' }
    });
    const result = convertTokensStudio(broken, setsForTheme(broken));

    assert.equal(result.converted, 0);
    assert.deepEqual(
      result.notes.map(({ name, kind }) => `${name} ${kind}`),
      ['a left-out', 'b left-out', 'c left-out', 'd left-out']
    );
    assert.match(result.notes[1].detail, /Circular reference/);
    assert.match(result.notes[3].detail, /Mixed units/);
  });

  it('converts the "W3C DTCG" key style the same way', () => {
    const dtcg = readTokensStudio({
      space: { $type: 'spacing', base: { $value: '4' } }
    });
    const result = convertTokensStudio(dtcg, setsForTheme(dtcg));

    assert.deepEqual(
      (result.document as Record<string, any>).space.base.$value,
      { value: 4, unit: 'px' }
    );
  });
});

describe('toTokensStudio', () => {
  const flat = (document: DTCGDocument): ExportToken[] =>
    validateTokens(document).tokens.map(
      ({ name, $type, $value, $description, $extensions }) => ({
        name,
        $type,
        $value,
        ...($description && { $description }),
        ...($extensions && { $extensions })
      })
    );

  it('gives back the file as it came, when nothing changed', () => {
    const back = toTokensStudio(flat(light.document), doc.$extensions);

    assert.deepEqual(back, FILE);
  });

  it("writes changed and new tokens in Tokens Studio's shapes, in their set", () => {
    const tokens = flat(light.document).map((token) =>
      token.name === 'space.base'
        ? { ...token, $value: { value: 12, unit: 'px' } }
        : token
    );

    tokens.push(
      {
        name: 'color.danger',
        $type: 'color',
        $value: '{color.red}',
        $description: 'Errors'
      },
      {
        name: 'shadow.card',
        $type: 'shadow',
        $value: [
          {
            color: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.5 },
            offsetX: { value: 0, unit: 'px' },
            offsetY: { value: 2, unit: 'px' },
            blur: { value: 4, unit: 'px' },
            spread: { value: 0, unit: 'px' }
          }
        ]
      }
    );

    const back = toTokensStudio(tokens, doc.$extensions) as Record<string, any>;

    assert.deepEqual(back.core.space.base, {
      value: '12px',
      type: 'dimension'
    });
    assert.deepEqual(back.light.color.danger, {
      value: '{color.red}',
      type: 'color',
      description: 'Errors'
    });
    assert.deepEqual(back.light.shadow.card.value, [
      {
        x: '0px',
        y: '2px',
        blur: '4px',
        spread: '0px',
        color: '#00000080',
        type: 'dropShadow'
      }
    ]);
  });

  it('writes plain DTCG tokens as one set, with $metadata', () => {
    const back = toTokensStudio(
      [
        {
          name: 'type.body',
          $type: 'typography',
          $value: {
            fontFamily: ['Inter', 'sans-serif'],
            fontWeight: 400,
            fontSize: { value: 16, unit: 'px' },
            letterSpacing: { value: 0, unit: 'px' },
            lineHeight: 1.5
          }
        },
        {
          name: 'size.gap',
          $type: 'dimension',
          $value: { value: 1, unit: 'rem' }
        }
      ],
      undefined,
      'tokens'
    );

    assert.deepEqual(back, {
      tokens: {
        type: {
          body: {
            value: {
              fontFamily: 'Inter, sans-serif',
              fontWeight: 400,
              fontSize: '16px',
              letterSpacing: '0px',
              lineHeight: '150%'
            },
            type: 'typography'
          }
        },
        size: { gap: { value: '1rem', type: 'dimension' } }
      },
      $themes: [],
      $metadata: { tokenSetOrder: ['tokens'] }
    });
  });
});

describe('convertTokensStudio, less common values', () => {
  const convert = (
    tokens: Record<string, unknown>,
    uses?: Record<string, any>
  ) => {
    const one = readTokensStudio(tokens);

    return convertTokensStudio(one, uses ?? setsForTheme(one));
  };
  const valueOf = (tokens: Record<string, unknown>, name = 'a') =>
    (convert(tokens).document as Record<string, any>)[name];
  const leftOut = (tokens: Record<string, unknown>) =>
    convert(tokens).notes.find(({ kind }) => kind === 'left-out')?.detail;

  it('reads values already in DTCG shapes', () => {
    assert.deepEqual(
      valueOf({ a: { $value: { value: 4, unit: 'px' }, $type: 'spacing' } })
        .$value,
      { value: 4, unit: 'px' }
    );
    assert.deepEqual(
      valueOf({ a: { value: { value: 2, unit: 's' }, type: 'duration' } })
        .$value,
      { value: 2, unit: 's' }
    );
    assert.deepEqual(valueOf({ a: { value: 200, type: 'duration' } }).$value, {
      value: 200,
      unit: 'ms'
    });
    assert.deepEqual(
      valueOf({
        a: {
          value: { colorSpace: 'display-p3', components: [1, 0, 0] },
          type: 'color'
        }
      }).$value,
      { colorSpace: 'display-p3', components: [1, 0, 0] }
    );
  });

  it('reads font weights by number and by name', () => {
    assert.equal(
      valueOf({ a: { value: '700', type: 'fontWeight' } }).$value,
      700
    );
    assert.equal(
      valueOf({ a: { value: 'Extra Bold', type: 'fontWeights' } }).$value,
      800
    );
    assert.equal(
      valueOf({ a: { value: 'SemiBold', type: 'fontWeights' } }).$value,
      600
    );
    assert.match(
      leftOut({ a: { value: 'Wobbly', type: 'fontWeights' } }) ?? '',
      /not one DTCG knows/
    );
  });

  it('reads line heights, opacity, numbers and stroke styles', () => {
    assert.deepEqual(
      valueOf({ a: { value: '20px', type: 'lineHeights' } }).$value,
      {
        value: 20,
        unit: 'px'
      }
    );
    assert.equal(
      valueOf({ a: { value: 24, type: 'lineHeights' } }).$type,
      'dimension'
    );
    assert.match(
      leftOut({ a: { value: 'normal', type: 'lineHeights' } }) ?? '',
      /no DTCG equivalent/
    );
    assert.equal(valueOf({ a: { value: 0.3, type: 'opacity' } }).$value, 0.3);
    assert.equal(valueOf({ a: { value: '1.5', type: 'number' } }).$value, 1.5);
    assert.match(
      leftOut({ a: { value: 'abc', type: 'number' } }) ?? '',
      /is not a number/
    );
    assert.equal(
      valueOf({ a: { value: 'dashed', type: 'strokeStyle' } }).$value,
      'dashed'
    );
  });

  it('reads a single shadow, a gradient with stops, and a transition', () => {
    const shadow = valueOf({
      a: {
        value: {
          x: 1,
          y: 1,
          blur: 0,
          spread: 0,
          color: '#000',
          blendMode: 'multiply'
        },
        type: 'boxShadow'
      }
    });
    const gradient = convert({
      a: {
        value: {
          kind: 'linear',
          angle: 90,
          stops: [
            { color: '#000', position: 0 },
            { color: '#fff', position: 1 }
          ]
        },
        type: 'gradient'
      }
    });
    const transition = convert({
      a: {
        value: {
          duration: '1s',
          timingFunction: '0, 0, 1, 1',
          property: 'opacity'
        },
        type: 'transition'
      }
    });

    assert.equal(shadow.$value.length, 1);
    assert.equal(
      (gradient.document as Record<string, any>).a.$value[1].position,
      1
    );
    assert.deepEqual(
      [...gradient.notes, ...transition.notes].map(({ kind }) => kind),
      ['changed', 'changed']
    );
    assert.deepEqual(
      (transition.document as Record<string, any>).a.$value.timingFunction,
      [0, 0, 1, 1]
    );
  });

  it('fills in what typography leaves out, and says so', () => {
    const result = convert({
      a: {
        value: { fontFamily: 'Inter', lineHeight: 'AUTO' },
        type: 'typography'
      }
    });
    const value = (result.document as Record<string, any>).a.$value;

    assert.deepEqual(value.fontSize, { value: 16, unit: 'px' });
    assert.equal(value.lineHeight, 1.2);
    assert.equal(value.fontWeight, 400);
    assert.equal(
      result.notes.filter(({ kind }) => kind === 'defaulted').length,
      3
    );
  });

  it('refuses what DTCG cannot hold, saying why', () => {
    const reasons = [
      [{ value: '1em', type: 'spacing' }, /px or rem/],
      [{ value: 'fast', type: 'duration' }, /not ms or s/],
      [{ value: [0, 1, 2], type: 'cubicBezier' }, /needs 4 numbers/],
      [{ value: ['#000'], type: 'boxShadow' }, /not an object/],
      [{ value: '1px solid red', type: 'border' }, /not an object/],
      [
        { value: { color: '#000', width: 1, style: 'wavy' }, type: 'border' },
        /not a DTCG stroke style/
      ],
      [{ value: '1s ease', type: 'transition' }, /not an object/],
      [{ value: 'Inter 16px', type: 'typography' }, /not an object/],
      [
        { value: { fontSize: '1rem', lineHeight: '24' }, type: 'typography' },
        /needs a font size in px/
      ],
      [{ value: 'red', type: 'color' }, /not one DTCG can hold/],
      [{ value: 'x', type: 'banana' }, /not one this converter knows/],
      [{ value: 'x' }, /no type/]
    ] as const;

    reasons.forEach(([token, reason]) =>
      assert.match(leftOut({ a: token }) ?? '', reason, JSON.stringify(token))
    );
  });

  it('applies darken, alpha and mix, and refuses an unknown modifier', () => {
    const modified = (modify: Record<string, unknown>, value = '#3366cc') =>
      convert({
        mixWith: { value: '#ffcc00', type: 'color' },
        a: {
          value,
          type: 'color',
          $extensions: { 'studio.tokens': { modify } }
        }
      });
    const hex = (modify: Record<string, unknown>) =>
      (modified(modify).document as Record<string, any>).a?.$value.hex;

    assert.equal(
      hex({ type: 'darken', value: '0.2', space: 'hsl' }),
      '#2952a3'
    );
    assert.equal(
      (
        modified({ type: 'alpha', value: '0.5' }).document as Record<
          string,
          any
        >
      ).a.$value.alpha,
      0.5
    );
    assert.equal(
      hex({ type: 'mix', value: '0.4', space: 'srgb', color: '{mixWith}' }),
      '#858f7a'
    );
    // An unknown space works in sRGB
    assert.equal(
      hex({ type: 'lighten', value: '0.2', space: 'cmyk' }),
      '#5c85d6'
    );
    assert.match(
      modified({ type: 'saturate', value: '0.2' }).notes.at(-1)?.detail ?? '',
      /not one Tokens Studio has/
    );
    assert.match(
      modified({ type: 'mix', value: '0.5', color: 'nope' }).notes.at(-1)
        ?.detail ?? '',
      /mix with cannot be read/
    );
    assert.match(
      modified({ type: 'lighten', value: '0.5' }, 'red').notes.at(-1)?.detail ??
        '',
      /cannot be read/
    );
  });

  it('refuses a composite value inside text, and keeps deprecation', () => {
    const result = convert({
      shadow: {
        value: { x: 0, y: 0, blur: 0, spread: 0, color: '#000' },
        type: 'boxShadow'
      },
      a: { value: '{shadow} and more', type: 'other' },
      b: {
        value: '#000',
        type: 'color',
        $deprecated: { severity: 'warn', message: 'Use c' }
      },
      c: { value: '#000', type: 'color', $deprecated: true }
    });
    const doc = result.document as Record<string, any>;

    assert.match(
      result.notes.find(({ name }) => name === 'a')?.detail ?? '',
      /composite value inside text/
    );
    assert.equal(doc.b.$deprecated, 'Use c');
    assert.equal(doc.c.$deprecated, true);
  });

  it('resolves through a reference-only set without adding its tokens', () => {
    const file = readTokensStudio({
      core: { blue: { value: '#0000ff', type: 'color' } },
      theme: { accent: { value: '{blue}', type: 'color' } },
      $metadata: { tokenSetOrder: ['core', 'theme'] }
    });
    const result = convertTokensStudio(file, {
      core: 'reference',
      theme: 'included'
    });
    const doc = result.document as Record<string, any>;

    assert.equal(doc.blue, undefined);
    // Not a reference: its target isn't in the document
    assert.equal(doc.accent.$value.hex, '#0000ff');
    assert.deepEqual(
      doc.$extensions[DTF_EXTENSION_KEY].tokensStudio.remainder.core.blue,
      { value: '#0000ff', type: 'color' }
    );
  });
});

describe('toTokensStudio, every DTCG type', () => {
  it("writes each type in Tokens Studio's shape, in the key style of the file", () => {
    const tokens: ExportToken[] = [
      { name: 'w', $type: 'fontWeight', $value: '{weight.bold}' },
      {
        name: 'p3',
        $type: 'color',
        $value: { colorSpace: 'display-p3', components: [1, 0, 0] }
      },
      { name: 'd', $type: 'duration', $value: { value: 200, unit: 'ms' } },
      { name: 'f', $type: 'fontFamily', $value: ['Inter', 'sans-serif'] },
      {
        name: 'b',
        $type: 'border',
        $value: {
          color: '{c}',
          width: { value: 1, unit: 'px' },
          style: 'solid'
        }
      },
      {
        name: 't',
        $type: 'transition',
        $value: {
          duration: { value: 1, unit: 's' },
          delay: { value: 0, unit: 'ms' },
          timingFunction: [0, 0, 1, 1]
        }
      },
      {
        name: 'g',
        $type: 'gradient',
        $value: [
          { color: { colorSpace: 'srgb', components: [0, 0, 0] }, position: 0 },
          { color: { colorSpace: 'srgb', components: [1, 1, 1] }, position: 1 }
        ]
      },
      { name: 's', $type: 'strokeStyle', $value: 'dashed' },
      { name: 'n', $type: 'number', $value: 2 },
      {
        name: 'pointer',
        $type: 'color',
        $value: { $ref: '#/p3/$value' },
        value: { colorSpace: 'srgb', components: [1, 0, 0] }
      }
    ];
    const root = {
      [DTF_EXTENSION_KEY]: {
        tokensStudio: {
          keyStyle: 'dtcg',
          hasSets: false,
          order: ['global'],
          themes: [],
          remainder: {},
          groups: {}
        }
      }
    };
    const back = toTokensStudio(tokens, root).global as Record<string, any>;

    assert.deepEqual(back.w, { $value: '{weight.bold}', $type: 'fontWeights' });
    assert.equal(back.p3.$value, 'color(display-p3 1 0 0)');
    assert.equal(back.d.$value, '200ms');
    assert.equal(back.f.$value, 'Inter, sans-serif');
    assert.deepEqual(back.b.$value, {
      color: '{c}',
      width: '1px',
      style: 'solid'
    });
    assert.deepEqual(back.t.$value, {
      duration: '1s',
      delay: '0ms',
      timingFunction: [0, 0, 1, 1]
    });
    assert.deepEqual(back.g, {
      $value: 'linear-gradient(90deg, #000000 0%, #ffffff 100%)',
      $type: 'color'
    });
    assert.deepEqual(back.s, { $value: 'dashed', $type: 'other' });
    assert.deepEqual(back.n, { $value: 2, $type: 'number' });
    // Tokens Studio has no $ref: the value it resolves to
    assert.deepEqual(back.pointer, { $value: '#ff0000', $type: 'color' });
  });
});
