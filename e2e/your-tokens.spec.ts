import { expect, test, type Page } from '@playwright/test';

import { largeTokens } from './large-tokens';

// Your tokens: edited in the playground, kept in this browser, drawn in the
// flow view (#101)
const blue = { colorSpace: 'srgb', components: [0, 0.33, 0.94] };
const VALID = {
  color: {
    $type: 'color',
    blue: { $value: blue },
    cta: { $value: '{color.blue}' }
  }
};
const BROKEN = {
  color: {
    $type: 'color',
    blue: { $value: blue },
    cta: { $value: '{color.nope}' }
  }
};
const pills = '.container .design-token';
const source = '#tokens-source';
/** Types tokens into the playground, as you would */
const edit = async (page: Page, tokens: unknown) => {
  await page.goto('playground');
  await page.locator('#source').fill(JSON.stringify(tokens, null, 2));
};
const showing = '#tokens-showing li';
const current = '#tokens-showing [aria-current]';

test.beforeEach(async ({ page }) => {
  await page.goto('');
  await page.evaluate(() => localStorage.removeItem('dtf-demo'));
});

test('shows the example, with a link to try your own', async ({ page }) => {
  await page.reload();
  await expect(page.locator(showing)).toHaveText(['The example201 tokens']);
  await expect(page.locator(source)).toHaveText(
    'You have no tokens of your own yet.Try your own in the playground'
  );
  await expect(page.locator(pills)).toHaveCount(201);
  await expect(page.locator('#to-flow')).toHaveCount(0);
});

test('draws your tokens from the playground, with their lines, after a reload', async ({
  page
}) => {
  await edit(page, VALID);
  await page.getByRole('link', { name: 'Show in the flow' }).click();

  await expect(page).toHaveURL(/\/site-design-token-flow\/$/);
  await expect(page.locator(current)).toHaveText(
    'Your tokens2 tokens, saved in this browser'
  );
  await expect(page.locator(showing)).toHaveCount(2);
  await expect(page.locator(pills)).toHaveCount(2);
  await expect(page.locator('.container .dtf-line')).toHaveCount(1);

  await page.reload();
  await expect(page.locator(pills)).toHaveCount(2);
  await expect(page.locator('#color-cta')).toContainText('color-cta');
});

test('keeps showing the last version without problems while you fix one', async ({
  page
}) => {
  await edit(page, VALID);
  await expect(page.locator('#to-flow')).toBeVisible();
  await page.locator('#source').fill(JSON.stringify(BROKEN, null, 2));
  await expect(page.locator('#error li')).toHaveCount(1);
  await expect(page.locator('#to-flow-hint')).toBeVisible();

  await page.goto('');
  await expect(page.locator(source)).toContainText(
    'Showing the last version of your tokens without problems: your latest edits in the playground have problems.'
  );
  await expect(page.locator(current)).toContainText('Your tokens');
  await expect(page.locator(pills)).toHaveCount(2);

  // Back in the playground, your edits are there as you left them
  await page.getByRole('link', { name: 'Fix them in the playground' }).click();
  await expect(page.locator('#source')).toHaveValue(
    JSON.stringify(BROKEN, null, 2)
  );
});

test('shows the example when your tokens have problems and none were valid', async ({
  page
}) => {
  await edit(page, BROKEN);
  await expect(page.locator('#error li')).toHaveCount(1);
  await expect(page.locator('#to-flow')).toBeHidden();

  await page.goto('');
  await expect(page.locator(source)).toHaveText(
    'Your tokens in the playground have problems, so the flow shows the example.Fix them in the playground'
  );
  await expect(page.locator(showing)).toHaveText(['The example201 tokens']);
  await expect(page.locator(pills)).toHaveCount(201);
});

test('switches between your tokens and the example, and back', async ({
  page
}) => {
  await edit(page, VALID);
  await expect(page.locator('#to-flow')).toBeVisible();
  await page.goto('');

  await page.getByRole('link', { name: /^The example/ }).click();
  await expect(page).toHaveURL(/\?tokens=example$/);
  await expect(page.locator(current)).toHaveText('The example201 tokens');
  await expect(page.locator(pills)).toHaveCount(201);

  await page.getByRole('link', { name: /^Your tokens/ }).click();
  await expect(page.locator(current)).toContainText('Your tokens');
  await expect(page.locator(pills)).toHaveCount(2);

  // Your tokens are only in this browser: clearing its storage brings the
  // example back
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator(pills)).toHaveCount(201);
});

test('folds the sidebar into a bar on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();

  const toggle = page.getByRole('button', { name: 'About this flow' });

  await expect(page.locator('#flow-title')).toBeVisible();
  await expect(page.locator(showing).first()).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(showing).first()).toBeVisible();
  await expect(page.getByText('Fit', { exact: true })).toBeVisible();
});

test('says what it draws before drawing a large flow', async ({ page }) => {
  await page.addInitScript((custom) => {
    localStorage.setItem(
      'dtf-demo',
      JSON.stringify({ preset: 'custom', custom })
    );

    const seen: string[] = [];

    (window as unknown as { statusSeen: string[] }).statusSeen = seen;
    // From the start: the status is set before the page has loaded
    new MutationObserver(() => {
      const text = document.querySelector('#flow-status')?.textContent;

      if (text !== undefined && text !== seen.at(-1)) seen.push(text ?? '');
    }).observe(document, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }, JSON.stringify(largeTokens()));
  await page.reload();
  await expect(page.locator(pills)).toHaveCount(976);
  await expect(page.locator('#flow-status')).toBeEmpty();
  expect(
    await page.evaluate(
      () => (window as unknown as { statusSeen: string[] }).statusSeen
    )
  ).toContain('Drawing 976 tokens and 826 lines');
});
