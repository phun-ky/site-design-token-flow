import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { publicUrl } from '../src/app/published-links';

import { signIn, user } from './session';
import { mockStorage } from './storage';

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

test('unpublishes the link of a deleted document once undo has passed', async ({
  page
}) => {
  await signIn(page);
  await page.clock.install();

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

  // The link keeps working while the delete can be undone (#156)
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  expect(deletes).toEqual([]);
  await page.clock.fastForward(10_000);

  await expect.poll(() => deletes).toEqual([uploads[0].path]);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeHidden();
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
