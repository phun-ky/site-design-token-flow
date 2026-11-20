import { expect, test, type Page, type Route } from '@playwright/test';

import { SESSION_KEY, SUPABASE_URL } from '../src/app/supabase';

// Signing in (#144) against the built site, with Supabase mocked. The site's
// Content Security Policy still applies: the browser blocks a connection it
// doesn't allow before the mock sees it.
const base64url = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
const expiresAt = Math.floor(Date.now() / 1000) + 3600;
const user = {
  id: '00000000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'someone@example.com',
  app_metadata: { provider: 'github' },
  user_metadata: { name: 'Some One' },
  created_at: '2026-11-20T00:00:00Z'
};
const session = {
  access_token: [
    base64url({ alg: 'HS256', typ: 'JWT' }),
    base64url({ sub: user.id, role: 'authenticated', exp: expiresAt }),
    'signature'
  ].join('.'),
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: expiresAt,
  refresh_token: 'refresh-token',
  user
};
const fulfill = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status: route.request().method() === 'OPTIONS' ? 204 : status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*'
    },
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
const stored = (page: Page, key: string) =>
  page.evaluate((name) => localStorage.getItem(name), key);
const violations = (page: Page) => {
  const blocked: string[] = [];

  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy'))
      blocked.push(message.text());
  });

  return blocked;
};

test('goes to the provider with a PKCE challenge, back to the same page', async ({
  page,
  baseURL
}) => {
  // Stay on the page instead of going to GitHub
  await page.route(`${SUPABASE_URL}/auth/v1/authorize?*`, (route) =>
    route.abort()
  );
  await page.goto('playground');
  await page.getByRole('button', { name: 'Sign in' }).click();

  const [authorize] = await Promise.all([
    page.waitForRequest(`${SUPABASE_URL}/auth/v1/authorize?*`),
    page.getByRole('button', { name: 'Continue with GitHub' }).click()
  ]);
  const params = new URL(authorize.url()).searchParams;

  expect(params.get('provider')).toBe('github');
  expect(params.get('redirect_to')).toBe(new URL('playground', baseURL).href);
  expect(params.get('code_challenge')).toBeTruthy();
});

test('swaps the code for a session, and removes it from the URL', async ({
  page,
  baseURL
}) => {
  const blocked = violations(page);
  const urls: string[] = [];

  page.on('request', (request) => urls.push(request.url()));
  await page.addInitScript((key) => {
    // As signInWithOAuth leaves it before going to the provider
    localStorage.setItem(`${key}-code-verifier`, JSON.stringify('verifier'));
  }, SESSION_KEY);
  await page.route(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, (route) =>
    fulfill(route, session)
  );
  await page.route(`${SUPABASE_URL}/auth/v1/user`, (route) =>
    fulfill(route, user)
  );
  await page.goto('playground?code=one-time-code');

  await expect(page.getByRole('button', { name: 'Some One' })).toBeVisible();
  await expect(page).toHaveURL(new URL('playground', baseURL).href);
  expect(await stored(page, SESSION_KEY)).toContain(session.access_token);
  expect(urls.filter((url) => /access_token|refresh_token/.test(url))).toEqual(
    []
  );
  expect(blocked).toEqual([]);
});

test('shows a stored session, and signs out of this browser', async ({
  page
}) => {
  const blocked = violations(page);

  let logout = '';

  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: SESSION_KEY, value: JSON.stringify(session) }
  );
  await page.route(`${SUPABASE_URL}/auth/v1/user`, (route) =>
    fulfill(route, user)
  );
  await page.route(`${SUPABASE_URL}/auth/v1/logout?*`, (route) => {
    logout = route.request().url();

    return fulfill(route, {}, 204);
  });
  await page.goto('');
  await page.getByRole('button', { name: 'Some One' }).click();
  await expect(
    page.getByText('Signed in as someone@example.com')
  ).toContainText('with GitHub');
  await page.getByRole('button', { name: 'Sign out' }).click();

  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  expect(new URL(logout).searchParams.get('scope')).toBe('local');
  expect(await stored(page, SESSION_KEY)).toBeNull();
  expect(blocked).toEqual([]);
});

test('opens and closes the menu from the keyboard', async ({ page }) => {
  await page.goto('');

  const toggle = page.getByRole('button', { name: 'Sign in' });
  const github = page.getByRole('button', { name: 'Continue with GitHub' });

  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(github).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(github).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(github).toBeHidden();
});
