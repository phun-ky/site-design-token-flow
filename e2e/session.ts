import type { Page, Route } from '@playwright/test';

import { SESSION_KEY } from '../src/app/supabase';

// A signed in session and Supabase answers, for checks that mock Supabase
const base64url = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
const expiresAt = Math.floor(Date.now() / 1000) + 3600;

export const user = {
  id: '00000000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'someone@example.com',
  app_metadata: { provider: 'github' },
  user_metadata: { name: 'Some One' },
  created_at: '2026-11-20T00:00:00Z'
};

export const session = {
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

export const fulfill = (route: Route, body: unknown, status = 200) =>
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

/** Opens pages signed in, as after signing in with GitHub */
export const signIn = (page: Page) =>
  page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: SESSION_KEY,
    value: JSON.stringify(session)
  });
