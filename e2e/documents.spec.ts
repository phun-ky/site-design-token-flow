import { expect, test } from '@playwright/test';

// Several token documents in the playground (#149): each an option under
// "Start from", kept in this browser, the current one drawn in the flow view
const blue = { colorSpace: 'srgb', components: [0, 0.33, 0.94] };
const BRAND = {
  color: { $type: 'color', blue: { $value: blue } }
};
const PRODUCT = {
  color: {
    $type: 'color',
    blue: { $value: blue },
    cta: { $value: '{color.blue}' }
  }
};
const pills = '#groups .design-token';

test.beforeEach(async ({ page }) => {
  await page.goto('');
  await page.evaluate(() => localStorage.removeItem('dtf-demo'));
  await page.goto('playground');
});

test('keeps tokens saved before documents as "Your tokens"', async ({
  page
}) => {
  await page.evaluate(
    (custom) =>
      localStorage.setItem(
        'dtf-demo',
        JSON.stringify({ preset: 'custom', custom })
      ),
    JSON.stringify(BRAND)
  );
  await page.reload();

  await expect(page.getByRole('radio', { name: /^Your tokens/ })).toBeChecked();
  await expect(page.locator(pills)).toHaveCount(1);
});

test('adds, renames and switches documents, and keeps them', async ({
  page
}) => {
  await page.locator('#source').fill(JSON.stringify(BRAND));
  await expect(page.locator(pills)).toHaveCount(1);

  await page.getByRole('button', { name: 'New document' }).click();

  const name = page.getByLabel('Document name');

  // A new document starts empty, named, with its name ready to change
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('Your tokens 2');
  await expect(page.locator('#source')).toHaveValue('{}');
  await name.fill('Product');
  await name.press('Enter');
  await name.blur();
  await page.locator('#source').fill(JSON.stringify(PRODUCT));
  await expect(page.locator(pills)).toHaveCount(2);

  await page.getByRole('radio', { name: /^Your tokens/ }).check();
  await expect(page.locator(pills)).toHaveCount(1);
  await expect(name).toHaveValue('Your tokens');

  await page.getByRole('radio', { name: /^Product/ }).check();
  await page.reload();
  await expect(page.getByRole('radio', { name: /^Product/ })).toBeChecked();
  await expect(page.locator(pills)).toHaveCount(2);

  // The flow view shows the current document, by its name
  await page.goto('');
  await expect(page.locator('#tokens-showing [aria-current]')).toContainText(
    'Product'
  );
});

test('asks before deleting a document with tokens', async ({ page }) => {
  await page.locator('#source').fill(JSON.stringify(BRAND));
  await page.getByRole('button', { name: 'New document' }).click();
  await page.locator('#source').fill(JSON.stringify(PRODUCT));
  await expect(page.locator(pills)).toHaveCount(2);

  const dialog = page.getByRole('dialog', { name: /^Delete/ });

  await page.getByRole('button', { name: 'Delete document' }).click();
  await expect(dialog).toContainText('"Your tokens 2"');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(
    page.getByRole('radio', { name: /^Your tokens 2/ })
  ).toBeChecked();

  await page.getByRole('button', { name: 'Delete document' }).click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('radio', { name: /^Your tokens 2/ })).toHaveCount(
    0
  );
  await expect(page.getByRole('radio', { name: /^Your tokens/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: /^Your tokens/ })).toBeFocused();
  await expect(page.locator(pills)).toHaveCount(1);
});

test('deletes an empty document without asking', async ({ page }) => {
  await page.getByRole('button', { name: 'New document' }).click();
  await page.getByRole('button', { name: 'Delete document' }).click();

  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('radio', { name: /^Your tokens 2/ })).toHaveCount(
    0
  );
});

test('moves between documents with the arrow keys, like the presets', async ({
  page
}) => {
  await page.getByRole('button', { name: 'New document' }).click();
  await page.getByRole('radio', { name: /^Your tokens 2/ }).focus();
  await page.keyboard.press('ArrowUp');

  await expect(
    page.getByRole('radio', { name: /^Your tokens/ }).first()
  ).toBeFocused();
  await expect(
    page.getByRole('radio', { name: /^Your tokens/ }).first()
  ).toBeChecked();
});
