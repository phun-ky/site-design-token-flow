import { SUPABASE_KEY, SUPABASE_URL } from './supabase';

/**
 * Published links for Tokens Studio (#145): a document's Tokens Studio JSON
 * in the `tokens` bucket at `<user id>/<share id>.json`, which Tokens Studio's
 * URL sync reads. Plain `fetch` to the Storage API; the bucket's policies
 * (`supabase/migrations/`) allow only the owner to write, up to the limit.
 */

/** Links per account, as the Storage policy enforces (`public.link_limit`) */
export const LINK_LIMIT = 3;

const OBJECTS = `${SUPABASE_URL}/storage/v1/object`;

type Fetch = typeof fetch;

/**
 * Where a new link goes: a random share id in the account's folder.
 *
 * @param {string} userId The signed in account
 * @returns {string} `<user id>/<share id>.json`
 */
export const newLinkPath = (userId: string): string =>
  `${userId}/${crypto.randomUUID()}.json`;

/**
 * The address Tokens Studio reads, for anyone with it.
 *
 * @param {string} path `<user id>/<share id>.json`
 * @returns {string} The public URL
 */
export const publicUrl = (path: string): string =>
  `${OBJECTS}/public/tokens/${path}`;

const headers = (token: string) => ({
  apikey: SUPABASE_KEY,
  authorization: `Bearer ${token}`,
  'content-type': 'application/json'
});
/** The Storage API's reason for a refusal, or its status */
const reason = async (response: Response) => {
  try {
    const body = (await response.json()) as { message?: string };

    return body.message || `${response.status}`;
  } catch {
    return `${response.status}`;
  }
};

/**
 * Publishes, or updates, a link. Public URLs are cached for a minute, so
 * Tokens Studio may see an update up to a minute late.
 *
 * @param {string} token The session's access token
 * @param {string} path `<user id>/<share id>.json`
 * @param {string} json The Tokens Studio JSON
 * @param {Fetch} [request] fetch, which tests replace
 * @returns {Promise<string | null>} Why it failed, or null when published
 */
export const uploadLink = async (
  token: string,
  path: string,
  json: string,
  request: Fetch = fetch
): Promise<string | null> => {
  const response = await request(`${OBJECTS}/tokens/${path}`, {
    method: 'POST',
    headers: {
      ...headers(token),
      'cache-control': 'max-age=60',
      'x-upsert': 'true'
    },
    body: json
  });

  return response.ok ? null : reason(response);
};

/**
 * Unpublishes a link: its file is deleted, so the URL stops working.
 *
 * @param {string} token The session's access token
 * @param {string} path `<user id>/<share id>.json`
 * @param {Fetch} [request] fetch, which tests replace
 * @returns {Promise<string | null>} Why it failed, or null when deleted
 */
export const removeLink = async (
  token: string,
  path: string,
  request: Fetch = fetch
): Promise<string | null> => {
  const response = await request(`${OBJECTS}/tokens`, {
    method: 'DELETE',
    headers: headers(token),
    body: JSON.stringify({ prefixes: [path] })
  });

  return response.ok ? null : reason(response);
};

/**
 * How many links the account has published, on any device.
 *
 * @param {string} token The session's access token
 * @param {string} userId The signed in account
 * @param {Fetch} [request] fetch, which tests replace
 * @returns {Promise<number>} The number of links
 * @throws {Error} When the Storage API refuses
 */
export const countLinks = async (
  token: string,
  userId: string,
  request: Fetch = fetch
): Promise<number> => {
  const response = await request(`${OBJECTS}/list/tokens`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ prefix: userId, limit: 100, offset: 0 })
  });

  if (!response.ok) throw new Error(await reason(response));

  const files = (await response.json()) as { name: string }[];

  return files.filter(({ name }) => name.endsWith('.json')).length;
};
