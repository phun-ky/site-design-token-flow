import { expect, test } from '@playwright/test';

import { validateTokens, type DTCGDocument } from '../src/tokens';

import { largeTokens } from './large-tokens';

const KB = 1024;
/**
 * Budgets per page on a throttled mobile profile, about 20% above what was
 * measured (decided on #19). Bytes are as transferred, gzipped like GitHub
 * Pages serves them. Raise a budget in the same pull request that needs it.
 */
const BUDGETS = [
  {
    name: 'flow',
    path: '',
    total: 1400 * KB,
    Script: 30 * KB,
    Stylesheet: 10 * KB,
    Font: 1200 * KB,
    requests: 22,
    lcp: 2500
  },
  {
    name: 'playground',
    path: 'playground',
    total: 500 * KB,
    Script: 150 * KB,
    Stylesheet: 10 * KB,
    Font: 350 * KB,
    requests: 15,
    lcp: 4000
  },
  {
    name: '404',
    path: 'no/such/page',
    total: 20 * KB,
    Script: 0,
    Stylesheet: 5 * KB,
    Font: 0,
    requests: 6,
    lcp: 2500
  }
] as const;

// A mid-range phone on Slow 4G, like Lighthouse's mobile profile
test.use({
  viewport: { width: 412, height: 823 },
  deviceScaleFactor: 1.75,
  isMobile: true,
  hasTouch: true
});

for (const budget of BUDGETS) {
  test(`${budget.name}: within its budget on a throttled phone`, async ({
    page,
    context
  }) => {
    const cdp = await context.newCDPSession(page);
    const types = new Map<string, string>();
    const bytes: Record<string, number> = {};

    let requests = 0;

    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    cdp.on('Network.responseReceived', (event) =>
      types.set(event.requestId, event.type)
    );
    cdp.on('Network.loadingFinished', (event) => {
      const type = types.get(event.requestId) ?? 'Other';

      requests += 1;
      bytes[type] = (bytes[type] ?? 0) + event.encodedDataLength;
    });
    await page.addInitScript(() => {
      (window as unknown as { lcp: number }).lcp = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          (window as unknown as { lcp: number }).lcp = entry.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    });

    await page.goto(budget.path);
    await page.waitForLoadState('networkidle');

    const lcp = await page.evaluate(
      () => (window as unknown as { lcp: number }).lcp
    );
    const total = Object.values(bytes).reduce((sum, value) => sum + value, 0);
    const kb = (value = 0) => `${Math.round(value / KB)} kB`;

    // In the log, also when within budget
    console.log(
      `${budget.name}: ${kb(total)} in ${requests} requests (script ${kb(bytes.Script)}, CSS ${kb(bytes.Stylesheet)}, fonts ${kb(bytes.Font)}), LCP ${Math.round(lcp)} ms`
    );

    expect.soft(total, 'total bytes').toBeLessThanOrEqual(budget.total);
    expect
      .soft(bytes.Script ?? 0, 'script bytes')
      .toBeLessThanOrEqual(budget.Script);
    expect
      .soft(bytes.Stylesheet ?? 0, 'CSS bytes')
      .toBeLessThanOrEqual(budget.Stylesheet);
    expect.soft(bytes.Font ?? 0, 'font bytes').toBeLessThanOrEqual(budget.Font);
    expect.soft(requests, 'requests').toBeLessThanOrEqual(budget.requests);
    expect
      .soft(lcp, 'Largest Contentful Paint, ms')
      .toBeLessThanOrEqual(budget.lcp);
  });
}

/**
 * The flow view with a large token file (#103): 976 tokens, 826 lines, alias
 * chains five deep, on the same throttled phone. Timing varies more than
 * sizes, most when other checks run at the same time, as in CI. Measured
 * alone: lines drawn in 1.4 to 1.8 s, 630 to 970 ms blocking, 15 to 18 ms a
 * frame while panning; next to the other checks, up to 1.8 s and 1.2 s. The
 * budgets are about twice that, and still far below what connecting the lines
 * one by one (26 s, 25 s blocking) and redrawing them on every pan step (46 ms
 * a frame) took.
 */
const LARGE = { drawn: 4000, blocking: 2500, panFrame: 33 };

test('flow with a large token file: draws and pans within its budget on a throttled phone', async ({
  page,
  context
}) => {
  // Room for a regression to show its numbers instead of timing out
  test.setTimeout(60_000);

  const doc = largeTokens();
  const { tokens } = validateTokens(doc as DTCGDocument);
  const lines = tokens.reduce((sum, token) => sum + token.ancestors.length, 0);
  const cdp = await context.newCDPSession(page);

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript((custom) => {
    const w = window as unknown as { blocking: number };

    localStorage.setItem(
      'dtf-demo',
      JSON.stringify({ preset: 'custom', custom })
    );
    w.blocking = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        w.blocking += Math.max(0, entry.duration - 50);
    }).observe({ type: 'longtask', buffered: true });
  }, JSON.stringify(doc));

  await page.goto('');

  // When the last line is drawn, from the start of navigation
  const drawn = await page.evaluate(async (count) => {
    while (document.querySelectorAll('.container .dtf-line').length < count)
      await new Promise((resolve) => requestAnimationFrame(resolve));

    return performance.now();
  }, lines);
  const blocking = await page.evaluate(
    () => (window as unknown as { blocking: number }).blocking
  );
  // The average frame while the wheel pans the canvas
  const panFrame = await page.evaluate(async () => {
    const viewport = document.querySelector('.app-viewport') as HTMLElement;
    const start = performance.now();

    for (let step = 0; step < 20; step += 1) {
      viewport.dispatchEvent(
        new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true })
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    return (performance.now() - start) / 20;
  });

  console.log(
    `flow, large file: ${tokens.length} tokens, ${lines} lines drawn at ${Math.round(drawn)} ms, ${Math.round(blocking)} ms blocking, ${Math.round(panFrame)} ms a frame while panning`
  );

  expect.soft(drawn, 'all lines drawn, ms').toBeLessThanOrEqual(LARGE.drawn);
  expect
    .soft(blocking, 'total blocking time, ms')
    .toBeLessThanOrEqual(LARGE.blocking);
  expect
    .soft(panFrame, 'a frame while panning, ms')
    .toBeLessThanOrEqual(LARGE.panFrame);
});
