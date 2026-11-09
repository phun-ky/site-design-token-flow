import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { convertTokenText } from '../convert-tokens';

const STUDIO = JSON.stringify({
  core: { red: { value: '#c14242', type: 'color' } },
  light: { accent: { value: '{red}', type: 'color' } },
  dark: { accent: { value: '#000000', type: 'color' } },
  $themes: [
    {
      id: 'l',
      name: 'Light',
      group: 'mode',
      selectedTokenSets: { core: 'source', light: 'enabled' }
    },
    {
      id: 'd',
      name: 'Dark',
      selectedTokenSets: { core: 'source', dark: 'enabled' }
    }
  ],
  $metadata: { tokenSetOrder: ['core', 'light', 'dark'] }
});

describe('convertTokenText', () => {
  it('returns a DTCG file as it is', () => {
    const text = JSON.stringify({
      a: { $type: 'number', $value: 1 }
    });
    const result = convertTokenText(text);

    assert.equal(result?.summary.format, 'dtcg');
    assert.equal(result?.conversion.converted, 1);
    assert.deepEqual(result?.conversion.notes, []);
  });

  it('converts a Tokens Studio file with its first theme, another, or chosen sets', () => {
    const first = convertTokenText(STUDIO);

    assert.equal(first?.summary.format, 'tokens-studio');
    assert.deepEqual(first?.summary.themes, [
      { id: 'l', name: 'Light', group: 'mode' },
      { id: 'd', name: 'Dark' }
    ]);
    assert.deepEqual(first?.uses, {
      core: 'included',
      light: 'included',
      dark: 'left-out'
    });
    assert.equal(first?.checked.problems.length, 0);

    const dark = convertTokenText(STUDIO, { theme: 'd' });

    assert.deepEqual(dark?.uses, {
      core: 'included',
      light: 'left-out',
      dark: 'included'
    });

    const chosen = convertTokenText(STUDIO, {
      theme: '',
      uses: { core: 'left-out', light: 'included', dark: 'left-out' }
    });

    // The accent's reference is in a set left out
    assert.equal(chosen?.conversion.converted, 0);
    assert.equal(chosen?.conversion.notes[0].kind, 'left-out');
  });

  it('returns null for text that is not JSON', () => {
    assert.equal(convertTokenText('{ "a": '), null);
  });
});
