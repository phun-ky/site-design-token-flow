// Shared by the logo and banner scripts: renders HTML pages to PNGs in the
// installed Google Chrome, and turns PNGs into palette images with Python and
// Pillow, so nothing is fetched from the network.

import { chromium } from '@playwright/test';

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** A file in the repository, as text */
export const read = (file) => readFileSync(join(ROOT, file), 'utf8');

/** A file in the repository, as a file: URL a page can load */
export const url = (file) => pathToFileURL(join(ROOT, file)).href;

/**
 * Renders each page to a PNG, with a transparent background where it has none.
 *
 * @param {Array<{ html: string, width: number, height: number, scale: number,
 *   out: string }>} shots - `width` and `height` in CSS pixels, `scale` the
 *   device pixel ratio, `out` relative to the repository
 */
export const screenshots = async (shots) => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const dir = mkdtempSync(join(tmpdir(), 'render-'));

  try {
    for (const [index, shot] of shots.entries()) {
      const file = join(dir, `${index}.html`);
      const context = await browser.newContext({
        viewport: { width: shot.width, height: shot.height },
        deviceScaleFactor: shot.scale
      });
      const tab = await context.newPage();

      writeFileSync(file, shot.html);
      await tab.goto(pathToFileURL(file).href, { waitUntil: 'load' });
      // Two frames after the fonts load, so what depends on their size, such
      // as lines between elements, is drawn again
      await tab.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done))
        );
      });
      await tab.screenshot({
        path: join(ROOT, shot.out),
        omitBackground: true
      });
      await context.close();
    }
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
};

/**
 * Turns PNGs into palette PNGs, a fraction of the size. An image without
 * transparent pixels drops its alpha channel, as iOS expects of the Apple
 * touch icon.
 *
 * @param {string[]} outs - Relative to the repository
 */
export const palette = (outs) =>
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
      ...outs.map((out) => join(ROOT, out))
    ],
    { stdio: 'inherit' }
  );
