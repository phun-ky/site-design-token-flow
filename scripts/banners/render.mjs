// Renders the release banners into site/public/images, in the site's dark
// theme, on its dotted background: four formats (banner, og, square and
// portrait), each at 1x and 2x, as palette PNGs. The pills are rendered by
// src/tokens and the lines drawn by @phun-ky/arclace, as on the flow view.
//
// Usage: npm run banners -- <release>, e.g. 0.1
// The content is in scripts/banners/<release>.mjs. Rendering uses the site's
// own stylesheets and fonts, the installed Google Chrome and Python with
// Pillow; see scripts/lib/render.mjs.

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { flattenTokens, renderDesignToken } from '../../src/tokens/index.ts';
import { palette, read, ROOT, screenshots, url } from '../lib/render.mjs';

// Each page is laid out at 1/zoom of the image size and shown zoomed, so the
// pills, which the site sizes for reading up close, read in a preview
const FORMATS = [
  { suffix: '', width: 1200, height: 600, layout: 'wide', zoom: 1.5 },
  { suffix: '-og', width: 1200, height: 630, layout: 'wide', zoom: 1.5 },
  { suffix: '-square', width: 1080, height: 1080, layout: 'tall', zoom: 2 },
  { suffix: '-portrait', width: 1080, height: 1350, layout: 'tall', zoom: 2 }
];
const SCALES = [1, 2];
const release = process.argv[2];

if (!release) {
  console.error('Usage: npm run banners -- <release>, e.g. 0.1');
  process.exit(1);
}

const { default: content } = await import(
  pathToFileURL(join(ROOT, 'scripts', 'banners', `${release}.mjs`)).href
);
const escape = (text) =>
  String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
const example = flattenTokens(
  JSON.parse(read('src/assets/data/design-tokens.tokens.json'))
);
const tokens = content.tokens.map((id) => {
  const token = example.find((candidate) => candidate.id === id);

  if (!token) throw new Error(`No token ${id} in the example token file`);

  return token;
});
// A line from each token to the shown tokens it references, as on the flow view
const lines = JSON.stringify(
  tokens.flatMap((token) =>
    token.ancestors
      .filter((ancestor) => content.tokens.includes(ancestor))
      .map((ancestor) => [`#${ancestor}`, `#${token.id}`])
  )
);
// The site's styles, with its fonts from disk instead of the site's root
const styles = ['src/tokens/styles/design-token.css', 'src/styles/app.css']
  .map(read)
  .join('\n')
  .replaceAll(/url\('\/fonts\//g, `url('${url('site/public/fonts')}/`);
// Inlined, so the page needs no file access; </script> can't appear in it
const script = read(
  'node_modules/@phun-ky/arclace/dist/arclace.umd.cjs'
).replaceAll('</script', '<\\/script');
const title = content.title
  .map((part) =>
    typeof part === 'string'
      ? escape(part)
      : `<span class="accent">${escape(part.accent)}</span>`
  )
  .join('<br>');
const favicon = read('site/public/favicon.svg').replace(
  '<svg ',
  '<svg class="mark" '
);
const page = (layout, format) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
${styles}
${read('src/styles/flow.css')}
* { margin: 0; }
html, body { width: 100%; height: 100%; }
body { position: relative; overflow: hidden; padding: 0; }
/* Text sits on the background colour, never on a dot */
.release, h1, p { position: absolute; }
h1, p { background: var(--app-bg); box-shadow: 0 0 16px 14px var(--app-bg); }
.release { --dtf-token-font-size: 13px; gap: 10px; padding-left: 6px;
  padding-right: 14px; color: var(--app-text-muted); font-weight: 400; }
.release .mark { width: 24px; height: 24px; }
h1 { font-weight: 700; line-height: 1.08; letter-spacing: -0.025em; color: var(--app-text); }
.accent { color: var(--app-brand); }
p { color: var(--app-text-muted); line-height: 1.5; }
.diagram { position: absolute; display: flex; flex-direction: column;
  align-items: flex-end; justify-content: space-between; }
/* wide: text left, the pills right, from the alias down to the base colour */
.wide .release { top: 40px; left: 48px; }
.wide h1 { top: 112px; left: 48px; width: 400px; font-size: 38px; }
.wide p { bottom: 44px; left: 48px; width: 372px; font-size: 14px; }
.wide .diagram { top: 56px; right: 80px; bottom: 56px; }
/* tall: text on top, the pills below */
.tall .release { top: 40px; left: 40px; }
.tall h1 { top: 96px; left: 40px; width: 460px; font-size: 44px; }
.tall p { top: 214px; left: 40px; width: 460px; font-size: 14px; }
.tall .diagram { right: 72px; bottom: 36px; height: 196px; }
.portrait .tall .diagram { height: 300px; bottom: 60px; }
</style></head>
<body class="${format}"><main class="${layout}">
  <span class="release design-token">${favicon}${escape(content.pill)}</span>
  <h1>${title}</h1>
  <p>${escape(content.body)}</p>
  <div class="diagram" id="diagram">${tokens.map((token) => renderDesignToken(token)).join('')}</div>
</main>
<script>${script}</script>
<script>
  // Once the fonts load, so the lines meet the pills at their final size
  document.fonts.ready.then(() => {
    const arclace = new Arclace.Arclace({ container: '#diagram',
      defaults: { strokeWidth: 1.5, startSide: 'right', endSide: 'right' } });
    for (const [start, end] of ${lines}) arclace.connect(start, end, { className: 'dtf-line' });
  });
</script>
</body></html>`;
const shots = FORMATS.flatMap(({ suffix, width, height, layout, zoom }) =>
  SCALES.map((scale) => ({
    html: page(layout, suffix.slice(1)),
    width: width / zoom,
    height: height / zoom,
    scale: scale * zoom,
    out: `site/public/images/design-token-flow-${content.slug}${suffix}${scale === 2 ? '@2x' : ''}.png`
  }))
);

await screenshots(shots);
palette(shots.map(({ out }) => out));

for (const { out } of shots) console.log(out);
