import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { PAGES, THEMES, useTheme } from './site';

// WCAG 2.0, 2.1 and 2.2 at A and AA, plus axe's best practices, as checked by
// hand in #73
const TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22a',
  'wcag22aa',
  'best-practice'
];
/** Each page, and the states of it that show more than it opens with */
const STATES: {
  name: string;
  path: string;
  prepare?: (page: Page) => Promise<void>;
}[] = [
  ...PAGES.map(({ name, path }) => ({ name, path })),
  {
    name: 'playground with a pill selected',
    path: 'playground',
    prepare: async (page) => {
      await page.locator('[data-demo-id="shadow-raised"]').click();
      await expect(page.locator('#details pre.shiki').first()).toBeVisible();
    }
  },
  {
    name: 'playground with problems and the import wizard on its sets',
    path: 'playground',
    prepare: async (page) => {
      await page
        .locator('#source')
        .fill('{ "color": { "$type": "color", "a": { "$value": "{nope}" } } }');
      await expect(page.locator('#error li')).toHaveCount(1);
      await page.locator('#file').setInputFiles({
        name: 'tokens.json',
        mimeType: 'application/json',
        buffer: Buffer.from(
          JSON.stringify({
            core: { red: { value: '#c14242', type: 'color' } },
            light: { accent: { value: '{red}', type: 'color' } },
            $themes: [
              {
                id: 'light',
                name: 'Light',
                selectedTokenSets: { core: 'source', light: 'enabled' }
              }
            ],
            $metadata: { tokenSetOrder: ['core', 'light'] }
          })
        )
      });
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(page.locator('.demo-sets')).toBeVisible();
    }
  },
  {
    name: 'playground with the export dialog open',
    path: 'playground',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Export' }).click();
      await page.getByRole('radio', { name: /^Tokens Studio/ }).check();
      await expect(page.locator('#export-preview')).toContainText('$metadata');
    }
  },
  {
    name: 'playground with the new token form open',
    path: 'playground',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'New token' }).click();
      await page.getByLabel('Name', { exact: true }).fill('accent');
      await expect(
        page.locator('#new-preview-pill .design-token')
      ).toBeVisible();
    }
  },
  {
    name: 'flow with the sidebar collapsed',
    path: '',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Sidebar' }).click();
      await expect(page.locator('#flow-sidebar')).toHaveCSS('width', '48px');
    }
  },
  {
    name: 'playground with the sidebar collapsed and problems',
    path: 'playground',
    prepare: async (page) => {
      await page
        .locator('#source')
        .fill('{ "color": { "$type": "color", "a": { "$value": "{nope}" } } }');
      await expect(page.locator('#error li')).toHaveCount(1);
      await page.getByRole('button', { name: 'Sidebar' }).click();
      await expect(page.locator('#playground-sidebar')).toHaveCSS(
        'width',
        '48px'
      );
    }
  },
  {
    name: 'flow with the sidebar open on a phone',
    path: '',
    prepare: async (page) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: 'About this flow' }).click();
      await expect(page.locator('#tokens-showing li').first()).toBeVisible();
    }
  }
];

for (const { name, path, prepare } of STATES) {
  for (const theme of THEMES) {
    test(`${name}, ${theme}: no axe violations`, async ({ page }, info) => {
      await useTheme(page, theme);
      // No transitions, so colours are checked as they end up, not halfway
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.ready);
      await prepare?.(page);

      const { violations, incomplete } = await new AxeBuilder({ page })
        .withTags(TAGS)
        .analyze();

      // axe can't decide some checks, such as contrast over the dotted
      // background; they are listed with the result for a person to look at
      if (incomplete.length > 0) {
        await info.attach('axe incomplete', {
          body: JSON.stringify(
            incomplete.map(({ id, nodes }) => ({
              id,
              targets: nodes.map(({ target }) => target.join(' '))
            })),
            null,
            2
          ),
          contentType: 'application/json'
        });
      }

      expect(
        violations.map(
          ({ id, help, nodes }) =>
            `${id}: ${help} (${nodes.map(({ target }) => target.join(' ')).join(', ')})`
        ),
        'axe violations'
      ).toEqual([]);
    });
  }
}
