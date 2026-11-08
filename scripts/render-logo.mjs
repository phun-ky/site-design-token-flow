// Renders the icons and the README banners from the wave (#95):
// - site/public/favicon-32.png from site/public/favicon.svg
// - site/public/apple-touch-icon.png, the favicon on a full square, since iOS
//   rounds the corners itself
// - site/public/logo/banner-light.png and banner-dark.png, the favicon, the
//   site's name and what it does, on the site's dotted background
//
// Usage: npm run images:logo
// Rendering uses the installed Google Chrome, the site's own IBM Plex Sans
// files and its colour tokens from src/styles/app.css, so nothing is fetched
// from the network; Python with Pillow then turns the opaque images into
// palette PNGs. Run it again when the favicon or the tokens change, and commit
// the files.

import { chromium } from '@playwright/test';

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const url = (file) => pathToFileURL(join(ROOT, file)).href;
const favicon = read('site/public/favicon.svg');
/** The custom properties declared in the first block that matches */
const tokens = (css, selector) => {
  const block = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1];

  if (block === undefined) throw new Error(`No ${selector} block in app.css`);

  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [
      name,
      value.trim()
    ])
  );
};
const css = read('src/styles/app.css');
const DARK = tokens(css, ':root');
// The light theme only redefines some of the tokens
const LIGHT = { ...DARK, ...tokens(css, ':root\\.theme--light') };
const ICONS = [
  { svg: favicon, size: 32, out: 'site/public/favicon-32.png' },
  {
    svg: favicon.replace(/(<rect[^>]*?)\s+rx="[^"]*"/, '$1'),
    size: 180,
    out: 'site/public/apple-touch-icon.png',
    palette: true
  }
];
// README banners, at twice the width GitHub shows them
const BANNER = { width: 830, height: 240, scale: 2 };
const banner = (theme) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family: 'IBM Plex Sans'; font-weight: 400; src: url(${url('site/public/fonts/IBMPlexSans-Regular.woff2')}); }
@font-face { font-family: 'IBM Plex Sans'; font-weight: 700; src: url(${url('site/public/fonts/IBMPlexSans-Bold.woff2')}); }
* { box-sizing: border-box; margin: 0; }
/* The background is on .banner: on body, it would fill the whole canvas,
   corners included */
html, body, .banner { width: 100%; height: 100%; }
.banner { display: flex; align-items: center; gap: 36px; padding: 0 56px;
  overflow: hidden; border-radius: 18px; font-family: 'IBM Plex Sans', sans-serif;
  color: ${theme['--app-text-muted']}; background-color: ${theme['--app-bg']};
  background-image: radial-gradient(${theme['--app-dot']} 1px, transparent 0);
  background-size: 20px 20px; }
.mark { width: 112px; height: 112px; flex: none; }
h1 { font-size: 46px; font-weight: 700; line-height: 1.1; color: ${theme['--app-text']}; }
p { margin-top: 12px; font-size: 22px; line-height: 1.4; }
</style></head>
<body><div class="banner">
  ${favicon.replace('<svg ', '<svg class="mark" ')}
  <div><h1>Design Token Flow</h1><p>See how design tokens relate: every token a pill, every alias a line.</p></div>
</div></body></html>`;
const browser = await chromium.launch({ channel: 'chrome' });
const dir = mkdtempSync(join(tmpdir(), 'logo-'));
const written = [];
const palette = [];
/** Renders a page to a PNG, with a transparent background where it has none */
const shoot = async (html, width, height, scale, out) => {
  const file = join(dir, `${written.length}.html`);
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale
  });
  const tab = await context.newPage();

  writeFileSync(file, html);
  await tab.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  await tab.evaluate(() => document.fonts.ready);
  await tab.screenshot({ path: join(ROOT, out), omitBackground: true });
  await context.close();
  written.push(out);
};

try {
  for (const { svg, size, out, palette: small } of ICONS) {
    await shoot(
      `<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
      size,
      size,
      1,
      out
    );

    if (small) palette.push(out);
  }

  for (const [name, theme] of [
    ['light', LIGHT],
    ['dark', DARK]
  ]) {
    const out = `site/public/logo/banner-${name}.png`;

    await shoot(banner(theme), BANNER.width, BANNER.height, BANNER.scale, out);
    palette.push(out);
  }
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}

// Palette PNGs are a fraction of the size. The 32 px favicon keeps full
// colour, since a palette makes its anti-aliased edges ragged. An image
// without transparent pixels, like the Apple touch icon, drops its alpha
// channel, as iOS expects
execFileSync(
  'python3',
  [
    '-c',
    `import sys
from PIL import Image
for path in sys.argv[1:]:
    image = Image.open(path).convert('RGBA')
    if image.getchannel('A').getextrema()[0] == 255:
        image = image.convert('RGB')
    image.quantize(256, method=Image.Quantize.FASTOCTREE).save(path, optimize=True)`,
    ...palette.map((out) => join(ROOT, out))
  ],
  { stdio: 'inherit' }
);

for (const out of written) console.log(out);
