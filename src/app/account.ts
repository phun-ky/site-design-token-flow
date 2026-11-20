import type { AuthClient, Session } from '@supabase/auth-js';

import { browserStorage, type TokenStorage } from './saved-tokens';
import { SESSION_KEY, SUPABASE_KEY, SUPABASE_URL } from './supabase';

/**
 * Signing in (#144), from the header's account menu. auth-js is loaded only
 * when someone signs in, or has signed in before, so other visitors load
 * nothing from other hosts.
 */

export const PROVIDERS = [
  { id: 'github', label: 'GitHub' },
  { id: 'google', label: 'Google' },
  { id: 'figma', label: 'Figma' }
] as const;

/** The parts of auth-js's client the menu uses, so tests can pass their own */
export type AccountClient = Pick<
  InstanceType<typeof AuthClient>,
  'getSession' | 'signInWithOAuth' | 'signOut'
>;

let client: Promise<AccountClient> | undefined;

/**
 * The auth-js client, loaded the first time it is needed. With PKCE, the
 * provider sends back a one-time code that only works with the verifier kept
 * in this browser, and auth-js swaps it for the session and removes it from
 * the URL.
 *
 * @returns {Promise<AccountClient>} The client
 */
export const loadClient = (): Promise<AccountClient> =>
  (client ??= import('@supabase/auth-js').then(
    ({ AuthClient }) =>
      new AuthClient({
        url: `${SUPABASE_URL}/auth/v1`,
        headers: { apikey: SUPABASE_KEY },
        storageKey: SESSION_KEY,
        flowType: 'pkce'
      }),
    (error: unknown) => {
      // Let the next click try again
      client = undefined;
      throw error;
    }
  ));

/**
 * Whether the page needs auth-js now: a session is stored, or the provider
 * has just sent the visitor back with a code or an error.
 *
 * @param {TokenStorage | null} storage Where the session is kept, or null when blocked
 * @param {string} search The page's query string, such as `location.search`
 * @returns {boolean} True when the client has to be loaded
 */
export const isSignedInOrReturning = (
  storage: TokenStorage | null,
  search: string
): boolean =>
  Boolean(storage?.getItem(SESSION_KEY)) || /[?&](code|error)=/.test(search);

/**
 * The name to show for a session: the name from the provider, the user name,
 * or the email.
 *
 * @param {Session} session The signed in session
 * @returns {string} The name
 */
export const accountName = ({ user }: Session): string => {
  const { full_name, name, user_name } = user.user_metadata ?? {};

  return full_name || name || user_name || user.email || 'Account';
};

/**
 * The provider a session signed in with, as its label, such as `GitHub`.
 *
 * @param {Session} session The signed in session
 * @returns {string} The label, or the provider id when it isn't one of ours
 */
export const providerLabel = ({ user }: Session): string => {
  const id = user.app_metadata?.provider;

  return PROVIDERS.find((provider) => provider.id === id)?.label ?? id ?? '';
};

const button = (text: string, className: string) => {
  const element = document.createElement('button');

  element.type = 'button';
  element.className = className;
  element.textContent = text;

  return element;
};

/**
 * Adds the account menu to the header: "Sign in" with a choice of provider,
 * or, when signed in, the account's name with "Sign out". The menu is a
 * popover, which the browser opens, closes on Escape or a click outside, and
 * puts next in the tab order.
 *
 * @param {HTMLElement} parent Where the menu goes, the header's menu
 * @param {object} [options] What tests replace
 * @param {() => Promise<AccountClient>} [options.load] Loads the client
 * @param {TokenStorage | null} [options.storage] Where the session is kept
 * @param {Pick<Location, 'origin' | 'pathname' | 'search'>} [options.place] The page's location
 * @returns {HTMLElement} The menu's container
 */
export const mountAccount = (
  parent: HTMLElement,
  {
    load = loadClient,
    storage = browserStorage(),
    place = location
  }: {
    load?: () => Promise<AccountClient>;
    storage?: TokenStorage | null;
    place?: Pick<Location, 'origin' | 'pathname' | 'search'>;
  } = {}
): HTMLElement => {
  const root = document.createElement('div');

  root.className = 'app-account';
  parent.append(root);

  const failed = (error: unknown) => {
    // eslint-disable-next-line no-console -- signing in has no other place to say why it failed
    console.error(error);
    render(null);
  };
  const render = (session: Session | null) => {
    const toggle = button(
      session ? accountName(session) : 'Sign in',
      'app-account-button'
    );
    const menu = document.createElement('div');
    const note = document.createElement('p');

    toggle.setAttribute('popovertarget', 'app-account-menu');
    menu.id = 'app-account-menu';
    menu.className = 'app-account-menu';
    menu.setAttribute('popover', '');
    note.className = 'app-account-note';

    if (session) {
      const email = document.createElement('strong');
      const signOut = button('Sign out', 'app-account-action');

      email.textContent = session.user.email ?? accountName(session);
      note.append('Signed in as ', email, ` with ${providerLabel(session)}`);
      signOut.addEventListener('click', () => {
        // Only this browser: other devices stay signed in
        load()
          .then((auth) => auth.signOut({ scope: 'local' }))
          .then(() => render(null), failed);
      });
      menu.append(note, signOut);
    } else {
      note.textContent =
        'Sign in to publish your tokens as a link for Tokens Studio.';
      menu.append(
        note,
        ...PROVIDERS.map(({ id, label }) => {
          const signIn = button(`Continue with ${label}`, 'app-account-action');

          signIn.addEventListener('click', () => {
            load()
              .then((auth) =>
                auth.signInWithOAuth({
                  provider: id,
                  // Back to this page, which GitHub Pages serves as a file,
                  // without its query string
                  options: { redirectTo: `${place.origin}${place.pathname}` }
                })
              )
              .then(({ error }) => error && failed(error), failed);
          });

          return signIn;
        })
      );
    }

    root.replaceChildren(toggle, menu);
  };

  if (isSignedInOrReturning(storage, place.search)) {
    load()
      .then((auth) => auth.getSession())
      .then(({ data, error }) => {
        if (error) failed(error);
        else render(data.session);
      }, failed);
  } else {
    render(null);
  }

  return root;
};
