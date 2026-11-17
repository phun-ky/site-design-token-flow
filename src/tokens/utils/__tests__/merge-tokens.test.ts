import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import type { DTCGDocument } from '../../types/tokens';
import { DTF_EXTENSION_KEY, validateTokens } from '../design-tokens';
import { mergeTokenDocuments } from '../merge-tokens';

const red = { colorSpace: 'srgb', components: [1, 0, 0] };
const blue = { colorSpace: 'srgb', components: [0, 0, 1] };
const BASE = {
  color: {
    $type: 'color',
    red: { $value: red },
    accent: { $value: '{color.red}', $description: 'The accent' }
  },
  space: { $type: 'dimension', s: { $value: { value: 4, unit: 'px' } } }
} as unknown as DTCGDocument;

describe('mergeTokenDocuments', () => {
  it('adds new tokens into existing and new groups', () => {
    const { document, added, overwritten } = mergeTokenDocuments(BASE, {
      color: { $type: 'color', blue: { $value: blue } },
      radius: { $type: 'dimension', m: { $value: { value: 8, unit: 'px' } } }
    } as unknown as DTCGDocument);

    assert.deepEqual(added, ['color.blue', 'radius.m']);
    assert.deepEqual(overwritten, []);
    assert.deepEqual(
      validateTokens(document).tokens.map(({ name }) => name),
      ['color.red', 'color.accent', 'color.blue', 'space.s', 'radius.m']
    );
  });

  it('overwrites a token of the same name, all of it', () => {
    const { document, overwritten } = mergeTokenDocuments(BASE, {
      color: {
        $type: 'color',
        accent: { $value: '{color.blue}' },
        blue: { $value: blue }
      }
    } as unknown as DTCGDocument);
    const accent = (document as Record<string, any>).color.accent;

    assert.deepEqual(overwritten, [
      { name: 'color.accent', before: '{color.red}', after: '{color.blue}' }
    ]);
    // The description went with the old token
    assert.deepEqual(accent, { $type: 'color', $value: '{color.blue}' });
    assert.deepEqual(validateTokens(document).problems, []);
  });

  it("gives incoming tokens their own group type, not the other document's", () => {
    const { document } = mergeTokenDocuments(
      {
        size: { $type: 'dimension', s: { $value: { value: 4, unit: 'px' } } }
      } as unknown as DTCGDocument,
      {
        size: { $type: 'number', ratio: { $value: 1.5 } }
      } as unknown as DTCGDocument
    );
    const size = (document as Record<string, any>).size;

    assert.equal(size.$type, 'dimension');
    assert.equal(size.ratio.$type, 'number');
    assert.deepEqual(validateTokens(document).problems, []);
  });

  it('resolves references between the two documents', () => {
    const { document } = mergeTokenDocuments(BASE, {
      button: { background: { $type: 'color', $value: '{color.accent}' } }
    } as unknown as DTCGDocument);
    const { tokens, problems } = validateTokens(document);

    assert.deepEqual(problems, []);
    assert.deepEqual(
      tokens.find(({ name }) => name === 'button.background')?.ancestors,
      ['color-accent']
    );
  });

  it('replaces a token with a group, or a group with a token, and reports it', () => {
    const { document, overwritten } = mergeTokenDocuments(BASE, {
      space: {
        $type: 'dimension',
        s: { tight: { $value: { value: 2, unit: 'px' } } }
      },
      color: { $type: 'color', $value: red }
    } as unknown as DTCGDocument);
    const merged = document as Record<string, any>;

    assert.deepEqual(merged.space.s.tight.$value, { value: 2, unit: 'px' });
    assert.deepEqual(merged.color, { $type: 'color', $value: red });
    assert.deepEqual(
      overwritten.map(({ name, after }) => [name, after === undefined]),
      [
        ['space.s', true],
        ['color', false]
      ]
    );
  });

  it('tells a token already there, the same, from one it overwrites', () => {
    const { overwritten, unchanged } = mergeTokenDocuments(BASE, {
      color: {
        $type: 'color',
        red: { $value: red },
        accent: { $value: '{color.red}' }
      }
    } as unknown as DTCGDocument);

    assert.deepEqual(unchanged, ['color.red']);
    // The description differs, so the accent is overwritten
    assert.deepEqual(
      overwritten.map(({ name }) => name),
      ['color.accent']
    );
  });

  it('keeps $root tokens and the references to them (#125)', () => {
    const { document, added } = mergeTokenDocuments(BASE, {
      brand: { $type: 'color', $root: { $value: blue }, dark: { $value: red } },
      link: { $type: 'color', $value: '{brand.$root}' }
    } as unknown as DTCGDocument);

    assert.deepEqual(added, ['brand.$root', 'brand.dark', 'link']);
    assert.deepEqual(validateTokens(document).problems, []);
  });

  it('keeps group $extends and the tokens it brings in (#125)', () => {
    const { document } = mergeTokenDocuments(BASE, {
      base: { $type: 'color', red: { $value: red } },
      brand: {
        $extends: '{base}',
        $description: 'The brand',
        blue: { $value: blue }
      },
      link: { $type: 'color', $value: '{brand.red}' }
    } as unknown as DTCGDocument);
    const { tokens, problems } = validateTokens(document);

    assert.deepEqual(problems, []);
    assert.equal(
      (document as Record<string, any>).brand.$description,
      'The brand'
    );
    assert.ok(tokens.some(({ name }) => name === 'brand.red'));
  });

  it('puts a group type only on groups it makes, not on yours', () => {
    const { document } = mergeTokenDocuments(
      {
        size: { s: { $type: 'dimension', $value: { value: 4, unit: 'px' } } }
      } as unknown as DTCGDocument,
      {
        size: { $type: 'number', ratio: { $value: 1.5 } },
        ratio: { $type: 'number', golden: { $value: 1.618 } }
      } as unknown as DTCGDocument
    );
    const merged = document as Record<string, any>;

    assert.equal(merged.size.$type, undefined);
    assert.equal(merged.ratio.$type, 'number');
    assert.deepEqual(validateTokens(document).problems, []);
  });

  it('merges the showcase into nothing without new problems (#125)', () => {
    const showcase = JSON.parse(
      readFileSync(
        new URL('../../../../site/showcase.tokens.json', import.meta.url),
        'utf8'
      )
    ) as DTCGDocument;

    assert.deepEqual(
      validateTokens(mergeTokenDocuments({} as DTCGDocument, showcase).document)
        .problems,
      validateTokens(showcase).problems
    );
  });

  it("keeps your document's root properties, such as Tokens Studio details", () => {
    const yours = {
      ...BASE,
      $extensions: { studio: 'yours' }
    } as unknown as DTCGDocument;
    const { document } = mergeTokenDocuments(yours, {
      $extensions: { studio: 'incoming' },
      color: { $type: 'color', blue: { $value: blue } }
    } as unknown as DTCGDocument);

    assert.deepEqual((document as Record<string, any>).$extensions, {
      studio: 'yours'
    });
  });

  it('combines both Tokens Studio files for the export, the file winning (#129)', () => {
    const studio = (details: object) => ({
      $extensions: {
        [DTF_EXTENSION_KEY]: {
          tokensStudio: { keyStyle: 'legacy', hasSets: true, ...details }
        }
      }
    });
    const theme = (id: string, name: string) => ({
      id,
      name,
      selectedTokenSets: {}
    });
    const yours = {
      ...BASE,
      ...studio({
        order: ['core', 'light'],
        themes: [theme('l', 'Light'), theme('d', 'Dark')],
        remainder: {
          core: { old: { value: '1', type: 'number' } },
          light: { a: { value: '#000', type: 'color' } }
        },
        groups: { core: { '': { type: 'number' } } }
      })
    } as unknown as DTCGDocument;
    const file = {
      color: { $type: 'color', blue: { $value: blue } },
      ...studio({
        order: ['light', 'brand'],
        themes: [theme('d', 'Dark, new'), theme('b', 'Brand')],
        remainder: {
          light: { a: { value: '#fff', type: 'color' }, b: { value: '#111' } },
          brand: { c: { value: '#222', type: 'color' } }
        },
        groups: { core: { '': { description: 'Core' } } }
      })
    } as unknown as DTCGDocument;
    const { document } = mergeTokenDocuments(yours, file);
    const details = (document as Record<string, any>).$extensions[
      DTF_EXTENSION_KEY
    ].tokensStudio;

    assert.deepEqual(details.order, ['core', 'light', 'brand']);
    assert.deepEqual(
      details.themes.map(({ name }: { name: string }) => name),
      ['Light', 'Dark, new', 'Brand']
    );
    assert.deepEqual(details.remainder.light, {
      a: { value: '#fff', type: 'color' },
      b: { value: '#111' }
    });
    assert.deepEqual(details.remainder.core, {
      old: { value: '1', type: 'number' }
    });
    assert.deepEqual(details.groups.core[''], {
      type: 'number',
      description: 'Core'
    });

    // Only the file is Tokens Studio: its details come with it
    assert.deepEqual(
      (mergeTokenDocuments(BASE, file).document as Record<string, any>)
        .$extensions[DTF_EXTENSION_KEY].tokensStudio.order,
      ['light', 'brand']
    );
  });

  it('leaves the documents it was given as they were', () => {
    const incoming = {
      color: { $type: 'color', red: { $value: blue } }
    } as unknown as DTCGDocument;
    const before = JSON.stringify(BASE);

    mergeTokenDocuments(BASE, incoming);
    assert.equal(JSON.stringify(BASE), before);
  });
});
