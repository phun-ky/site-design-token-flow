/* global Deno */
// Deletes the signed in account and everything published with it (#147):
// the files in tokens/<user id>/, then the user. Runs with the service role
// key, which only Edge Functions have; the caller's own token says whose
// account it is, so nobody can delete another's.

const SITE_ORIGIN = 'https://phun-ky.net';
// The Vite dev server, allowed only where ALLOW_LOCAL_ORIGIN=true is set: in
// supabase/functions/.env for `supabase functions serve`, never in production
const LOCAL_ORIGIN = 'http://localhost:5173';
const cors = (request: Request): Record<string, string> => {
  const origin = request.headers.get('origin') ?? '';
  const allowed =
    origin === SITE_ORIGIN ||
    (origin === LOCAL_ORIGIN && Deno.env.get('ALLOW_LOCAL_ORIGIN') === 'true');

  return {
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
    ...(allowed && { 'Access-Control-Allow-Origin': origin })
  };
};

Deno.serve(async (request) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors(request), 'content-type': 'application/json' }
    });
  // The real error goes to the log; the answer stays generic
  const failed = (where: string, detail: unknown) => {
    // eslint-disable-next-line no-console -- the function's log in Supabase
    console.error(`${where}:`, detail);

    return json({ error: 'Something went wrong. Try again later.' }, 500);
  };

  if (request.method === 'OPTIONS')
    return new Response('ok', { headers: cors(request) });

  if (request.method !== 'POST')
    return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authorization = request.headers.get('authorization') ?? '';

  if (!authorization.startsWith('Bearer '))
    return json({ error: 'Unauthorized' }, 401);

  // Whose account: the caller's token, checked by Auth
  const caller = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, authorization }
  });

  if (!caller.ok) return json({ error: 'Unauthorized' }, 401);

  const { id } = (await caller.json()) as { id: string };
  const admin = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    'content-type': 'application/json'
  };
  // The account's published links; 3 at most, so one page is all of them
  const listed = await fetch(`${url}/storage/v1/object/list/tokens`, {
    method: 'POST',
    headers: admin,
    body: JSON.stringify({ prefix: id, limit: 1000, offset: 0 })
  });

  if (!listed.ok) return failed('list', await listed.text());

  const prefixes = ((await listed.json()) as { name: string }[]).map(
    ({ name }) => `${id}/${name}`
  );

  if (prefixes.length > 0) {
    const removed = await fetch(`${url}/storage/v1/object/tokens`, {
      method: 'DELETE',
      headers: admin,
      body: JSON.stringify({ prefixes })
    });

    if (!removed.ok) return failed('remove', await removed.text());
  }

  const deleted = await fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: admin
  });

  if (!deleted.ok) return failed('delete user', await deleted.text());

  return json({ deleted: prefixes.length });
});
