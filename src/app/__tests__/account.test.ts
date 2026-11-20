import 'global-jsdom/register';

// Node has its own CustomEvent, which global-jsdom leaves in place, and jsdom
// only dispatches its own events; a browser has just the one
globalThis.CustomEvent = window.CustomEvent;

import type { Session } from '@supabase/auth-js';

import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import {
  ACCOUNT_EVENT,
  accountName,
  deleteAccount,
  freshSession,
  isSignedInOrReturning,
  mountAccount,
  providerLabel,
  type AccountClient
} from '../account';
import { SESSION_KEY, SUPABASE_KEY, SUPABASE_URL } from '../supabase';

const storageWith = (value: string | null) => ({
  getItem: (key: string) => (key === SESSION_KEY ? value : null),
  setItem: () => {}
});
const sessionOf = (
  user_metadata: Record<string, string>,
  email = 'someone@example.com',
  provider = 'github'
) =>
  ({
    access_token: 'token',
    user: { email, user_metadata, app_metadata: { provider } }
  }) as unknown as Session;
const place = {
  origin: 'https://phun-ky.net',
  pathname: '/site-design-token-flow/playground',
  search: ''
};
const fakeClient = (session: Session | null = null) => ({
  getSession: mock.fn(async () => ({ data: { session }, error: null })),
  signInWithOAuth: mock.fn(async () => ({
    data: { provider: 'github', url: '' },
    error: null
  })),
  signOut: mock.fn(async () => ({ error: null }))
});
// Lets the menu's promises settle
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const mount = (
  client: ReturnType<typeof fakeClient>,
  stored: string | null = null,
  search = ''
) => {
  const load = mock.fn(async () => client as unknown as AccountClient);
  const root = mountAccount(document.body, {
    load,
    storage: storageWith(stored),
    place: { ...place, search }
  });

  return { load, root };
};
const texts = (root: HTMLElement, selector: string) =>
  [...root.querySelectorAll(selector)].map((element) => element.textContent);

describe('isSignedInOrReturning', () => {
  it('is true with a stored session, or a code or error from the provider', () => {
    assert.equal(isSignedInOrReturning(storageWith('{}'), ''), true);
    assert.equal(isSignedInOrReturning(null, '?code=abc'), true);
    assert.equal(isSignedInOrReturning(null, '?x=1&error=access_denied'), true);
  });

  it('is false otherwise, also when storage is blocked', () => {
    assert.equal(isSignedInOrReturning(storageWith(null), ''), false);
    assert.equal(isSignedInOrReturning(null, ''), false);
    assert.equal(isSignedInOrReturning(null, '?barcode=1'), false);
  });
});

describe('accountName and providerLabel', () => {
  it('prefers the full name, then the name, user name and email', () => {
    assert.equal(accountName(sessionOf({ full_name: 'A', name: 'B' })), 'A');
    assert.equal(accountName(sessionOf({ name: 'B', user_name: 'c' })), 'B');
    assert.equal(accountName(sessionOf({ user_name: 'c' })), 'c');
    assert.equal(accountName(sessionOf({})), 'someone@example.com');
    assert.equal(accountName(sessionOf({}, '')), 'Account');
  });

  it('labels the provider', () => {
    assert.equal(providerLabel(sessionOf({}, 'x', 'figma')), 'Figma');
    assert.equal(providerLabel(sessionOf({}, 'x', 'other')), 'other');
  });
});

describe('mountAccount', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    mock.restoreAll();
  });

  it('offers to sign in without loading auth-js', () => {
    const { load, root } = mount(fakeClient());

    assert.deepEqual(texts(root, '.app-account-button'), ['Sign in']);
    assert.deepEqual(texts(root, '.app-account-action'), [
      'Continue with GitHub',
      'Continue with Google',
      'Continue with Figma'
    ]);
    assert.equal(
      root.querySelector('.app-account-button')?.getAttribute('popovertarget'),
      root.querySelector('[popover]')?.id
    );
    assert.equal(load.mock.callCount(), 0);
  });

  it('signs in with the chosen provider, back to this page', async () => {
    const client = fakeClient();
    const { root } = mount(client);

    (root.querySelectorAll('.app-account-action')[2] as HTMLElement).click();
    await settle();

    assert.deepEqual(client.signInWithOAuth.mock.calls[0].arguments, [
      {
        provider: 'figma',
        options: {
          redirectTo: 'https://phun-ky.net/site-design-token-flow/playground'
        }
      }
    ]);
  });

  it('shows the account of a stored session, as text', async () => {
    const client = fakeClient(sessionOf({ name: '<img src=x>' }));
    const { root } = mount(client, '{}');

    await settle();

    assert.deepEqual(texts(root, '.app-account-button'), ['<img src=x>']);
    assert.equal(root.querySelector('img'), null);
    assert.equal(
      root.querySelector('.app-account-note')?.textContent,
      'Signed in as someone@example.com with GitHub'
    );
  });

  it('loads auth-js when the provider sends a code back', async () => {
    const client = fakeClient(sessionOf({ name: 'Some One' }));
    const { root } = mount(client, null, '?code=abc');

    await settle();

    assert.equal(client.getSession.mock.callCount(), 1);
    assert.deepEqual(texts(root, '.app-account-button'), ['Some One']);
  });

  it('signs out of this browser only, and offers to sign in again', async () => {
    const client = fakeClient(sessionOf({ name: 'Some One' }));
    const { root } = mount(client, '{}');

    await settle();
    (root.querySelector('.app-account-action') as HTMLElement).click();
    await settle();

    assert.deepEqual(client.signOut.mock.calls[0].arguments, [
      { scope: 'local' }
    ]);
    assert.deepEqual(texts(root, '.app-account-button'), ['Sign in']);
  });

  it('tells the page who is signed in, on load and after signing out', async () => {
    const seen: (Session | null)[] = [];
    const listen = (event: Event) =>
      seen.push((event as CustomEvent<Session | null>).detail);
    const session = sessionOf({ name: 'Some One' });

    window.addEventListener(ACCOUNT_EVENT, listen);

    const { root } = mount(fakeClient(session), '{}');

    await settle();
    (root.querySelector('.app-account-action') as HTMLElement).click();
    await settle();
    window.removeEventListener(ACCOUNT_EVENT, listen);

    assert.deepEqual(seen, [session, null]);
  });

  it('gives the current session from the client', async () => {
    const session = sessionOf({});
    const client = fakeClient(session);

    assert.equal(
      await freshSession(async () => client as unknown as AccountClient),
      session
    );
  });

  it('offers to sign in when auth-js or the session fails', async () => {
    const error = mock.method(console, 'error', () => {});
    const root = mountAccount(document.body, {
      load: () => Promise.reject(new Error('offline')),
      storage: storageWith('{}'),
      place
    });
    const client = fakeClient();

    client.getSession = mock.fn(async () => ({
      data: { session: null },
      error: new Error('expired')
    })) as unknown as typeof client.getSession;

    const second = mount(client, '{}').root;

    await settle();

    assert.deepEqual(texts(root, '.app-account-button'), ['Sign in']);
    assert.deepEqual(texts(second, '.app-account-button'), ['Sign in']);
    assert.equal(error.mock.callCount(), 2);
  });

  describe('deleting the account', () => {
    /** localStorage with a document published as u/s.json */
    const published = () => {
      const items = new Map<string, string>([
        [SESSION_KEY, '{}'],
        [
          'dtf-demo',
          JSON.stringify({
            current: 'a',
            documents: [{ id: 'a', name: 'A', custom: '{}', link: 'u/s.json' }]
          })
        ]
      ]);

      return {
        items,
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value)
      };
    };
    const confirm = () => {
      const dialog = document.querySelector('dialog') as HTMLDialogElement;

      dialog.returnValue = 'delete';
      dialog.dispatchEvent(new window.Event('close'));
    };

    it('asks the Edge Function, as the account', async () => {
      const request = mock.fn(async () => new Response('{}', { status: 200 }));

      assert.equal(await deleteAccount('token', request), true);
      assert.deepEqual(request.mock.calls[0].arguments, [
        `${SUPABASE_URL}/functions/v1/delete-account`,
        {
          method: 'POST',
          headers: { apikey: SUPABASE_KEY, authorization: 'Bearer token' }
        }
      ]);
      assert.equal(
        await deleteAccount(
          'token',
          mock.fn(async () => new Response('{}', { status: 500 }))
        ),
        false
      );
    });

    it('signs out, and forgets the links, once it is deleted', async () => {
      const client = fakeClient(sessionOf({ name: 'Some One' }));
      const storage = published();
      const root = mountAccount(document.body, {
        load: async () => client as unknown as AccountClient,
        storage,
        place,
        request: mock.fn(async () => new Response('{}', { status: 200 }))
      });

      await settle();
      confirm();
      await settle();

      assert.deepEqual(client.signOut.mock.calls[0].arguments, [
        { scope: 'local' }
      ]);
      assert.deepEqual(texts(root, '.app-account-button'), ['Sign in']);
      assert.equal(
        root.querySelector('.app-account-note')?.textContent,
        'Your account and its published links are deleted.'
      );
      assert.doesNotMatch(storage.items.get('dtf-demo') as string, /link/);
    });

    it('stays signed in, and says so, when it is not deleted', async () => {
      mock.method(console, 'error', () => {});

      const client = fakeClient(sessionOf({ name: 'Some One' }));
      const storage = published();
      const root = mountAccount(document.body, {
        load: async () => client as unknown as AccountClient,
        storage,
        place,
        request: mock.fn(async () => new Response('{}', { status: 500 }))
      });

      await settle();
      confirm();
      await settle();

      assert.equal(client.signOut.mock.callCount(), 0);
      assert.deepEqual(texts(root, '.app-account-button'), ['Some One']);
      assert.equal(
        root.querySelector('.app-account-note')?.textContent,
        'Your account could not be deleted. Try again later.'
      );
      assert.match(storage.items.get('dtf-demo') as string, /u\/s\.json/);
    });
  });
});
