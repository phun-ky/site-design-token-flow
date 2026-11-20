import { expect, test } from '@playwright/test';

import { publicUrl } from '../src/app/published-links';

import { signIn, user } from './session';
import { mockStorage, type StoredFile } from './storage';

// Links published on another device (#146): opened here as documents that
// still update the link, and a link changed elsewhere isn't overwritten
// without asking. Supabase Storage is mocked.
const PATH = `${user.id}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json`;
const RED = {
  $metadata: { tokenSetOrder: ['global'] },
  global: { color: { red: { value: '#ff0000', type: 'color' } } }
};
const blue = { colorSpace: 'srgb', components: [0, 0.33, 0.94] };
const BLUE = JSON.stringify({
  color: { $type: 'color', blue: { $value: blue } }
});
const pills = '#groups .design-token';
const published = () =>
  new Map<string, StoredFile>([[PATH, { body: RED, name: 'Brand' }]]);

test.beforeEach(async ({ page }) => {
  await page.goto('');
  await page.evaluate(() => localStorage.removeItem('dtf-demo'));
});

test('opens a link published on another device, still linked', async ({
  page
}) => {
  await signIn(page);

  const { uploads, blocked } = await mockStorage(page, { files: published() });

  await page.goto('playground');

  const elsewhere = page.getByRole('region', {
    name: 'Published, not in this browser'
  });

  await expect(elsewhere).toContainText('Brand');
  await elsewhere.getByRole('button', { name: 'Open Brand' }).click();

  await expect(page.getByRole('radio', { name: /^Brand/ })).toBeChecked();
  await expect(page.locator(pills)).toHaveCount(1);
  await expect(page.locator('#source')).toHaveValue(/"red"/);
  await expect(page.locator('#link-url')).toHaveValue(publicUrl(PATH));
  await expect(elsewhere).toBeHidden();

  // Edits update the same link
  await page
    .locator('#source')
    .fill((await page.locator('#source').inputValue()).replace('red', 'rose'));
  await expect.poll(() => uploads.length, { timeout: 5000 }).toBe(1);
  expect(uploads[0].path).toBe(PATH);
  expect(blocked).toEqual([]);
});

test('lists nothing when signed out', async ({ page }) => {
  await mockStorage(page, { files: published() });
  await page.goto('playground');

  await expect(
    page.getByRole('region', { name: 'Published, not in this browser' })
  ).toBeHidden();
});

for (const choice of ['Use the published version', 'Keep this version'])
  test(`asks when a link changed elsewhere: ${choice}`, async ({ page }) => {
    await signIn(page);
    await page.addInitScript(
      ({ custom, link }) =>
        localStorage.setItem(
          'dtf-demo',
          JSON.stringify({
            preset: 'custom',
            current: 'a',
            documents: [{ id: 'a', name: 'Brand', custom, valid: custom, link }]
          })
        ),
      { custom: BLUE, link: PATH }
    );

    const { uploads } = await mockStorage(page, { files: published() });

    await page.goto('playground');

    const conflict = page.locator('#link-conflict');

    await expect(conflict).toBeVisible();
    // Nothing is uploaded while you choose, not even after an edit
    await page.locator('#source').fill(BLUE.replace('blue', 'navy'));
    await page.waitForTimeout(2500);
    expect(uploads).toEqual([]);

    await conflict.getByRole('button', { name: choice }).click();
    await expect(conflict).toBeHidden();

    if (choice === 'Use the published version') {
      await expect(page.locator('#source')).toHaveValue(/"red"/);
    } else {
      await expect.poll(() => uploads.length).toBe(1);
      expect(JSON.stringify(uploads[0].body)).toContain('navy');
    }
  });
