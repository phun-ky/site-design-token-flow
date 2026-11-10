import { expect, test } from '@playwright/test';

import { canvasTransform, zoomLevel } from './site';

test.beforeEach(async ({ page }) => {
  await page.goto('');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
});

test('opens at 100%, fitted to the page width, with every pill', async ({
  page
}) => {
  await expect(page.locator('h1')).toHaveText('Token flow');
  await expect(page.locator('.design-token')).toHaveCount(201);
  expect(await zoomLevel(page)).toBe(100);

  const fits = await page.evaluate(() => {
    const flow = document.querySelector('.container') as HTMLElement;
    const canvas = document.querySelector('.app-viewport') as HTMLElement;

    return (
      Math.abs(
        flow.getBoundingClientRect().width -
          canvas.getBoundingClientRect().width
      ) <= 1
    );
  });

  expect(fits).toBe(true);
});

test('zooms with the buttons, and fits to the screen', async ({ page }) => {
  await page.getByRole('button', { name: 'Zoom in' }).click();
  expect(await zoomLevel(page)).toBe(110);
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  expect(await zoomLevel(page)).toBe(90);
  await page.locator('.zoom-value').click();
  expect(await zoomLevel(page)).toBe(100);

  await page.getByRole('button', { name: 'Fit to screen' }).click();
  expect(await zoomLevel(page)).toBeLessThan(100);

  const inside = await page.evaluate(() => {
    const flow = (
      document.querySelector('.container') as HTMLElement
    ).getBoundingClientRect();
    const canvas = (
      document.querySelector('.app-viewport') as HTMLElement
    ).getBoundingClientRect();

    return (
      flow.left >= canvas.left - 1 &&
      flow.right <= canvas.right + 1 &&
      flow.top >= canvas.top - 1 &&
      flow.bottom <= canvas.bottom + 1
    );
  });

  expect(inside, 'the whole flow is on screen').toBe(true);
});

test('pans with the wheel', async ({ page }) => {
  const canvas = await page.locator('.app-viewport').boundingBox();
  const before = await canvasTransform(page);

  await page.mouse.move(canvas!.x + 500, canvas!.y + 400);
  await page.mouse.wheel(0, 300);
  await expect
    .poll(async () => (await canvasTransform(page)).y)
    .toBeLessThan(before.y);
  expect(await zoomLevel(page)).toBe(100);
  expect((await canvasTransform(page)).x).toBeCloseTo(before.x, 0);
});

test('zooms with Ctrl and the wheel around the pointer', async ({ page }) => {
  const canvas = await page.locator('.app-viewport').boundingBox();
  const pointer = { x: 500, y: 400 };
  const before = await canvasTransform(page);

  await page.mouse.move(canvas!.x + pointer.x, canvas!.y + pointer.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await expect.poll(() => zoomLevel(page)).toBeGreaterThan(100);

  const after = await canvasTransform(page);
  // The point of the flow under the pointer, before and after
  const at = (state: typeof before) => ({
    x: (pointer.x - state.x) / state.scale,
    y: (pointer.y - state.y) / state.scale
  });

  expect(at(after).x).toBeCloseTo(at(before).x, 0);
  expect(at(after).y).toBeCloseTo(at(before).y, 0);
});

test('pans by dragging', async ({ page }) => {
  const canvas = await page.locator('.app-viewport').boundingBox();
  const before = await canvasTransform(page);
  const start = { x: canvas!.x + 400, y: canvas!.y + 300 };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 200, start.y - 100, { steps: 5 });
  await page.mouse.up();

  const after = await canvasTransform(page);

  expect(after.x - before.x).toBeCloseTo(-200, 0);
  expect(after.y - before.y).toBeCloseTo(-100, 0);
  expect(after.scale).toBe(before.scale);
});

test('pans and zooms with the keyboard from the skip link', async ({
  page
}) => {
  await page.keyboard.press('Tab');
  await expect(page.locator('.app-skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#content')).toBeFocused();

  const start = await canvasTransform(page);

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');

  const panned = await canvasTransform(page);

  expect(panned.x - start.x).toBe(-40);
  expect(panned.y - start.y).toBe(-200);

  await page.keyboard.press('+');
  expect(await zoomLevel(page)).toBe(110);
  await page.keyboard.press('-');
  expect(await zoomLevel(page)).toBe(100);
  await page.keyboard.press('f');
  expect(await zoomLevel(page)).toBeLessThan(100);
  await page.keyboard.press('0');
  expect(await zoomLevel(page)).toBe(100);
});

test('switches the theme, and keeps it on reload and on the playground', async ({
  page
}) => {
  const isLight = () =>
    page.evaluate(() =>
      document.documentElement.classList.contains('theme--light')
    );
  const wasLight = await isLight();

  await page.getByRole('switch', { name: 'Dark theme' }).click();
  expect(await isLight()).toBe(!wasLight);

  await page.reload();
  expect(await isLight()).toBe(!wasLight);

  await page.getByRole('link', { name: 'Playground', exact: true }).click();
  await expect(page).toHaveURL(/\/playground$/);
  expect(await isLight()).toBe(!wasLight);
});

test('opens on the start of the flow, readable, on a phone', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);

  const first = page.locator('.flow .flow-column .design-token').first();

  // Zoomed in, at most 400%, and on screen
  expect(await zoomLevel(page)).toBeGreaterThan(100);
  expect(await zoomLevel(page)).toBeLessThanOrEqual(400);
  await expect(first).toBeInViewport();

  // 100% is still the page width
  await page.locator('.zoom-value').click();
  expect(await zoomLevel(page)).toBe(100);
  expect((await canvasTransform(page)).scale).toBeLessThan(0.5);
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });

  test('pinches with two fingers to zoom around them, and pans', async ({
    page
  }) => {
    const canvas = (await page.locator('.app-viewport').boundingBox())!;
    const middle = { x: 500, y: 400 };
    const before = await canvasTransform(page);
    const level = await zoomLevel(page);
    const cdp = await page.context().newCDPSession(page);
    /** Both fingers, `spread` apart sideways around `at`, in viewport coordinates */
    const touch = (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      spread: number,
      at = middle
    ) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints:
          type === 'touchEnd'
            ? []
            : [-1, 1].map((side, id) => ({
                id,
                x: canvas.x + at.x + (side * spread) / 2,
                y: canvas.y + at.y
              }))
      });

    // Twice the distance between the fingers: twice the zoom
    await touch('touchStart', 100);
    for (const spread of [125, 150, 175, 200]) await touch('touchMove', spread);

    const after = await canvasTransform(page);
    const at = (state: typeof before) => ({
      x: (middle.x - state.x) / state.scale,
      y: (middle.y - state.y) / state.scale
    });

    expect(after.scale / before.scale).toBeCloseTo(2, 1);
    expect(await zoomLevel(page)).toBeCloseTo(level * 2, -1);
    expect(at(after).x).toBeCloseTo(at(before).x, 0);
    expect(at(after).y).toBeCloseTo(at(before).y, 0);

    // Both fingers moving together pan
    await touch('touchMove', 200, { x: middle.x - 60, y: middle.y - 40 });

    const panned = await canvasTransform(page);

    expect(panned.x - after.x).toBeCloseTo(-60, 0);
    expect(panned.y - after.y).toBeCloseTo(-40, 0);
    expect(panned.scale).toBe(after.scale);
    await touch('touchEnd', 0);
  });
});

test('collapses the sidebar to a rail, and keeps it so on reload', async ({
  page
}) => {
  const sidebar = page.locator('#flow-sidebar');
  const viewport = page.locator('.app-viewport');
  const button = page.getByRole('button', { name: 'Sidebar' });
  const wide = (await viewport.boundingBox())!.width;

  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(sidebar).toHaveCSS('width', '48px');
  await expect(page.locator('#flow-sidebar-body')).toBeHidden();
  // Still the page's heading, off screen
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Token flow'
  );
  expect((await viewport.boundingBox())!.width).toBeGreaterThan(wide + 200);

  await page.reload();
  await expect(sidebar).toHaveCSS('width', '48px');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await expect(page.locator('#flow-sidebar-body')).toBeVisible();
  await page.reload();
  await expect(sidebar).toHaveCSS('width', '280px');
});

test('has no rail on a phone, even when left collapsed', async ({ page }) => {
  await page.getByRole('button', { name: 'Sidebar' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Sidebar' })).toBeHidden();
  await page.getByRole('button', { name: 'About this flow' }).click();
  await expect(page.locator('#tokens-showing li').first()).toBeVisible();
});
