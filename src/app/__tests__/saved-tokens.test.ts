import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { describeFlowSource } from '../flow-source';
import {
  STORAGE_KEY,
  browserStorage,
  chooseFlowTokens,
  readSaved,
  writeSaved,
  type TokenStorage
} from '../saved-tokens';

/** localStorage in memory; `full` makes writes throw, like a full quota */
const memory = (initial?: unknown, full = false) => {
  const items = new Map<string, string>();

  if (initial !== undefined)
    items.set(
      STORAGE_KEY,
      typeof initial === 'string' ? initial : JSON.stringify(initial)
    );

  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (full) throw new DOMException('Quota exceeded', 'QuotaExceededError');

      items.set(key, value);
    }
  } satisfies TokenStorage & { items: Map<string, string> };
};
const blue = { colorSpace: 'srgb', components: [0, 0.33, 0.94] };
const VALID = JSON.stringify({
  color: {
    $type: 'color',
    blue: { $value: blue },
    cta: { $value: '{color.blue}' }
  }
});
const OTHER = JSON.stringify({
  color: { $type: 'color', red: { $value: blue } }
});
const BROKEN = JSON.stringify({
  color: { $type: 'color', cta: { $value: '{color.nope}' } }
});

describe('browserStorage', () => {
  const withWindow = (value: unknown, run: () => void) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

    Object.defineProperty(globalThis, 'window', { value, configurable: true });

    try {
      run();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
      else delete (globalThis as { window?: unknown }).window;
    }
  };

  it('returns localStorage when the browser allows it', () => {
    const storage = memory();

    withWindow({ localStorage: storage }, () =>
      assert.equal(browserStorage(), storage)
    );
  });

  it('returns null when the browser blocks it', () => {
    withWindow(
      {
        get localStorage() {
          throw new DOMException('Blocked', 'SecurityError');
        }
      },
      () => assert.equal(browserStorage(), null)
    );
  });
});

describe('readSaved', () => {
  it('reads what the playground saved, today and before this version', () => {
    assert.deepEqual(readSaved(memory({ preset: 'custom', custom: VALID })), {
      preset: 'custom',
      custom: VALID
    });
    assert.deepEqual(
      readSaved(memory({ preset: 'bundled', custom: BROKEN, valid: VALID })),
      { preset: 'bundled', custom: BROKEN, valid: VALID }
    );
  });

  it('leaves out what it does not expect, and survives broken data', () => {
    assert.deepEqual(
      readSaved(
        memory({ preset: 'other', custom: 1, valid: null, extra: 'x' })
      ),
      {}
    );
    assert.deepEqual(readSaved(memory('not json')), {});
    assert.deepEqual(readSaved(memory('null')), {});
    assert.deepEqual(readSaved(memory()), {});
    assert.deepEqual(readSaved(null), {});
  });
});

describe('writeSaved', () => {
  it('changes part of the state and keeps the rest', () => {
    const storage = memory({ preset: 'custom', custom: VALID });

    assert.equal(writeSaved(storage, { valid: VALID }), true);
    assert.deepEqual(JSON.parse(storage.items.get(STORAGE_KEY) as string), {
      preset: 'custom',
      custom: VALID,
      valid: VALID
    });
  });

  it('says when it could not save', () => {
    assert.equal(writeSaved(null, { custom: VALID }), false);
    assert.equal(writeSaved(memory(undefined, true), { custom: VALID }), false);
  });
});

describe('chooseFlowTokens', () => {
  it('shows your latest edits when they have no problems', () => {
    const flow = chooseFlowTokens(
      memory({ custom: VALID, valid: OTHER }),
      false
    );

    assert.equal(flow.kind, 'yours');
    assert.ok(flow.kind === 'yours' && flow.latest);
    assert.deepEqual(
      flow.kind === 'yours' && flow.tokens.map(({ name }) => name),
      ['color.blue', 'color.cta']
    );
  });

  it('shows the last version without problems while your edits have some', () => {
    const flow = chooseFlowTokens(
      memory({ custom: BROKEN, valid: VALID }),
      false
    );

    assert.ok(flow.kind === 'yours' && !flow.latest);
    assert.equal(flow.kind === 'yours' && flow.tokens.length, 2);
  });

  it('shows the example, and says why', () => {
    assert.deepEqual(chooseFlowTokens(null, false), {
      kind: 'example',
      reason: 'blocked'
    });
    assert.deepEqual(chooseFlowTokens(memory(), false), {
      kind: 'example',
      reason: 'none'
    });
    assert.deepEqual(chooseFlowTokens(memory({ custom: '{}' }), false), {
      kind: 'example',
      reason: 'none'
    });
    assert.deepEqual(chooseFlowTokens(memory({ custom: BROKEN }), false), {
      kind: 'example',
      reason: 'problems'
    });
    assert.deepEqual(chooseFlowTokens(memory({ custom: '{ "a": ' }), false), {
      kind: 'example',
      reason: 'problems'
    });
    assert.deepEqual(chooseFlowTokens(memory({ custom: VALID }), true), {
      kind: 'example',
      reason: 'chosen',
      yours: 2
    });
  });
});

describe('describeFlowSource', () => {
  const yours = chooseFlowTokens(memory({ custom: VALID }), false);
  const earlier = chooseFlowTokens(
    memory({ custom: BROKEN, valid: VALID }),
    false
  );
  const example = (current: boolean) => ({
    label: 'The example',
    detail: '201 tokens',
    href: './?tokens=example',
    current
  });

  it('offers your tokens and the example, with the shown one current', () => {
    assert.deepEqual(describeFlowSource(yours, 201), {
      options: [
        {
          label: 'Your tokens',
          detail: '2 tokens, saved in this browser',
          href: './',
          current: true
        },
        example(false)
      ],
      note: null,
      links: [{ label: 'Edit them in the playground', href: './playground' }]
    });
    assert.deepEqual(
      describeFlowSource({ kind: 'example', reason: 'chosen', yours: 2 }, 201)
        .options,
      [
        {
          label: 'Your tokens',
          detail: '2 tokens, saved in this browser',
          href: './',
          current: false
        },
        example(true)
      ]
    );
  });

  it('says when the flow shows an earlier version of your tokens', () => {
    const source = describeFlowSource(earlier, 201);

    assert.match(
      source.note ?? '',
      /^Showing the last version of your tokens without problems/
    );
    assert.deepEqual(source.links, [
      { label: 'Fix them in the playground', href: './playground' }
    ]);
  });

  it('offers only the example, and says why, when you have no tokens to show', () => {
    const none = describeFlowSource({ kind: 'example', reason: 'none' }, 201);
    const problems = describeFlowSource(
      { kind: 'example', reason: 'problems' },
      201
    );
    const blocked = describeFlowSource(
      { kind: 'example', reason: 'blocked' },
      201
    );

    for (const source of [none, problems, blocked])
      assert.deepEqual(source.options, [example(true)]);

    assert.equal(none.note, 'You have no tokens of your own yet.');
    assert.deepEqual(none.links, [
      { label: 'Try your own in the playground', href: './playground' }
    ]);
    assert.deepEqual(problems.links, [
      { label: 'Fix them in the playground', href: './playground' }
    ]);
    assert.match(blocked.note ?? '', /blocks storage/);
    assert.deepEqual(blocked.links, []);
  });

  it('counts one token as one', () => {
    const one = chooseFlowTokens(memory({ custom: OTHER }), false);

    assert.equal(
      describeFlowSource(one, 1).options[0].detail,
      '1 token, saved in this browser'
    );
    assert.equal(
      describeFlowSource({ kind: 'example', reason: 'chosen' }, 1).options[0]
        .detail,
      '0 tokens, saved in this browser'
    );
  });
});
