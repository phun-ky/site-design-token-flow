import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import {
  countLinks,
  newLinkPath,
  publicUrl,
  removeLink,
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

    assert.equal(await uploadLink('token', PATH, '{"a":1}', fetch), null);

    const sent = request(fetch);

    assert.equal(sent.url, `${SUPABASE_URL}/storage/v1/object/tokens/${PATH}`);
    assert.equal(sent.method, 'POST');
    assert.equal(sent.body, '{"a":1}');
    assert.deepEqual(sent.headers, {
      apikey: SUPABASE_KEY,
      authorization: 'Bearer token',
      'content-type': 'application/json',
      'cache-control': 'max-age=60',
      'x-upsert': 'true'
    });
  });

  it('says why the Storage API refused', async () => {
    assert.equal(
      await uploadLink(
        't',
        PATH,
        '{}',
        respond(403, { message: 'new row violates row-level security policy' })
      ),
      'new row violates row-level security policy'
    );
    assert.equal(
      await uploadLink(
        't',
        PATH,
        '{}',
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

describe('countLinks', () => {
  it('counts the JSON files in the folder of the account', async () => {
    const fetch = respond(200, [
      { name: 'a.json' },
      { name: 'b.json' },
      { name: '.emptyFolderPlaceholder' }
    ]);

    assert.equal(await countLinks('token', USER, fetch), 2);
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
      countLinks('token', USER, respond(401, { message: 'jwt expired' })),
      /jwt expired/
    );
  });
});
