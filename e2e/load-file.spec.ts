import { expect, test, type Page } from '@playwright/test';

import { largeTokens } from './large-tokens';

// Loading a token file from your computer into the playground (#102), with
// progress (#109) and a dialog before it replaces your edits (#108)
const TOKENS = {
  color: {
    $type: 'color',
    blue: { $value: { colorSpace: 'srgb', components: [0, 0.33, 0.94] } },
    cta: { $value: '{color.blue}' }
  }
};
const FILE = {
  name: 'colors.tokens.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(TOKENS, null, 2))
};
const pills = '#groups .design-token';
const status = '#file-status';
/** Drops a file on the playground, as dragging one from the desktop does */
const drop = async (page: Page, file: typeof FILE, target = '#groups') => {
  const transfer = await page.evaluateHandle(
    ({ name, mimeType, text }) => {
      const data = new DataTransfer();

      data.items.add(new File([text], name, { type: mimeType }));

      return data;
    },
    { name: file.name, mimeType: file.mimeType, text: file.buffer.toString() }
  );

  await page.locator(target).dispatchEvent('dragover', {
    dataTransfer: transfer
  });
  await expect(page.locator('#drop')).toHaveClass(/is-dropping/);
  await page.locator(target).dispatchEvent('drop', { dataTransfer: transfer });
};
/** Every text the status shows from now on */
const recordStatus = (page: Page) =>
  page.evaluate(() => {
    const seen: string[] = [];
    const element = document.querySelector('#file-status') as HTMLElement;

    new MutationObserver(() => seen.push(element.textContent ?? '')).observe(
      element,
      { childList: true, subtree: true, characterData: true }
    );
    (window as unknown as { statusSeen: string[] }).statusSeen = seen;
  });
const statusSeen = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { statusSeen: string[] }).statusSeen
  );

test.beforeEach(async ({ page }) => {
  await page.goto('playground');
  await page.evaluate(() => localStorage.removeItem('dtf-demo'));
  await page.reload();
  await page.waitForLoadState('networkidle');
});

test('loads a chosen file in steps, checks it in a worker, saves it, and sends nothing anywhere', async ({
  page
}) => {
  const requests: string[] = [];
  const workers: string[] = [];

  page.on('request', (request) =>
    requests.push(`${request.method()} ${request.url()}`)
  );
  page.on('worker', (worker) => workers.push(worker.url()));
  await recordStatus(page);

  const chooser = page.waitForEvent('filechooser');

  await page.getByRole('button', { name: 'Load a file' }).click();
  await (await chooser).setFiles(FILE);

  await expect(page.locator(status)).toHaveText(
    'Loaded "colors.tokens.json" (1 kB): 2 tokens.'
  );
  await expect(page.locator(pills)).toHaveCount(2);
  await expect(page.getByRole('radio', { name: /^Your tokens/ })).toBeChecked();
  await expect(page.locator('#to-flow')).toBeVisible();
  // Nothing was sent, and the worker was already running for the editor
  expect(requests, 'requests while loading a file').toEqual([]);

  const seen = await statusSeen(page);

  expect(
    seen.some((text) => text.startsWith('Reading "colors.tokens.json"'))
  ).toBe(true);
  expect(seen.some((text) => text.startsWith('Checking 2 tokens'))).toBe(true);

  await page.reload();
  await expect(page.locator('#source')).toHaveValue(FILE.buffer.toString());
  expect(workers.some((url) => url.includes('validate-worker'))).toBe(true);
});

test('loads a file dropped anywhere on the playground', async ({ page }) => {
  await drop(page, FILE);

  await expect(page.locator(status)).toHaveText(
    'Loaded "colors.tokens.json" (1 kB): 2 tokens.'
  );
  await expect(page.locator('#drop')).not.toHaveClass(/is-dropping/);
  await expect(page.locator(pills)).toHaveCount(2);
});

test('loads a large file, and keeps the page usable while checking it', async ({
  page
}) => {
  const text = JSON.stringify(largeTokens(), null, 2);

  await page.locator('#file').setInputFiles({
    name: 'large.tokens.json',
    mimeType: 'application/json',
    buffer: Buffer.from(text)
  });
  // The filter takes input while the worker checks
  await page.locator('#filter').fill('brand');
  await expect(page.locator(status)).toContainText(
    'Loaded "large.tokens.json"'
  );
  await expect(page.locator(status)).toContainText('976 tokens');
  await expect(page.locator(pills)).toHaveCount(20);
});

test('cancels reading a file, and keeps the editor', async ({ page }) => {
  const before = await page.locator('#source').inputValue();

  // A reader that reports progress and never finishes, so Cancel can be pressed
  await page.evaluate(() => {
    FileReader.prototype.readAsText = function () {
      this.dispatchEvent(
        new ProgressEvent('progress', {
          loaded: 1,
          total: 2,
          lengthComputable: true
        })
      );
    };
    FileReader.prototype.abort = function () {
      this.dispatchEvent(new ProgressEvent('abort'));
    };
  });
  await page.locator('#file').setInputFiles(FILE);
  await expect(page.locator(`${status} progress`)).toHaveAttribute(
    'value',
    '1'
  );
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator(status)).toHaveText(
    'Cancelled: "colors.tokens.json" was not loaded.'
  );
  await expect(page.locator('#source')).toHaveValue(before);
});

test('refuses a file that is too large or not text, and keeps the editor', async ({
  page
}) => {
  const before = await page.locator('#source').inputValue();

  await page.locator('#file').setInputFiles({
    ...FILE,
    name: 'huge.tokens.json',
    buffer: Buffer.alloc(3 * 1024 * 1024, ' ')
  });
  await expect(page.locator(status)).toHaveText(
    '"huge.tokens.json" (3.0 MB) is too large: the playground keeps token files up to 2.0 MB in your browser.'
  );
  await expect(page.locator(status)).toHaveClass(/is-refused/);

  await page.locator('#file').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])
  });
  await expect(page.locator(status)).toHaveText(
    '"logo.png" is not a text file: load a .json token file.'
  );
  await expect(page.locator('#source')).toHaveValue(before);
});

test('validates a loaded file like typed text', async ({ page }) => {
  await page.locator('#file').setInputFiles({
    ...FILE,
    name: 'broken.json',
    buffer: Buffer.from('{ "color": ')
  });

  await expect(page.locator(status)).toHaveText(
    'Loaded "broken.json" (1 kB): 0 tokens, 1 problem.'
  );
  await expect(page.locator('#error li')).toHaveCount(1);
  await expect(page.locator(pills)).toHaveCount(0);
});

test('asks in the import wizard before a file replaces your tokens, or adds to them', async ({
  page
}) => {
  const edits = JSON.stringify(
    {
      color: {
        $type: 'color',
        red: { $value: { colorSpace: 'srgb', components: [1, 0, 0] } }
      }
    },
    null,
    2
  );
  const wizard = page.getByRole('dialog', { name: /^Import/ });

  await page.locator('#source').fill(edits);
  await expect(page.getByRole('radio', { name: /^Your tokens/ })).toBeChecked();
  await expect(page.locator(pills)).toHaveCount(1);
  await page.locator('#file').setInputFiles(FILE);

  await expect(wizard).toBeVisible();
  await expect(wizard).toContainText('A DTCG file with 2 tokens.');
  // Modal: the page behind can't be used
  expect(
    await page.evaluate(() =>
      (document.querySelector('#import') as HTMLDialogElement).matches(':modal')
    )
  ).toBe(true);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(
    page.getByRole('radio', { name: /^Add to your tokens/ })
  ).toBeChecked();
  await expect(wizard).toContainText('Adds 2 tokens to your 1');

  // Esc keeps your tokens
  await page.keyboard.press('Escape');
  await expect(wizard).toBeHidden();
  await expect(page.locator(status)).toHaveText(
    'Kept your tokens. "colors.tokens.json" was not loaded.'
  );
  await expect(page.locator('#source')).toHaveValue(edits);

  // Add: your red stays, the file's tokens join it
  await page.locator('#file').setInputFiles(FILE);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Add 2 tokens' }).click();
  await expect(page.locator(pills)).toHaveCount(3);
  await expect(page.locator(status)).toContainText(
    'Added 2 tokens from "colors.tokens.json"'
  );

  // Replace: only the file's tokens, as the file has them
  await page.locator('#file').setInputFiles(FILE);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: /^Replace your tokens/ }).check();
  await page.getByRole('button', { name: 'Load 2 tokens' }).click();
  await expect(page.locator('#source')).toHaveValue(FILE.buffer.toString());
  await expect(page.locator(pills)).toHaveCount(2);
});
