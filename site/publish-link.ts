// A document's link for Tokens Studio (#145), under its name in the
// playground's sidebar: publish, copy, change and unpublish, and keep it up to
// date about 2 seconds after the last edit without problems. Links published
// on another device can be opened here (#146), and a link changed elsewhere
// isn't overwritten without asking.
import type { Session } from '@supabase/auth-js';

import { ACCOUNT_EVENT, freshSession } from '../src/app/account';
import { checkTokenText } from '../src/app/check-tokens';
import {
  LINK_LIMIT,
  downloadLink,
  linkName,
  listLinks,
  newLinkPath,
  publicUrl,
  removeLink,
  sameJson,
  uploadLink
} from '../src/app/published-links';
import {
  addDocument,
  listDocuments,
  setDocumentLink,
  type SavedDocument,
  type TokenStorage
} from '../src/app/saved-tokens';
import type { DTCGDocument } from '../src/tokens';

/** How long after the last edit a published link is updated */
const DELAY = 2000;
const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector(selector) as T;
const time = () =>
  new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Wires up the `#link` section.
 *
 * @param {TokenStorage | null} store Where the documents are saved
 * @param {(message: string) => void} announce Says what happened, for screen readers too
 * @param {object} playground What the playground does for it
 * @param {(text: string) => Promise<unknown>} playground.replace Puts JSON in the editor as the current document
 * @param {() => void} playground.opened Shows a document just added, as current
 * @returns The playground's handles: `show` after switching documents,
 * `edited` after a version without problems is saved, and `unpublish` for a
 * document being deleted
 */
export const mountPublishLink = (
  store: TokenStorage | null,
  announce: (message: string) => void,
  {
    replace,
    opened
  }: {
    replace: (text: string) => Promise<unknown>;
    opened: () => void;
  }
) => {
  const hintEl = $<HTMLParagraphElement>('#link-hint');
  const publishedEl = $<HTMLDivElement>('#link-published');
  const urlEl = $<HTMLInputElement>('#link-url');
  const copyEl = $<HTMLButtonElement>('#link-copy');
  const publishEl = $<HTMLButtonElement>('#link-publish');
  const changeEl = $<HTMLButtonElement>('#link-change');
  const unpublishEl = $<HTMLButtonElement>('#link-unpublish');
  const statusEl = $<HTMLParagraphElement>('#link-status');
  const conflictEl = $<HTMLDivElement>('#link-conflict');
  const usePublishedEl = $<HTMLButtonElement>('#link-use-published');
  const keepEl = $<HTMLButtonElement>('#link-keep');
  const elsewhereEl = $<HTMLElement>('#published-elsewhere');
  const elsewhereListEl = elsewhereEl.querySelector('ul') as HTMLUListElement;
  const elsewhereStatusEl = $<HTMLParagraphElement>('#elsewhere-status');

  let signedIn = false;
  let busy = false;
  let timer: number | undefined;
  /** The document whose link changed elsewhere, until you choose a version */
  let conflict: string | null = null;
  /** Links published on any device, with their names */
  let remote: { path: string; name: string; updated: string }[] = [];

  const find = (id: string) =>
    listDocuments(store).documents.find((saved) => saved.id === id);
  const currentDocument = () => {
    const { documents, current } = listDocuments(store);

    return documents.find(({ id }) => id === current) as SavedDocument;
  };
  /** The same Tokens Studio JSON as the export; the converter loads when first needed */
  const tokensStudio = async (valid: string) => {
    const { tokensStudioText } = await import('./export-dialog');

    return tokensStudioText({
      document: JSON.parse(valid) as DTCGDocument,
      tokens: checkTokenText(valid).tokens,
      earlier: false
    });
  };
  /** A published file as a DTCG document, through the Tokens Studio import */
  const asDocument = async (text: string) => {
    const { convertTokenText } = await import('../src/app/convert-tokens');
    const converted = convertTokenText(text);

    if (!converted) throw new Error('the published file is not JSON');

    return JSON.stringify(converted.conversion.document, null, 2);
  };
  /** Published links no document in this browser has, to open */
  const renderElsewhere = () => {
    const local = new Set(
      listDocuments(store).documents.map(({ link }) => link)
    );
    const elsewhere = signedIn
      ? remote.filter(({ path }) => !local.has(path))
      : [];

    elsewhereEl.hidden = elsewhere.length === 0;
    elsewhereListEl.replaceChildren(
      ...elsewhere.map(({ path, name, updated }) => {
        const item = document.createElement('li');
        const label = document.createElement('span');
        const detail = document.createElement('span');
        const open = document.createElement('button');

        detail.className = 'demo-muted';
        detail.textContent = updated
          ? `Updated ${new Date(updated).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
          : '';
        label.append(name, detail);
        open.type = 'button';
        open.className = 'demo-button';
        open.textContent = 'Open';
        open.setAttribute('aria-label', `Open ${name}`);
        open.addEventListener('click', () => void openLink(path, name));
        item.append(label, open);

        return item;
      })
    );
  };
  const refresh = () => {
    const { link, valid } = currentDocument();

    urlEl.value = link ? publicUrl(link) : '';
    publishedEl.hidden = !link;
    publishEl.hidden = !signedIn || Boolean(link);
    changeEl.hidden = !signedIn || !link;
    unpublishEl.hidden = !signedIn || !link;
    publishEl.disabled = busy || !valid;
    changeEl.disabled = busy || !valid;
    unpublishEl.disabled = busy;
    conflictEl.hidden = conflict === null || conflict !== currentDocument().id;
    usePublishedEl.disabled = busy;
    keepEl.disabled = busy;
    hintEl.textContent = !signedIn
      ? link
        ? 'Sign in to keep it up to date.'
        : 'Sign in to publish this document as a link that Tokens Studio syncs from.'
      : link
        ? 'In Tokens Studio: Settings, Sync providers, Add new, URL, and paste the link. Your edits update it 2 seconds later; pull in Tokens Studio to get them.'
        : valid
          ? `Publish it as a link that Tokens Studio syncs from, up to ${LINK_LIMIT} links.`
          : 'Add tokens without problems to publish them.';
  };
  /**
   * Runs a step with a fresh session, and says why when it fails. The tokens
   * stay saved in this browser either way.
   */
  const withSession = async (
    step: (session: Session) => Promise<string | null>,
    failure = 'Not published',
    target = statusEl
  ) => {
    busy = true;
    refresh();

    try {
      const session = await freshSession();
      const failed = session ? await step(session) : 'sign in again';

      if (failed) target.textContent = `${failure}: ${failed}`;
    } catch (error) {
      target.textContent = `${failure}: ${(error as Error).message}`;
    } finally {
      busy = false;
      refresh();
    }
  };
  const published = (message: string) => {
    statusEl.textContent = `Published ${time()}`;
    announce(message);
  };
  /** Uploads a document's latest version without problems to its link */
  const update = (id: string) =>
    withSession(async ({ access_token }) => {
      const saved = find(id);

      if (!saved?.link || !saved.valid) return null;

      const failed = await uploadLink(
        access_token,
        saved.link,
        await tokensStudio(saved.valid),
        saved.name
      );

      if (!failed && id === currentDocument().id)
        published('Updated the link for Tokens Studio');

      return failed;
    });

  publishEl.addEventListener('click', () =>
    withSession(async ({ access_token, user }) => {
      const { id, name, valid } = currentDocument();

      if (!valid) return 'add tokens without problems first';

      // The Storage policy refuses more, this only says why
      if ((await listLinks(access_token, user.id)).length >= LINK_LIMIT)
        return `${LINK_LIMIT} links is the limit for now`;

      const path = newLinkPath(user.id);
      const failed = await uploadLink(
        access_token,
        path,
        await tokensStudio(valid),
        name
      );

      if (failed) return failed;

      setDocumentLink(store, id, path);
      published('Published the link for Tokens Studio');
      void loadElsewhere();

      return null;
    })
  );
  // A new share id: the old link stops working. The old file goes first, so
  // changing a link works at the limit too
  changeEl.addEventListener('click', () =>
    withSession(async ({ access_token, user }) => {
      const { id, link, name, valid } = currentDocument();

      if (!link || !valid) return null;

      const removed = await removeLink(access_token, link);

      if (removed) return removed;

      setDocumentLink(store, id, undefined);

      const path = newLinkPath(user.id);
      const failed = await uploadLink(
        access_token,
        path,
        await tokensStudio(valid),
        name
      );

      if (failed) return `the old link is unpublished: ${failed}`;

      setDocumentLink(store, id, path);
      published('Changed the link for Tokens Studio');
      void loadElsewhere();

      return null;
    })
  );
  unpublishEl.addEventListener('click', () =>
    withSession(async ({ access_token }) => {
      const { id, link } = currentDocument();

      if (!link) return null;

      const failed = await removeLink(access_token, link);

      if (failed) return failed;

      setDocumentLink(store, id, undefined);
      statusEl.textContent = 'Unpublished: the link no longer works';
      announce('Unpublished the link');
      void loadElsewhere();

      return null;
    })
  );

  /** Lists the account's links, and the names of those not in this browser */
  const loadElsewhere = async () => {
    if (!signedIn) {
      remote = [];
      renderElsewhere();

      return;
    }

    try {
      const session = await freshSession();

      if (!session) return;

      const links = await listLinks(session.access_token, session.user.id);
      const local = new Set(
        listDocuments(store).documents.map(({ link }) => link)
      );

      remote = await Promise.all(
        links.map(async (published) => ({
          ...published,
          name: local.has(published.path)
            ? ''
            : ((await linkName(session.access_token, published.path)) ??
              'Untitled')
        }))
      );
    } catch (error) {
      remote = [];
      elsewhereStatusEl.textContent = `Your links could not be listed: ${(error as Error).message}`;
    }

    renderElsewhere();
  };

  /** Opens a link published elsewhere as a new document, still linked */
  async function openLink(path: string, name: string) {
    await withSession(
      async ({ access_token }) => {
        const custom = await asDocument(await downloadLink(access_token, path));

        if (!addDocument(store, { name, custom, link: path }))
          return 'your browser blocks storage';

        opened();
        announce(`Opened ${name}`);

        return null;
      },
      'Not opened',
      elsewhereStatusEl
    );
    void loadElsewhere();
  }

  /** Whether the current document's link changed elsewhere since */
  const check = () => {
    const { id, link, valid } = currentDocument();

    if (!signedIn || !link || !valid) return;

    void withSession(async ({ access_token }) => {
      const [published, ours] = await Promise.all([
        downloadLink(access_token, link),
        tokensStudio(valid)
      ]);

      if (!sameJson(published, ours) && id === currentDocument().id) {
        conflict = id;
        window.clearTimeout(timer);
        announce('The published version differs from this one');
      }

      return null;
    }, 'Not checked');
  };

  usePublishedEl.addEventListener('click', () =>
    withSession(async ({ access_token }) => {
      const { link } = currentDocument();

      if (!link) return null;

      conflict = null;
      await replace(await asDocument(await downloadLink(access_token, link)));
      statusEl.textContent = 'Using the published version';

      return null;
    }, 'Not loaded')
  );
  keepEl.addEventListener('click', () => {
    const { id } = currentDocument();

    conflict = null;
    void update(id);
  });
  copyEl.addEventListener('click', () => {
    navigator.clipboard
      ?.writeText(urlEl.value)
      .then(() => announce('Copied the link'))
      .catch(() => announce('Your browser did not allow copying'));
  });
  window.addEventListener(ACCOUNT_EVENT, (event) => {
    signedIn = Boolean((event as CustomEvent<Session | null>).detail);

    if (!signedIn) window.clearTimeout(timer);

    refresh();
    void loadElsewhere();
    check();
  });
  refresh();

  return {
    /** After switching documents */
    show: () => {
      statusEl.textContent = '';
      refresh();
      renderElsewhere();
      check();
    },
    /** After a version without problems is saved: update the link soon */
    edited: () => {
      refresh();

      const { id, link } = currentDocument();

      // A link changed elsewhere waits until you choose a version
      if (!signedIn || !link || conflict === id) return;

      window.clearTimeout(timer);
      timer = window.setTimeout(() => void update(id), DELAY);
    },
    /** Whether a document's link can be unpublished from here */
    canUnpublish: (saved: SavedDocument) => signedIn && Boolean(saved.link),
    /** Unpublishes a document's link, before the document is deleted */
    unpublish: async (saved: SavedDocument) => {
      await withSession(async ({ access_token }) =>
        saved.link ? removeLink(access_token, saved.link) : null
      );
      void loadElsewhere();
    }
  };
};
