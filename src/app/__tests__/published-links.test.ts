import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import {
  downloadLink,
  linkName,
  listLinks,
  newLinkPath,
  publicUrl,
  removeLink,
  sameJson,
  uploadLink
} from '../published-links';
import { SUPABASE_KEY, SUPABASE_URL } from '../supabase';

const USER = '00000000-0000-4000-8000-000000000001';
const PATH = `${USER}/11111111-1111-4111-8111-111111111111.json`;
/** fetch that answers with a status and a JSON body, and records the request */
const respond = (status: number, body: unknown = {}) =>
  mock.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status })
  );
const request = (fetch: ReturnType<typeof respond>) => {
  const [url, init] = fetch.mock.calls[0].arguments;

  return {
    url,
    method: init?.method,
    headers: init?.headers as Record<string, string>,
    body: init?.body
  };
};

describe('newLinkPath and publicUrl', () => {
  it('puts a random share id in the folder of the account', () => {
    const path = newLinkPath(USER);

    assert.match(path, new RegExp(`^${USER}/[0-9a-f-]{36}\\.json$`));
    assert.notEqual(newLinkPath(USER), path);
  });

  it('gives the public address of a link', () => {
    assert.equal(
      publicUrl(PATH),
      `${SUPABASE_URL}/storage/v1/object/public/tokens/${PATH}`
    );
  });
});

describe('uploadLink', () => {
  it('upserts the JSON as the account, cached for a minute', async () => {
    const fetch = respond(200, { Key: `tokens/${PATH}` });

    assert.equal(
      await uploadLink('token', PATH, '{"a":1}', 'Brand tökens', fetch),
      null
    );

    const sent = request(fetch);

    assert.equal(sent.url, `${SUPABASE_URL}/storage/v1/object/tokens/${PATH}`);
    assert.equal(sent.method, 'POST');
    assert.equal(sent.body, '{"a":1}');
    assert.deepEqual(sent.headers, {
      apikey: SUPABASE_KEY,
      authorization: 'Bearer token',
      'content-type': 'application/json',
      'cache-control': 'max-age=60',
      'x-upsert': 'true',
      // The name, as base64 UTF-8 JSON
      'x-metadata': Buffer.from('{"name":"Brand tökens"}').toString('base64')
    });
  });

  it('says why the Storage API refused', async () => {
    assert.equal(
      await uploadLink(
        't',
        PATH,
        '{}',
        'A',
        respond(403, { message: 'new row violates row-level security policy' })
      ),
      'new row violates row-level security policy'
    );
    assert.equal(
      await uploadLink(
        't',
        PATH,
        '{}',
        'A',
        mock.fn(async () => new Response('oops', { status: 500 }))
      ),
      '500'
    );
  });
});

describe('removeLink', () => {
  it('deletes the file of the link', async () => {
    const fetch = respond(200, []);

    assert.equal(await removeLink('token', PATH, fetch), null);
    assert.equal(request(fetch).method, 'DELETE');
    assert.equal(request(fetch).body, JSON.stringify({ prefixes: [PATH] }));
    assert.equal(
      await removeLink('token', PATH, respond(400, { message: 'no' })),
      'no'
    );
  });
});

describe('listLinks', () => {
  it('lists the JSON files in the folder of the account', async () => {
    const fetch = respond(200, [
      { name: 'a.json', updated_at: '2026-11-20T10:00:00Z' },
      { name: 'b.json' },
      { name: '.emptyFolderPlaceholder' }
    ]);

    assert.deepEqual(await listLinks('token', USER, fetch), [
      { path: `${USER}/a.json`, updated: '2026-11-20T10:00:00Z' },
      { path: `${USER}/b.json`, updated: '' }
    ]);
    assert.equal(
      request(fetch).url,
      `${SUPABASE_URL}/storage/v1/object/list/tokens`
    );
    assert.equal(
      request(fetch).body,
      JSON.stringify({ prefix: USER, limit: 100, offset: 0 })
    );
  });

  it('throws when the Storage API refuses', async () => {
    await assert.rejects(
      listLinks('token', USER, respond(401, { message: 'jwt expired' })),
      /jwt expired/
    );
  });
});

describe('linkName', () => {
  it('reads the name a link was published with', async () => {
    const fetch = respond(200, { metadata: { name: 'Brand' } });

    assert.equal(await linkName('token', PATH, fetch), 'Brand');
    assert.equal(
      request(fetch).url,
      `${SUPABASE_URL}/storage/v1/object/info/authenticated/tokens/${PATH}`
    );
  });

  it('is null without a name, or when refused', async () => {
    assert.equal(
      await linkName('t', PATH, respond(200, { metadata: {} })),
      null
    );
    assert.equal(
      await linkName('t', PATH, respond(200, { metadata: { name: 3 } })),
      null
    );
    assert.equal(await linkName('t', PATH, respond(404)), null);
  });
});

describe('downloadLink', () => {
  it('downloads past the public cache, as the account', async () => {
    const fetch = respond(200, { global: {} });

    assert.equal(await downloadLink('token', PATH, fetch), '{"global":{}}');
    assert.equal(
      request(fetch).url,
      `${SUPABASE_URL}/storage/v1/object/authenticated/tokens/${PATH}`
    );
    await assert.rejects(
      downloadLink('t', PATH, respond(400, { message: 'Object not found' })),
      /Object not found/
    );
  });
});

describe('sameJson', () => {
  it('compares data, not key order or spacing', () => {
    assert.equal(
      sameJson(
        '{"a":1,"b":[1,{"c":2,"d":3}]}',
        '{ "b": [1, { "d": 3, "c": 2 }], "a": 1 }'
      ),
      true
    );
    assert.equal(sameJson('{"a":[1,2]}', '{"a":[2,1]}'), false);
    assert.equal(sameJson('{"a":1}', '{"a":"1"}'), false);
    assert.equal(sameJson('{', '{'), false);
  });
});
