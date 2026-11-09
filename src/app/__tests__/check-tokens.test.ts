import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkTokenText, countTokens, lineOfProblem } from '../check-tokens';

const VALID = JSON.stringify(
  {
    color: {
      $type: 'color',
      blue: { $value: { colorSpace: 'srgb', components: [0, 0.33, 0.94] } },
      cta: { $value: '{color.blue}' }
    }
  },
  null,
  2
);
const BROKEN = JSON.stringify(
  {
    color: {
      $type: 'color',
      blue: { $value: { colorSpace: 'srgb', components: [0, 0.33, 0.94] } },
      cta: { $value: '{color.nope}' }
    }
  },
  null,
  2
);

describe('checkTokenText', () => {
  it('returns the tokens of valid JSON', () => {
    const checked = checkTokenText(VALID);

    assert.equal(checked.json, true);
    assert.deepEqual(checked.problems, []);
    assert.deepEqual(
      checked.tokens.map(({ name }) => name),
      ['color.blue', 'color.cta']
    );
  });

  it('returns every problem as plain data, which a worker can send', () => {
    const checked = checkTokenText(BROKEN);

    assert.deepEqual(checked.problems, [
      {
        path: 'color.cta',
        message: 'Unresolvable reference "{color.nope}" in "color.cta"'
      }
    ]);
    assert.deepEqual(structuredClone(checked), checked);
  });

  it('says when the text is not JSON', () => {
    const checked = checkTokenText('{ "color": ');

    assert.equal(checked.json, false);
    assert.equal(checked.problems.length, 1);
    assert.equal(checked.problems[0].path, '');
  });
});

describe('countTokens', () => {
  it('counts one token per $value', () => {
    assert.equal(countTokens(VALID), 2);
    assert.equal(countTokens('{}'), 0);
  });
});

describe('lineOfProblem', () => {
  it('finds the line of a token by its path', () => {
    assert.equal(
      lineOfProblem(BROKEN, { path: 'color.cta', message: '' }),
      BROKEN.split('\n').findIndex((line) => line.includes('"cta"')) + 1
    );
  });

  it('finds a group, and the right one of two names', () => {
    const text = '{\n  "a": { "cta": 1 },\n  "color": {\n    "cta": 2\n  }\n}';

    assert.equal(lineOfProblem(text, { path: 'color', message: '' }), 3);
    assert.equal(lineOfProblem(text, { path: 'color.cta', message: '' }), 4);
  });

  it('reads the line from a JSON syntax error', () => {
    assert.equal(
      lineOfProblem('', {
        path: '',
        message: 'Expected property name at line 3 column 5'
      }),
      3
    );
    assert.equal(
      lineOfProblem('{\n"a":\n', {
        path: '',
        message: 'Unexpected end of JSON input at position 6'
      }),
      2
    );
  });

  it('skips a string value with the same name as the key', () => {
    const text = '{\n  "$type": "color",\n  "color": {\n    "a": 1\n  }\n}';

    assert.equal(lineOfProblem(text, { path: 'color.a', message: '' }), 4);
  });

  it('returns null when it cannot tell', () => {
    assert.equal(lineOfProblem('{}', { path: 'missing', message: '' }), null);
    assert.equal(lineOfProblem('{}', { path: '', message: 'Bad' }), null);
  });
});
