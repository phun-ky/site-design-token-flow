import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DTCGDocument } from '../../types/tokens';
import { validateTokens } from '../design-tokens';
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

  it('leaves the documents it was given as they were', () => {
    const incoming = {
      color: { $type: 'color', red: { $value: blue } }
    } as unknown as DTCGDocument;
    const before = JSON.stringify(BASE);

    mergeTokenDocuments(BASE, incoming);
    assert.equal(JSON.stringify(BASE), before);
  });
});
