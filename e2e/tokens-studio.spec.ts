import { expect, test, type Page } from '@playwright/test';

import { readFileSync } from 'node:fs';

// Tokens Studio files in, DTCG and Tokens Studio out, and new tokens from the
// form (#113 to #117). A file modelled on the plugin's schemas: two sets, two
// themes, math, a modifier and a type DTCG has no equivalent for
const STUDIO = {
  core: {
    color: {
      type: 'color',
      red: { value: '#c14242' },
      blue: { value: '#3366cc' }
    },
    space: { base: { value: '8', type: 'spacing' } }
  },
  light: {
    accent: { value: '{color.blue}', type: 'color' },
    gap: { value: '{space.base} * 2', type: 'spacing' },
    soft: {
      value: '{color.red}',
      type: 'color',
      $extensions: {
        'studio.tokens': {
          modify: { type: 'lighten', value: '0.2', space: 'srgb' }
        }
      }
    },
    stack: { value: { padding: '{space.base}' }, type: 'composition' }
  },
  dark: { accent: { value: '{color.red}', type: 'color' } },
  $themes: [
    {
      id: 'light',
      name: 'Light',
      selectedTokenSets: { core: 'source', light: 'enabled', dark: 'disabled' }
    },
    {
      id: 'dark',
      name: 'Dark',
      selectedTokenSets: { core: 'source', dark: 'enabled', light: 'disabled' }
    }
  ],
  $metadata: { tokenSetOrder: ['core', 'light', 'dark'] }
};
const FILE = {
  name: 'tokens.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(STUDIO, null, 2))
};
const pills = '#groups .design-token';
const wizard = (page: Page) => page.getByRole('dialog', { name: /^Import/ });
/** Loads the Tokens Studio file through the wizard, with a theme */
const importStudio = async (page: Page, theme = 'Light') => {
  await page.locator('#file').setInputFiles(FILE);
  await expect(wizard(page)).toContainText(
    'A Tokens Studio file with 3 token sets and 2 themes, written with value and type.'
  );
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Start from a theme').selectOption({ label: theme });
};

test.beforeEach(async ({ page }) => {
  await page.goto('playground');
  await page.evaluate(() => localStorage.removeItem('dtf-demo'));
  await page.reload();
  await page.waitForLoadState('networkidle');
});

test('converts a Tokens Studio file with the theme and sets you choose', async ({
  page
}) => {
  await importStudio(page);

  const counts = page.locator('.demo-wizard-counts');

  // Light: core and light; the composition token is left out
  await expect(counts).toContainText('Tokens to load6');
  await expect(counts).toContainText('Left out1');
  await expect(page.getByLabel('Use of the set dark')).toHaveValue('left-out');

  // Dark instead: core and dark
  await page.getByLabel('Start from a theme').selectOption({ label: 'Dark' });
  await expect(counts).toContainText('Tokens to load4');

  // A set's use changes the counts too
  await page.getByLabel('Use of the set core').selectOption('reference');
  await expect(counts).toContainText('Tokens to load1');
  await page.getByLabel('Start from a theme').selectOption({ label: 'Light' });

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(wizard(page)).toContainText(
    '6 tokens from tokens.json, theme “Light”.'
  );
  await page.getByText('Math worked out (1)').click();
  await expect(wizard(page)).toContainText('gap {space.base} * 2 → 16');
  await page.getByText('Left out (1)').click();
  await expect(wizard(page)).toContainText(
    'stack Type "composition" has no DTCG equivalent'
  );
  await page.getByRole('button', { name: 'Load 6 tokens' }).click();

  await expect(wizard(page)).toBeHidden();
  await expect(page.locator(pills)).toHaveCount(6);
  await expect(page.locator('#file-status')).toContainText(
    'Loaded 6 tokens from "tokens.json", converted from Tokens Studio'
  );
  await expect(page.locator('#color-blue')).toContainText('#3366cc');
  // #c14242 lightened by 0.2 in sRGB
  await expect(page.locator('#soft')).toContainText('#cd6868');

  // The flow draws them, with the alias's line
  await page.getByRole('link', { name: 'Show in the flow' }).click();
  await expect(page.locator('.container .design-token')).toHaveCount(6);
  await expect(page.locator('.container .dtf-line')).toHaveCount(1);
});

test('cancels the wizard without loading anything', async ({ page }) => {
  await importStudio(page);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(wizard(page)).toBeHidden();
  await expect(page.locator('#file-status')).toHaveText(
    'Kept your tokens. "tokens.json" was not loaded.'
  );
  await expect(page.getByRole('radio', { name: /^Showcase/ })).toBeChecked();
});

test('exports Tokens Studio JSON that gives the file back, and DTCG', async ({
  page
}) => {
  await importStudio(page);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Load 6 tokens' }).click();
  await expect(page.locator(pills)).toHaveCount(6);

  await page.getByRole('button', { name: 'Export' }).click();

  const exportDialog = page.getByRole('dialog', { name: 'Export your tokens' });

  await page.getByRole('radio', { name: /^Tokens Studio/ }).check();
  await expect(page.locator('#export-set')).toHaveValue('light');

  const studio = page.waitForEvent('download');

  await page.getByRole('button', { name: 'Download tokens.json' }).click();

  const studioFile = await studio;

  expect(studioFile.suggestedFilename()).toBe('tokens.json');
  // As it came: sets, themes, math, the modifier and the composition token
  expect(JSON.parse(readFileSync(await studioFile.path(), 'utf8'))).toEqual(
    STUDIO
  );

  await page.getByRole('radio', { name: /^DTCG 2025.10/ }).check();

  const dtcg = page.waitForEvent('download');

  await page
    .getByRole('button', { name: 'Download design-tokens.tokens.json' })
    .click();

  const dtcgFile = JSON.parse(readFileSync(await (await dtcg).path(), 'utf8'));

  expect(dtcgFile.gap.$value).toEqual({ value: 16, unit: 'px' });
  expect(dtcgFile.accent.$value).toBe('{color.blue}');
  await page.keyboard.press('Escape');
  await expect(exportDialog).toBeHidden();
});

test('adds a primitive and a semantic token with the form', async ({
  page
}) => {
  await page.getByRole('radio', { name: /^Your tokens/ }).check();
  await page.locator('#source').fill(
    JSON.stringify({
      color: {
        $type: 'color',
        red: { $value: { colorSpace: 'srgb', components: [0.8, 0.2, 0.2] } }
      }
    })
  );
  await expect(page.locator(pills)).toHaveCount(1);

  const form = page.getByRole('complementary', { name: 'New token' });

  // A primitive: a dimension in a new group
  await page.getByRole('button', { name: 'New token' }).click();
  await expect(form).toBeVisible();
  await page.getByLabel('Group').fill('space');
  await page.getByLabel('Name', { exact: true }).fill('gap');
  await page.getByLabel('Type', { exact: true }).selectOption('dimension');
  await page.getByLabel('Value', { exact: true }).fill('12');
  await expect(page.locator('#new-preview-pill')).toContainText('$space-gap');
  await page.getByRole('button', { name: 'Add token' }).click();
  await expect(form).toBeHidden();
  await expect(page.locator(pills)).toHaveCount(2);
  await expect(page.locator('#details h2')).toHaveText('space.gap');

  // A semantic token: refers to color.red
  await page.getByRole('button', { name: 'New token' }).click();
  await page.getByRole('radio', { name: /^Semantic/ }).check();
  await page.getByLabel('Group').fill('color');
  await page.getByLabel('Name', { exact: true }).fill('danger');
  await page.getByLabel('Description, optional').fill('Errors');
  await page.getByRole('radio', { name: /^color\.red/ }).check();
  await expect(page.locator('#new-preview-json')).toContainText(
    '"$value": "{color.red}"'
  );
  await page.getByRole('button', { name: 'Add token' }).click();
  await expect(page.locator(pills)).toHaveCount(3);

  // Saved, and drawn in the flow with its line
  await page.reload();
  await expect(page.locator(pills)).toHaveCount(3);
  expect(
    JSON.parse(await page.locator('#source').inputValue()).color.danger
  ).toEqual({
    $type: 'color',
    $value: '{color.red}',
    $description: 'Errors'
  });
  await page.getByRole('link', { name: 'Show in the flow' }).click();
  await expect(page.locator('.container .dtf-line')).toHaveCount(1);
});

test('refuses a bad name, and says when a token will be replaced', async ({
  page
}) => {
  await page.getByRole('radio', { name: /^Your tokens/ }).check();
  await page
    .locator('#source')
    .fill(
      JSON.stringify({ size: { $type: 'number', ratio: { $value: 1.5 } } })
    );
  await expect(page.locator(pills)).toHaveCount(1);
  await page.getByRole('button', { name: 'New token' }).click();
  await page.getByLabel('Name', { exact: true }).fill('{bad}');
  await page.getByRole('button', { name: 'Add token' }).click();
  await expect(page.locator('#new-problem')).toContainText('be used: names');

  await page.getByLabel('Group').fill('size');
  await page.getByLabel('Name', { exact: true }).fill('ratio');
  await expect(page.locator('#new-name-hint')).toHaveText(
    'A token with this name exists: adding replaces it.'
  );

  // Esc closes the form and keeps your tokens
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('complementary', { name: 'New token' })
  ).toBeHidden();
  await expect(page.locator(pills)).toHaveCount(1);
});
