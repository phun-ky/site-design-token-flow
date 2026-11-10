import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('playground');
  await page.evaluate(() => localStorage.removeItem('dtf-demo'));
  await page.reload();
  await page.waitForLoadState('networkidle');
});

const pills = '#groups .design-token';

test('shows the showcase tokens, highlighted', async ({ page }) => {
  await expect(page.locator('h1')).toHaveText('Playground');
  await expect(page.getByLabel('Showcase')).toBeChecked();
  await expect(page.locator(pills)).toHaveCount(42);
  await expect(page.locator('.demo-source')).toHaveClass(/is-highlighted/);
});

test('selects a pill with the mouse or the keyboard', async ({ page }) => {
  await page.locator('[data-demo-id="color-palette-coral"]').click();
  await expect(page.locator('#details h2')).toHaveText('color.palette.coral');
  await expect(page.locator('#details pre.shiki').first()).toBeVisible();

  await page.locator('[data-demo-id="shadow-raised"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#details h2')).toHaveText('shadow.raised');
  // Pretty printed: the pill and its children on separate lines
  expect(
    (await page.locator('pre.demo-html').textContent())?.split('\n').length
  ).toBeGreaterThan(3);
});

test('copies the rendered HTML as one line', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('[data-demo-id="shadow-raised"]').click();
  await page.locator('#copy').click();
  await expect(page.locator('#copy')).toHaveText('copied');

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const rendered = await page
    .locator('[data-demo-id="shadow-raised"]')
    .evaluate((element) => {
      const copy = element.cloneNode(true) as HTMLElement;

      // The playground adds these for selection and focus
      copy.classList.remove('is-selected', 'is-related');
      copy.removeAttribute('tabindex');
      copy.removeAttribute('data-demo-id');
      copy.querySelector('code')?.style.removeProperty('inline-size');

      if (!copy.querySelector('code')?.getAttribute('style'))
        copy.querySelector('code')?.removeAttribute('style');

      return copy.outerHTML;
    });

  expect(copied).not.toContain('\n');
  expect(copied).toBe(rendered);
});

test('filters, switches to the bundled tokens and reports invalid JSON', async ({
  page
}) => {
  await page.locator('#filter').fill('shadow');
  await expect(page.locator(pills)).toHaveCount(2);
  await page.locator('#filter').fill('');

  await page.getByLabel('Example file').check();
  await expect(page.locator(pills)).toHaveCount(201);
  await expect(
    page.locator('label', { hasText: 'Example file' })
  ).toContainText('201 tokens');

  await page.locator('#source').fill(
    JSON.stringify({
      size: { $type: 'dimension', r: { $value: { value: '1px', unit: 'px' } } }
    })
  );
  await expect(page.locator('#error')).toContainText(
    'Invalid token "size.r" (dimension): $value.value must be a number'
  );
  await expect(page.locator(pills)).toHaveCount(0);

  await page.locator('#source').fill(
    JSON.stringify({
      size: { $type: 'dimension', r: { $value: { value: 1, unit: 'px' } } }
    })
  );
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator(pills)).toHaveCount(1);
});

test('lists every problem in the tokens, and shows the valid ones', async ({
  page
}) => {
  await page.locator('#source').fill(
    JSON.stringify({
      color: {
        $type: 'color',
        blue: { $value: { colorSpace: 'srgb', components: [0, 0.33, 0.94] } },
        accent: { $value: '{color.blu}' }
      },
      size: { $type: 'dimension', r: { $value: { value: '1px', unit: 'px' } } }
    })
  );

  const problems = page.locator('#error li');

  await expect(page.locator('#error [role="alert"]')).toHaveText(
    '2 problems in the tokens'
  );
  // Each with its line, which a click moves the editor to
  await expect(problems).toHaveText([
    'Line 1Unresolvable reference "{color.blu}" in "color.accent"',
    'Line 1Invalid token "size.r" (dimension): $value.value must be a number, got "1px"'
  ]);
  await expect(page.locator(pills)).toHaveCount(1);

  await page.locator('#source').fill('{ "color": ');
  await expect(problems).toHaveCount(1);
  await expect(page.locator('#to-flow')).toBeHidden();
  await expect(page.locator('#error [role="alert"]')).toHaveText(
    '1 problem in the tokens'
  );
  await expect(page.locator(pills)).toHaveCount(0);
});

test('keeps the editor to part of the screen on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForLoadState('networkidle');

  const layout = await page.evaluate(() => {
    const editor = document.querySelector('#source') as HTMLTextAreaElement;

    return {
      editor: editor.getBoundingClientRect().height,
      scrolls: editor.scrollHeight > editor.clientHeight,
      // From the editor: the sidebar comes first on a phone
      firstPill:
        (
          document.querySelector('#groups .design-token') as HTMLElement
        ).getBoundingClientRect().top - editor.getBoundingClientRect().top
    };
  });

  // The showcase is far longer than the editor, which scrolls instead
  expect(layout.editor).toBeLessThanOrEqual(844 * 0.6);
  expect(layout.scrolls).toBe(true);
  expect(layout.firstPill).toBeLessThan(844);
});

test('shows the details after a selection on a phone, and goes back', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await page.waitForLoadState('networkidle');

  const pill = page.locator('[data-demo-id="shadow-raised"]');

  await pill.scrollIntoViewIfNeeded();
  await pill.click();
  await expect(page.locator('#details h2')).toBeFocused();
  await expect(page.locator('#details h2')).toBeInViewport();

  // The details cover the page; closing them returns to the pill
  await page.getByRole('button', { name: 'Close the details' }).click();
  await expect(page.locator('#details')).toBeHidden();
  await expect(pill).toBeFocused();
  await expect(pill).toBeInViewport();

  // Esc closes them too
  await pill.press('Enter');
  await expect(page.locator('#details h2')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#details')).toBeHidden();
  await expect(pill).toBeFocused();
});

test('shows the details next to the pills on a wide screen, covering none', async ({
  page
}) => {
  await expect(page.locator('#details')).toBeHidden();

  const pill = page.locator('[data-demo-id="shadow-raised"]');

  await pill.click();
  await expect(page.locator('#details h2')).toHaveText('shadow.raised');
  // A column of their own: the pills are all still in view, none under them
  await expect(pill).toBeInViewport();

  const overlap = await page.evaluate(() => {
    const details = (
      document.querySelector('#details') as HTMLElement
    ).getBoundingClientRect();

    return [...document.querySelectorAll('#groups .design-token')].some(
      (element) => {
        const box = element.getBoundingClientRect();

        return box.right > details.left && box.left < details.right;
      }
    );
  });

  expect(overlap, 'a pill under the details').toBe(false);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await page.getByRole('button', { name: 'Close the details' }).click();
  await expect(page.locator('#details')).toBeHidden();
});

test('moves the editor to the line of a problem', async ({ page }) => {
  await page.locator('#source').fill(
    JSON.stringify(
      {
        color: {
          $type: 'color',
          blue: { $value: { colorSpace: 'srgb', components: [0, 0.33, 0.94] } },
          cta: { $value: '{color.nope}' }
        }
      },
      null,
      2
    )
  );
  await page.locator('#error li button').click();
  await expect(page.locator('#source')).toBeFocused();

  const selected = await page
    .locator('#source')
    .evaluate((element: HTMLTextAreaElement) =>
      element.value.slice(element.selectionStart, element.selectionEnd)
    );

  expect(selected).toBe('    "cta": {');
});

test('collapses the sidebar to a rail, and still tells about problems', async ({
  page
}) => {
  const sidebar = page.locator('#playground-sidebar');
  const editor = page.locator('.demo-editor');
  const button = page.getByRole('button', { name: 'Sidebar' });

  await page.getByRole('radio', { name: /^Your tokens/ }).check();

  const narrow = (await editor.boundingBox())!.width;

  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(sidebar).toHaveCSS('width', '48px');
  await expect(page.getByRole('radio', { name: /^Showcase/ })).toBeHidden();
  await expect
    .poll(async () => (await editor.boundingBox())!.width)
    .toBeGreaterThan(narrow);

  // Problems: announced, and described on the button, which has a dot
  await page
    .locator('#source')
    .fill('{ "color": { "$type": "color", "a": { "$value": "{nope}" } } }');
  await expect(page.locator('#problems-title')).toHaveText(/1 problem/);
  await expect(button).toHaveAccessibleDescription(/1 problem/);
  await expect
    .poll(() =>
      button.evaluate((el) => getComputedStyle(el, '::after').content)
    )
    .toBe('""');

  await page.reload();
  await expect(sidebar).toHaveCSS('width', '48px');
  await button.click();
  await expect(page.locator('#error li')).toHaveCount(1);
});
