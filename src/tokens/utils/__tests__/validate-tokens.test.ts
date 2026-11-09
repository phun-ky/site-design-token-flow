import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DTCGDocument } from '../../types/tokens';
import { flattenTokens, validateTokens } from '../design-tokens';

const blue = { colorSpace: 'srgb', components: [0, 0.3294, 0.9412] };
const paths = (doc: unknown) =>
  validateTokens(doc as DTCGDocument).problems.map(({ path }) => path);

describe('validateTokens', () => {
  it('returns the tokens of a valid document, as flattenTokens does', () => {
    const doc = {
      color: {
        $type: 'color',
        blue: { $value: blue },
        accent: { $value: '{color.blue}' }
      }
    } as DTCGDocument;
    const { tokens, problems } = validateTokens(doc);

    assert.deepEqual(problems, []);
    assert.deepEqual(tokens, flattenTokens(doc));
  });

  it('reports every problem, in document order, with its path', () => {
    const { tokens, problems } = validateTokens({
      color: {
        $type: 'color',
        'bad.name': { $value: blue },
        blue: { $value: blue },
        missing: { $value: '{color.nope}' },
        wrong: { $value: '12px' }
      },
      size: {
        $type: 'dimension',
        small: { $value: { value: 4, unit: 'em; x' } },
        both: { $value: { value: 1, unit: 'px' }, child: { $value: 'x' } },
        ok: { $value: { value: 8, unit: 'px' } }
      },
      untyped: { $value: 1 }
    } as unknown as DTCGDocument);

    assert.deepEqual(
      problems.map(({ path }) => path),
      [
        'color.bad.name',
        'color.missing',
        'color.wrong',
        'size.small',
        'size.both',
        'untyped'
      ]
    );
    assert.match(problems[0].message, /Invalid name "color\.bad\.name"/);
    assert.match(
      problems[1].message,
      /Unresolvable reference "\{color\.nope\}"/
    );
    assert.ok(problems[2].error instanceof TypeError);
    assert.ok(problems[3].error instanceof RangeError);
    assert.match(problems[4].message, /has a \$value and children/);
    assert.match(problems[5].message, /has no \$type/);
    assert.deepEqual(
      tokens.map(({ name }) => name),
      ['color.blue', 'size.ok']
    );
  });

  it('reports a problem once, at the token that has it, not at tokens that reference it', () => {
    const { tokens, problems } = validateTokens({
      color: {
        $type: 'color',
        accent: { $value: '{color.broken}' },
        button: { $value: '{color.accent}' },
        broken: { $value: 'red' },
        blue: { $value: blue }
      }
    } as unknown as DTCGDocument);

    assert.deepEqual(
      problems.map(({ path }) => path),
      ['color.broken']
    );
    assert.deepEqual(
      tokens.map(({ name }) => name),
      ['color.blue']
    );
  });

  it('reports a circular reference once', () => {
    const { problems } = validateTokens({
      color: {
        $type: 'color',
        a: { $value: '{color.b}' },
        b: { $value: '{color.a}' },
        c: { $value: '{color.a}' }
      }
    } as unknown as DTCGDocument);

    assert.equal(problems.length, 1);
    assert.match(
      problems[0].message,
      /Circular reference: color\.a → color\.b → color\.a/
    );
  });

  it('leaves out a group with a problem, and does not report references into it', () => {
    assert.deepEqual(
      paths({
        base: { $type: 'color', $extends: '{nowhere}', blue: { $value: blue } },
        alias: { $type: 'color', blue: { $value: '{base.blue}' } },
        size: {
          $type: 'dimension',
          gap: { $value: { value: 4, unit: 'px' }, $description: 1 }
        }
      }),
      ['base', 'size.gap']
    );
  });

  it('reports a problem with the whole document at the empty path', () => {
    const { tokens, problems } = validateTokens({
      $extends: '{missing}',
      color: { $type: 'color', blue: { $value: blue } }
    } as unknown as DTCGDocument);

    assert.equal(problems.length, 1);
    assert.equal(problems[0].path, '');
    assert.deepEqual(tokens, []);
  });

  it('keeps every problem as the error flattenTokens throws, starting with the first', () => {
    const doc = {
      color: { $type: 'color', a: { $value: 'red' }, b: { $value: 'blue' } }
    } as unknown as DTCGDocument;
    const [first] = validateTokens(doc).problems;

    assert.throws(() => flattenTokens(doc), first.error);
  });
});
