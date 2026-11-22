import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { describeFlowSource } from '../flow-source';
import {
  STORAGE_KEY,
  addDocument,
  browserStorage,
  chooseFlowTokens,
  deleteDocument,
  listDocuments,
  listFlowDocuments,
  readSaved,
  renameDocument,
  restoreDocument,
  setDocumentLink,
  switchDocument,
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
      current: 'yours',
      documents: [
        { id: 'yours', name: 'Your tokens', custom: VALID, valid: VALID }
      ]
    });
  });

  it('says when it could not save', () => {
    assert.equal(writeSaved(null, { custom: VALID }), false);
    assert.equal(writeSaved(memory(undefined, true), { custom: VALID }), false);
  });
});

describe('chooseFlowTokens', () => {
  const yours = (state: object) => memory({ preset: 'custom', ...state });

  it('shows the preset the playground has chosen, the showcase by default', () => {
    assert.deepEqual(chooseFlowTokens(memory()), {
      kind: 'preset',
      preset: 'showcase'
    });
    assert.deepEqual(
      chooseFlowTokens(memory({ preset: 'bundled', custom: VALID })),
      { kind: 'preset', preset: 'bundled' }
    );
  });

  it('shows your latest edits when they have no problems', () => {
    const flow = chooseFlowTokens(yours({ custom: VALID, valid: OTHER }));

    assert.equal(flow.kind, 'yours');
    assert.ok(flow.kind === 'yours' && flow.latest);
    assert.deepEqual(
      flow.kind === 'yours' && flow.tokens.map(({ name }) => name),
      ['color.blue', 'color.cta']
    );
  });

  it('shows the last version without problems while your edits have some', () => {
    const flow = chooseFlowTokens(yours({ custom: BROKEN, valid: VALID }));

    assert.ok(flow.kind === 'yours' && !flow.latest);
    assert.equal(flow.kind === 'yours' && flow.tokens.length, 2);
  });

  it('shows the example instead, and says why', () => {
    const name = 'Your tokens';

    assert.deepEqual(chooseFlowTokens(null), {
      kind: 'example',
      reason: 'blocked'
    });
    assert.deepEqual(chooseFlowTokens(yours({})), {
      kind: 'example',
      reason: 'none',
      name
    });
    assert.deepEqual(chooseFlowTokens(yours({ custom: '{}' })), {
      kind: 'example',
      reason: 'none',
      name
    });
    assert.deepEqual(chooseFlowTokens(yours({ custom: BROKEN })), {
      kind: 'example',
      reason: 'problems',
      name
    });
    assert.deepEqual(chooseFlowTokens(yours({ custom: '{ "a": ' })), {
      kind: 'example',
      reason: 'problems',
      name
    });
  });

  it('shows the current document, with its name', () => {
    const flow = chooseFlowTokens(
      memory({
        preset: 'custom',
        current: 'b',
        documents: [
          { id: 'a', name: 'A', custom: OTHER },
          { id: 'b', name: 'Brand', custom: VALID }
        ]
      })
    );

    assert.ok(flow.kind === 'yours');
    assert.equal(flow.name, 'Brand');
    assert.equal(flow.tokens.length, 2);
  });
});

describe('listFlowDocuments', () => {
  it('counts what the flow would show for each document', () => {
    const storage = memory({
      current: 'b',
      documents: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B', custom: BROKEN, valid: OTHER },
        { id: 'c', name: 'C', custom: BROKEN }
      ]
    });

    assert.deepEqual(listFlowDocuments(storage), {
      current: 'b',
      documents: [
        { id: 'a', name: 'A', tokens: 0, problems: false },
        { id: 'b', name: 'B', tokens: 1, problems: false },
        { id: 'c', name: 'C', tokens: 0, problems: true }
      ]
    });
  });
});

describe('documents', () => {
  it('reads state saved before documents as the first document', () => {
    const storage = memory({ preset: 'custom', custom: VALID, valid: OTHER });

    assert.deepEqual(listDocuments(storage), {
      documents: [
        { id: 'yours', name: 'Your tokens', custom: VALID, valid: OTHER }
      ],
      current: 'yours'
    });
    assert.deepEqual(readSaved(storage), {
      preset: 'custom',
      custom: VALID,
      valid: OTHER
    });
  });

  it('lists the first document, empty, before anything is saved', () => {
    assert.deepEqual(listDocuments(memory()), {
      documents: [{ id: 'yours', name: 'Your tokens' }],
      current: 'yours'
    });
    assert.deepEqual(listDocuments(null).current, 'yours');
  });

  it('leaves out documents that are not what it expects', () => {
    const storage = memory({
      current: 'gone',
      documents: [
        { id: 'a', name: 'A' },
        { id: 1, name: 'B' },
        { id: 'c', name: 'C', custom: 2 },
        null
      ]
    });

    assert.deepEqual(listDocuments(storage), {
      documents: [{ id: 'a', name: 'A' }],
      current: 'a'
    });
  });

  it('adds an empty document with a free name, and makes it current', () => {
    const storage = memory({ custom: VALID });
    const added = addDocument(storage);

    assert.equal(added?.name, 'Your tokens 2');
    assert.equal(added?.custom, '{}');
    assert.equal(listDocuments(storage).current, added?.id);
    assert.equal(addDocument(storage)?.name, 'Your tokens 3');
    assert.deepEqual(readSaved(storage), { custom: '{}' });
    assert.equal(addDocument(null), null);
  });

  it('adds a document with a name, tokens and a link, as opened', () => {
    const storage = memory({ custom: VALID });
    const added = addDocument(storage, {
      name: ' Brand ',
      custom: OTHER,
      link: 'u/s.json'
    });

    assert.deepEqual(
      { ...added, id: undefined },
      { id: undefined, name: 'Brand', custom: OTHER, link: 'u/s.json' }
    );
    assert.equal(listDocuments(storage).current, added?.id);
    assert.equal(addDocument(storage, { name: '  ' })?.name, 'Your tokens 3');
  });

  it('keeps the first document when adding to nothing saved', () => {
    const storage = memory();

    addDocument(storage);

    assert.deepEqual(
      listDocuments(storage).documents.map(({ name }) => name),
      ['Your tokens', 'Your tokens 2']
    );
  });

  it('writes to the current document only', () => {
    const storage = memory({ custom: VALID });
    const added = addDocument(storage);

    writeSaved(storage, { custom: OTHER });
    switchDocument(storage, 'yours');

    assert.deepEqual(readSaved(storage), { custom: VALID });
    assert.equal(
      listDocuments(storage).documents.find(({ id }) => id === added?.id)
        ?.custom,
      OTHER
    );
  });

  it('switches only to a document that exists', () => {
    const storage = memory({ custom: VALID });

    assert.equal(switchDocument(storage, 'nope'), false);
    assert.equal(listDocuments(storage).current, 'yours');
  });

  it('renames, keeping the name when the new one is blank', () => {
    const storage = memory({ custom: VALID });

    assert.equal(renameDocument(storage, 'yours', '  Brand  '), true);
    assert.equal(renameDocument(storage, 'yours', '   '), false);
    assert.equal(renameDocument(storage, 'nope', 'X'), false);
    assert.equal(listDocuments(storage).documents[0].name, 'Brand');
  });

  it('sets and clears the link of a document', () => {
    const storage = memory({ custom: VALID });

    assert.equal(setDocumentLink(storage, 'yours', 'u/s.json'), true);
    assert.equal(listDocuments(storage).documents[0].link, 'u/s.json');
    assert.equal(setDocumentLink(storage, 'yours', undefined), true);
    assert.equal('link' in listDocuments(storage).documents[0], false);
    assert.equal(setDocumentLink(storage, 'nope', 'u/s.json'), false);
  });

  it('leaves out a link that is not a string', () => {
    const storage = memory({
      documents: [{ id: 'a', name: 'A', link: 3 }]
    });

    assert.deepEqual(listDocuments(storage).documents, [
      { id: 'yours', name: 'Your tokens' }
    ]);
  });

  it('numbers a name that is taken', () => {
    const storage = memory({ custom: VALID });

    assert.equal(addDocument(storage, { name: 'Brand' })?.name, 'Brand');
    assert.equal(addDocument(storage, { name: 'Brand' })?.name, 'Brand 2');
    assert.equal(
      addDocument(storage, { name: 'Your tokens' })?.name,
      'Your tokens 2'
    );
  });

  it('restores a deleted document where it was, as current', () => {
    const storage = memory({ custom: VALID });
    const added = addDocument(storage, { name: 'Brand', custom: OTHER });
    const third = addDocument(storage);
    const brand = listDocuments(storage).documents[1];

    deleteDocument(storage, added?.id as string);
    assert.equal(restoreDocument(storage, brand, 1), true);

    const { documents, current } = listDocuments(storage);

    assert.deepEqual(
      documents.map(({ id }) => id),
      ['yours', added?.id, third?.id]
    );
    assert.equal(current, added?.id);
    assert.deepEqual(readSaved(storage), { custom: OTHER });
  });

  it('restores the last document, without a second one of the same id', () => {
    const storage = memory({ custom: VALID });
    const [yours] = listDocuments(storage).documents;

    deleteDocument(storage, 'yours');
    restoreDocument(storage, yours, 0);

    assert.deepEqual(listDocuments(storage).documents, [yours]);
  });

  it('deletes, making the first one left current', () => {
    const storage = memory({ custom: VALID });
    const added = addDocument(storage);

    assert.equal(deleteDocument(storage, added?.id as string), true);
    assert.equal(listDocuments(storage).current, 'yours');
    deleteDocument(storage, 'yours');
    assert.deepEqual(listDocuments(storage), {
      documents: [{ id: 'yours', name: 'Your tokens' }],
      current: 'yours'
    });
    assert.deepEqual(readSaved(storage), {});
  });
});

describe('describeFlowSource', () => {
  const choices = {
    showcase: 42,
    example: 201,
    current: 'b',
    documents: [
      { id: 'a', name: 'A', tokens: 0, problems: false },
      { id: 'b', name: 'Brand', tokens: 2, problems: false },
      { id: 'c', name: 'C', tokens: 0, problems: true },
      { id: 'd', name: 'D', tokens: 1, problems: false }
    ]
  };
  const shown = (flow: Parameters<typeof describeFlowSource>[0]) =>
    describeFlowSource(flow, choices).options.filter(({ current }) => current);
  const playground = (label: string) => [{ label, href: './playground' }];

  it('offers the presets and your documents, as the playground does', () => {
    assert.deepEqual(
      describeFlowSource({ kind: 'preset', preset: 'showcase' }, choices),
      {
        options: [
          {
            label: 'Showcase',
            detail: '42 tokens',
            preset: 'showcase',
            current: true
          },
          {
            label: 'Example file',
            detail: '201 tokens',
            preset: 'bundled',
            current: false
          },
          {
            label: 'A',
            detail: 'Empty',
            preset: 'custom',
            document: 'a',
            current: false
          },
          {
            label: 'Brand',
            detail: '2 tokens',
            preset: 'custom',
            document: 'b',
            current: false
          },
          {
            label: 'C',
            detail: 'Has problems',
            preset: 'custom',
            document: 'c',
            current: false
          },
          {
            label: 'D',
            detail: '1 token',
            preset: 'custom',
            document: 'd',
            current: false
          }
        ],
        note: null,
        links: playground('Edit it in the playground')
      }
    );
    assert.deepEqual(
      shown({ kind: 'preset', preset: 'bundled' }).map(({ label }) => label),
      ['Example file']
    );
  });

  it('marks the current document as shown', () => {
    const flow = chooseFlowTokens(memory({ preset: 'custom', custom: VALID }));
    const source = describeFlowSource(flow, choices);

    assert.deepEqual(
      shown(flow).map(({ label }) => label),
      ['Brand']
    );
    assert.equal(source.note, null);
    assert.deepEqual(source.links, playground('Edit them in the playground'));
  });

  it('says when the flow shows an earlier version of your document', () => {
    const source = describeFlowSource(
      chooseFlowTokens(
        memory({ preset: 'custom', custom: BROKEN, valid: VALID })
      ),
      choices
    );

    assert.match(
      source.note ?? '',
      /^Showing the last version of “Your tokens” without problems/
    );
    assert.deepEqual(source.links, playground('Fix them in the playground'));
  });

  it('says why it shows the example file instead of your document', () => {
    const none = describeFlowSource(
      { kind: 'example', reason: 'none', name: 'A' },
      choices
    );
    const problems = describeFlowSource(
      { kind: 'example', reason: 'problems', name: 'C' },
      choices
    );

    assert.equal(
      none.note,
      '“A” is empty, so the flow shows the example file.'
    );
    assert.deepEqual(none.links, playground('Add tokens in the playground'));
    assert.equal(
      problems.note,
      '“C” has problems, so the flow shows the example file.'
    );
    assert.deepEqual(problems.links, playground('Fix them in the playground'));
  });

  it('offers only the example file when the browser blocks storage', () => {
    const blocked = describeFlowSource(
      { kind: 'example', reason: 'blocked' },
      choices
    );

    assert.deepEqual(blocked.options, [
      {
        label: 'Example file',
        detail: '201 tokens',
        preset: 'bundled',
        current: true
      }
    ]);
    assert.match(blocked.note ?? '', /blocks storage/);
    assert.deepEqual(blocked.links, []);
  });
});
