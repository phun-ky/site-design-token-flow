import type { Page } from '@playwright/test';

import { SUPABASE_URL } from '../src/app/supabase';

import { fulfill, user } from './session';

/** A file in the mocked bucket: its Tokens Studio JSON and name */
export interface StoredFile {
  body: unknown;
  name?: string;
}

/**
 * Supabase Storage for checks that publish and open links (#145, #146): it
 * keeps what is uploaded, lists, describes and serves it, and records uploads
 * and deletes. `links` adds that many other files to the account's folder;
 * `refuse` refuses every upload, as the policy does.
 */
export const mockStorage = async (
  page: Page,
  {
    links = 0,
    refuse = false,
    files = new Map<string, StoredFile>()
  }: { links?: number; refuse?: boolean; files?: Map<string, StoredFile> } = {}
) => {
  const uploads: { path: string; body: unknown }[] = [];
  const deletes: string[] = [];
  const blocked: string[] = [];
  const storage = `${SUPABASE_URL}/storage/v1/object/`;

  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy'))
      blocked.push(message.text());
  });
  await page.route(`${SUPABASE_URL}/auth/v1/user`, (route) =>
    fulfill(route, user)
  );
  await page.route(
    (url) => url.href.startsWith(storage),
    (route) => {
      const request = route.request();
      const path = request.url().slice(storage.length);
      const method = request.method();

      if (method === 'OPTIONS') return fulfill(route, {});

      if (path === 'list/tokens')
        return fulfill(route, [
          ...[...files.keys()].map((key) => ({
            name: key.slice(key.indexOf('/') + 1),
            updated_at: '2026-11-20T10:00:00Z'
          })),
          ...Array.from({ length: links }, (_, n) => ({ name: `${n}.json` }))
        ]);

      if (path.startsWith('info/authenticated/tokens/'))
        return fulfill(route, {
          metadata: { name: files.get(path.slice(26))?.name }
        });

      if (method === 'GET' && path.startsWith('authenticated/tokens/')) {
        const file = files.get(path.slice(21));

        return file
          ? fulfill(route, file.body)
          : fulfill(route, { message: 'Object not found' }, 400);
      }

      if (method === 'DELETE') {
        const { prefixes } = request.postDataJSON() as { prefixes: string[] };

        deletes.push(...prefixes);
        prefixes.forEach((prefix) => files.delete(prefix));

        return fulfill(route, []);
      }

      if (refuse)
        return fulfill(
          route,
          { message: 'new row violates row-level security policy' },
          403
        );

      const key = path.replace(/^tokens\//, '');
      const metadata = request.headers()['x-metadata'];
      const body = request.postDataJSON() as unknown;

      uploads.push({ path: key, body });
      files.set(key, {
        body,
        name: metadata
          ? (
              JSON.parse(Buffer.from(metadata, 'base64').toString()) as {
                name: string;
              }
            ).name
          : undefined
      });

      return fulfill(route, { Key: path });
    }
  );

  return { uploads, deletes, blocked, files };
};
