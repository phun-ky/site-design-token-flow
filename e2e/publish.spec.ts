import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { publicUrl } from '../src/app/published-links';
import { SUPABASE_URL } from '../src/app/supabase';

import { fulfill, signIn, user } from './session';

// Links for Tokens Studio (#145) against the built site, with Supabase
// Storage mocked. The Content Security Policy still applies.
const blue = { colorSpace: 'srgb', components: [0, 0.33, 0.94] };
const TOKENS = { color: { $type: 'color', blue: { $value: blue } } };
const MORE = {
  color: {
    $type: 'color',
    blue: { $value: blue },
    cta: { $value: '{color.blue}' }
  }
};
const LINK = new RegExp(`^${user.id}/[0-9a-f-]{36}\\.json$`);
/** Storage that records uploads and deletes; `links` is how many exist */
const mockStorage = async (page: Page, { links = 0, refuse = false } = {}) => {
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

      if (request.method() === 'OPTIONS') return fulfill(route, {});

      if (path === 'list/tokens')
        return fulfill(
          route,
          Array.from({ length: links }, (_, n) => ({ name: `${n}.json` }))
        );

      if (request.method() === 'DELETE') {
        deletes.push(
          ...(request.postDataJSON() as { prefixes: string[] }).prefixes
        );

        return fulfill(route, []);
      }

      if (refuse)
        return fulfill(
          route,
          { message: 'new row violates row-level security policy' },
          403
        );

      uploads.push({
        path: path.replace(/^tokens\//, ''),
        body: request.postDataJSON()
      });

      return fulfill(route, { Key: path });
    }
  );

  return { uploads, deletes, blocked };
};
/** Your tokens, typed into the playground */
const edit = async (page: Page, tokens: unknown) => {
  await page.locator('#source').fill(JSON.stringify(tokens, null, 2));
  await expect(page.locator('#link-hint')).not.toHaveText(/without problems/);
};
const publish = async (page: Page) => {
  await page.getByRole('button', { name: 'Publish link' }).click();
  await expect(page.locator('#link-status')).toContainText('Published');
};

test.beforeEach(async ({ page }) => {
  await page.goto('');
  await page.evaluate(() => localStorage.removeItem('dtf-demo'));
});

test('asks you to sign in to publish', async ({ page }) => {
  await page.goto('playground');
  await page.getByRole('radio', { name: /^Your tokens/ }).check();

  await expect(page.locator('#link-hint')).toHaveText(/^Sign in to publish/);
  await expect(page.getByRole('button', { name: 'Publish link' })).toBeHidden();
});

test('publishes Tokens Studio JSON, and copies the link', async ({
  page,
  context
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page);

  const { uploads, blocked } = await mockStorage(page);

  await page.goto('playground');
  await edit(page, TOKENS);
  await publish(page);

  expect(uploads).toHaveLength(1);
  expect(uploads[0].path).toMatch(LINK);
  // Tokens Studio's format: sets, and their order
  expect(uploads[0].body).toMatchObject({
    $metadata: { tokenSetOrder: ['global'] },
    global: { color: { blue: { type: 'color' } } }
  });

  const url = publicUrl(uploads[0].path);

  await expect(page.locator('#link-url')).toHaveValue(url);
  await page.getByRole('button', { name: 'Copy link' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  // Kept over a reload
  await page.reload();
  await expect(page.locator('#link-url')).toHaveValue(url);
  expect(blocked).toEqual([]);
});

test('updates the link after edits without problems, not with problems', async ({
  page
}) => {
  await signIn(page);

  const { uploads } = await mockStorage(page);

  await page.goto('playground');
  await edit(page, TOKENS);
  await publish(page);
  await edit(page, MORE);

  await expect.poll(() => uploads.length, { timeout: 5000 }).toBe(2);
  expect(uploads[1].path).toBe(uploads[0].path);
  expect(JSON.stringify(uploads[1].body)).toContain('cta');

  await page.locator('#source').fill('{ "color": ');
  await page.waitForTimeout(3000);
  expect(uploads).toHaveLength(2);
});

test('says when the limit is reached, and publishes nothing', async ({
  page
}) => {
  await signIn(page);

  const { uploads } = await mockStorage(page, { links: 3 });

  await page.goto('playground');
  await edit(page, TOKENS);
  await page.getByRole('button', { name: 'Publish link' }).click();

  await expect(page.locator('#link-status')).toHaveText(
    'Not published: 3 links is the limit for now'
  );
  expect(uploads).toEqual([]);
});

test('says why an upload was refused, and keeps your tokens', async ({
  page
}) => {
  await signIn(page);
  await mockStorage(page, { refuse: true });
  await page.goto('playground');
  await edit(page, TOKENS);
  await page.getByRole('button', { name: 'Publish link' }).click();

  await expect(page.locator('#link-status')).toHaveText(
    'Not published: new row violates row-level security policy'
  );
  await page.reload();
  await expect(page.locator('#source')).toHaveValue(/"blue"/);
});

test('changes the link, unpublishing the old one first', async ({ page }) => {
  await signIn(page);

  const { uploads, deletes } = await mockStorage(page);

  await page.goto('playground');
  await edit(page, TOKENS);
  await publish(page);
  await page.getByRole('button', { name: 'Change link' }).click();

  await expect.poll(() => uploads.length).toBe(2);
  expect(deletes).toEqual([uploads[0].path]);
  expect(uploads[1].path).not.toBe(uploads[0].path);
  await expect(page.locator('#link-url')).toHaveValue(
    publicUrl(uploads[1].path)
  );
});

test('unpublishes the link', async ({ page }) => {
  await signIn(page);

  const { uploads, deletes } = await mockStorage(page);

  await page.goto('playground');
  await edit(page, TOKENS);
  await publish(page);
  await page.getByRole('button', { name: 'Unpublish' }).click();

  await expect(page.locator('#link-status')).toHaveText(
    'Unpublished: the link no longer works'
  );
  expect(deletes).toEqual([uploads[0].path]);
  await expect(page.locator('#link-url')).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Publish link' })
  ).toBeVisible();
});

test('unpublishes the link of a document when deleting it', async ({
  page
}) => {
  await signIn(page);

  const { uploads, deletes } = await mockStorage(page);

  await page.goto('playground');
  await edit(page, TOKENS);
  await publish(page);
  await page.getByRole('button', { name: 'Delete document' }).click();

  const dialog = page.getByRole('dialog', { name: /^Delete/ });

  await expect(
    dialog.getByRole('checkbox', { name: /Unpublish its link/ })
  ).toBeChecked();
  await dialog.getByRole('button', { name: 'Delete' }).click();

  await expect.poll(() => deletes).toEqual([uploads[0].path]);
  await expect(page.locator('#link-url')).toBeHidden();
});

test('has no axe violations with a link published', async ({ page }) => {
  await signIn(page);
  await mockStorage(page);
  await page.goto('playground');
  await edit(page, TOKENS);
  await publish(page);

  const { violations } = await new AxeBuilder({ page })
    .include('#document')
    .withTags([
      'wcag2a',
      'wcag2aa',
      'wcag21a',
      'wcag21aa',
      'wcag22a',
      'wcag22aa',
      'best-practice'
    ])
    .analyze();

  expect(violations).toEqual([]);
});
