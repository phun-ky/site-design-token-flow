// Checks published token links (#143) over HTTP against the local Supabase
// stack: what the Storage API does with the bucket and its policies, which
// the SQL tests in supabase/tests can't show (upserts, CORS, cache headers).
// Run `supabase start` and `supabase functions serve` first, then
// `npm run check:supabase`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const status = JSON.parse(
  execFileSync('supabase', ['status', '-o', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
);
const api = status.API_URL;
const key = status.ANON_KEY;

// It signs up users, so never against a real project
assert.match(api, /^http:\/\/(127\.0\.0\.1|localhost):/, `not local: ${api}`);

const signUp = async () => {
  const response = await fetch(`${api}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: key, 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `check-${crypto.randomUUID()}@example.com`,
      password: crypto.randomUUID()
    })
  });
  const body = await response.json();

  assert.equal(response.status, 200, JSON.stringify(body));

  return { id: body.user.id, token: body.access_token };
};
const upload = (
  user,
  path,
  body,
  { upsert = false, type = 'application/json' } = {}
) =>
  fetch(`${api}/storage/v1/object/tokens/${path}`, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${user.token}`,
      'content-type': type,
      // What supabase-js sends for upload(path, body, { cacheControl: '60', upsert })
      'cache-control': 'max-age=60',
      'x-upsert': String(upsert)
    },
    body
  });
const remove = (user, path) =>
  fetch(`${api}/storage/v1/object/tokens`, {
    method: 'DELETE',
    headers: {
      apikey: key,
      authorization: `Bearer ${user.token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ prefixes: [path] })
  });
const publicUrl = (path) => `${api}/storage/v1/object/public/tokens/${path}`;
const json = (version) =>
  JSON.stringify({ $metadata: { tokenSetOrder: [] }, version });
const check = async (name, run) => {
  await run();
  console.log(`ok - ${name}`);
};
const a = await signUp();
const b = await signUp();
const paths = [1, 2, 3, 4].map(() => `${a.id}/${crypto.randomUUID()}.json`);

await check('a user publishes 3 links', async () => {
  for (const path of paths.slice(0, 3))
    assert.equal((await upload(a, path, json(1))).status, 200);
});
await check('a fourth link is refused', async () => {
  const response = await upload(a, paths[3], json(1));

  assert.ok(
    response.status >= 400 && response.status < 500,
    `${response.status}`
  );
});
await check('an upsert of an existing link at the limit passes', async () => {
  const response = await upload(a, paths[0], json(2), { upsert: true });

  assert.equal(response.status, 200, await response.text());
});
await check(
  'the public URL serves the latest version, with CORS for any origin',
  async () => {
    const response = await fetch(publicUrl(paths[0]), {
      headers: { origin: 'https://www.figma.com' }
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.match(response.headers.get('cache-control') ?? '', /max-age=60/);
    assert.equal((await response.json()).version, 2);
  }
);
await check('a file that is not JSON is refused', async () => {
  const path = `${b.id}/${crypto.randomUUID()}.json`;
  const response = await upload(b, path, '<p>hi</p>', { type: 'text/html' });

  assert.ok(response.status >= 400, `${response.status}`);
});
await check('a file over 2 MiB is refused', async () => {
  const path = `${b.id}/${crypto.randomUUID()}.json`;
  const big = JSON.stringify({ padding: 'x'.repeat(2 * 1024 * 1024) });

  assert.ok((await upload(b, path, big)).status >= 400);
});
await check(
  'another user can not overwrite or delete a link of the owner',
  async () => {
    assert.ok(
      (await upload(b, paths[1], json(9), { upsert: true })).status >= 400
    );
    await remove(b, paths[1]);
    assert.equal((await fetch(publicUrl(paths[1]))).status, 200);
  }
);
await check('the owner unpublishes a link', async () => {
  assert.equal((await remove(a, paths[1])).status, 200);
  assert.equal((await fetch(publicUrl(paths[1]))).status, 400);
});

// Deleting an account (#147), through the delete-account Edge Function
const deleteAccount = (token, origin = 'https://phun-ky.net') =>
  fetch(`${api}/functions/v1/delete-account`, {
    method: 'POST',
    headers: {
      apikey: key,
      origin,
      ...(token && { authorization: `Bearer ${token}` })
    }
  });

await check('deleting an account needs signing in', async () => {
  assert.equal((await deleteAccount(null)).status, 401);
});
// The function's CORS headers can't be checked here: the local gateway answers
// preflight requests itself, with *

const c = await signUp();
const d = await signUp();
const own = [1, 2].map(() => `${c.id}/${crypto.randomUUID()}.json`);

for (const path of own)
  assert.equal((await upload(c, path, json(1))).status, 200);

await check('deleting an account leaves other accounts alone', async () => {
  assert.equal((await deleteAccount(d.token)).status, 200);

  for (const path of own)
    assert.equal((await fetch(publicUrl(path))).status, 200);
});
await check(
  'deleting an account deletes its links, then the account',
  async () => {
    const response = await deleteAccount(c.token);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { deleted: 2 });

    for (const path of own)
      assert.equal((await fetch(publicUrl(path))).status, 400);

    const user = await fetch(`${api}/auth/v1/user`, {
      headers: { apikey: key, authorization: `Bearer ${c.token}` }
    });

    assert.ok(user.status >= 400, `${user.status}`);
  }
);
