import { expect, test, type APIRequestContext } from '@playwright/test';

import { THEMES, useTheme } from './site';

// The images the pages, the README and link previews use, with their size in
// pixels. `opaque`: iOS fills a transparent Apple touch icon with black, and
// link previews do the same with a social card
const IMAGES = [
  { path: 'favicon-32.png', width: 32, height: 32 },
  { path: 'apple-touch-icon.png', width: 180, height: 180, opaque: true },
  { path: 'og-image.png', width: 1200, height: 630, opaque: true },
  { path: 'logo/banner-light.png', width: 1660, height: 480 },
  { path: 'logo/banner-dark.png', width: 1660, height: 480 }
];
const MARKS = [
  'favicon.svg',
  'logo/mark.svg',
  'logo/mark-dark.svg',
  'logo/mark-mono.svg'
];
/** A PNG's size, from its header, and whether it can be transparent */
const png = (body: Buffer) => ({
  width: body.readUInt32BE(16),
  height: body.readUInt32BE(20),
  // Colour types 4 and 6 have an alpha channel; a palette gets one from a
  // tRNS chunk
  alpha: [4, 6].includes(body[25]) || body.includes('tRNS')
});
/** The relative luminance of an sRGB colour, from WCAG 2.2 */
const luminance = ([r, g, b]: number[]) => {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const value = channel / 255;

    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
};
/** The contrast ratio of two colours, from 1 to 21 */
const contrast = (a: number[], b: number[]) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (light + 0.05) / (dark + 0.05);
};
const hex = (value: string) =>
  [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16));
/** The fill colours in an SVG, in order */
const fills = async (request: APIRequestContext, path: string) =>
  [
    ...(await (await request.get(path)).text()).matchAll(
      /fill="(#[\da-f]{6})"/gi
    )
  ].map(([, colour]) => hex(colour));

test('every icon, banner and the social card is served at its size', async ({
  request
}) => {
  for (const { path, width, height, opaque } of IMAGES) {
    const response = await request.get(path);

    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type'], path).toContain('image/png');

    const info = png(await response.body());

    expect({ path, width: info.width, height: info.height }).toEqual({
      path,
      width,
      height
    });

    if (opaque) expect(info.alpha, `${path} is opaque`).toBe(false);
  }
});

test('the marks are served as SVG, the one-colour mark in currentColor', async ({
  request
}) => {
  for (const path of MARKS) {
    const response = await request.get(path);

    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type'], path).toContain('image/svg+xml');
  }

  expect(await (await request.get('logo/mark-mono.svg')).text()).toContain(
    'fill="currentColor"'
  );
});

// WCAG 1.4.11 asks 3:1 of graphics: the wave against its tile, and each mark
// against the page background of the theme it is made for. The 16 px favicon
// is attached, on that background, to look at
for (const theme of THEMES) {
  test(`the mark reads at 16 px in the ${theme} theme`, async ({
    page,
    request
  }, info) => {
    await useTheme(page, theme);
    await page.goto('');

    const background = (
      await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    )
      .match(/\d+/g)
      ?.slice(0, 3)
      .map(Number) as number[];
    const [tile, wave] = await fills(request, 'favicon.svg');
    const [mark] = await fills(
      request,
      theme === 'dark' ? 'logo/mark-dark.svg' : 'logo/mark.svg'
    );

    expect(contrast(wave, tile), 'the wave on its tile').toBeGreaterThanOrEqual(
      3
    );
    expect(
      contrast(mark, background),
      `the ${theme} mark on the page`
    ).toBeGreaterThanOrEqual(3);

    await page.setContent(
      `<body style="margin:0;padding:8px;display:flex;gap:8px;align-items:center;background:rgb(${background.join(' ')})">
        <img src="${new URL('favicon.svg', page.url()).href}" width="16" height="16" alt="">
        <img src="${new URL(theme === 'dark' ? 'logo/mark-dark.svg' : 'logo/mark.svg', page.url()).href}" height="16" alt="">
      </body>`
    );
    await info.attach(`favicon and mark at 16 px, ${theme}`, {
      body: await page.locator('body').screenshot(),
      contentType: 'image/png'
    });
  });
}
