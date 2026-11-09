import { expect, test, type Page } from '@playwright/test';

// Loading a token file from your computer into the playground (#102)
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
/** Drops a file on the editor, as dragging one from the desktop does */
const drop = async (page: Page, file: typeof FILE) => {
  const transfer = await page.evaluateHandle(
    ({ name, mimeType, text }) => {
      const data = new DataTransfer();

      data.items.add(new File([text], name, { type: mimeType }));

      return data;
    },
    { name: file.name, mimeType: file.mimeType, text: file.buffer.toString() }
  );

  await page.locator('.demo-source').dispatchEvent('dragover', {
    dataTransfer: transfer
  });
  await expect(page.locator('.demo-source')).toHaveClass(/is-dropping/);
  await page
    .locator('.demo-source')
    .dispatchEvent('drop', { dataTransfer: transfer });
};

test.beforeEach(async ({ page }) => {
  await page.goto('playground');
  await page.evaluate(() => localStorage.removeItem('dtf-demo'));
  await page.reload();
  await page.waitForLoadState('networkidle');
});

test('loads a chosen file, saves it, and sends nothing anywhere', async ({
  page
}) => {
  const requests: string[] = [];

  page.on('request', (request) =>
    requests.push(`${request.method()} ${request.url()}`)
  );

  const chooser = page.waitForEvent('filechooser');

  await page.getByRole('button', { name: 'Load a file' }).click();
  await (await chooser).setFiles(FILE);

  await expect(page.locator(status)).toHaveText(
    'Loaded "colors.tokens.json" (1 kB).'
  );
  await expect(page.locator(pills)).toHaveCount(2);
  await expect(page.locator('#preset')).toHaveValue('custom');
  await expect(page.locator('#to-flow')).toBeVisible();
  expect(requests, 'requests while loading a file').toEqual([]);

  await page.reload();
  await expect(page.locator('#source')).toHaveValue(FILE.buffer.toString());
});

test('loads a file dropped on the editor', async ({ page }) => {
  await drop(page, FILE);

  await expect(page.locator(status)).toHaveText(
    'Loaded "colors.tokens.json" (1 kB).'
  );
  await expect(page.locator('.demo-source')).not.toHaveClass(/is-dropping/);
  await expect(page.locator(pills)).toHaveCount(2);
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

  await expect(page.locator(status)).toHaveText('Loaded "broken.json" (1 kB).');
  await expect(page.locator('#error li')).toHaveCount(1);
  await expect(page.locator(pills)).toHaveCount(0);
});

test('asks before a file replaces your edits', async ({ page }) => {
  const edits = JSON.stringify({ size: { $type: 'dimension' } });

  await page.locator('#source').fill(edits);
  await page.locator('#file').setInputFiles(FILE);
  await expect(page.locator(status)).toContainText(
    '"colors.tokens.json" would replace your edits.'
  );
  await expect(
    page.getByRole('button', { name: 'Replace them' })
  ).toBeFocused();

  await page.getByRole('button', { name: 'Keep my edits' }).click();
  await expect(page.locator(status)).toHaveText(
    'Kept your edits. "colors.tokens.json" was not loaded.'
  );
  await expect(page.locator('#source')).toHaveValue(edits);

  await page.locator('#file').setInputFiles(FILE);
  await page.getByRole('button', { name: 'Replace them' }).click();
  await expect(page.locator('#source')).toHaveValue(FILE.buffer.toString());
  await expect(page.locator(pills)).toHaveCount(2);
});
