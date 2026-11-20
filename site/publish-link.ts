// A document's link for Tokens Studio (#145), under its name in the
// playground's sidebar: publish, copy, change and unpublish, and keep it up to
// date about 2 seconds after the last edit without problems.
import type { Session } from '@supabase/auth-js';

import { ACCOUNT_EVENT, freshSession } from '../src/app/account';
import { checkTokenText } from '../src/app/check-tokens';
import {
  LINK_LIMIT,
  countLinks,
  newLinkPath,
  publicUrl,
  removeLink,
  uploadLink
} from '../src/app/published-links';
import {
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
 * @returns The playground's handles: `show` after switching documents,
 * `edited` after a version without problems is saved, and `unpublish` for a
 * document being deleted
 */
export const mountPublishLink = (
  store: TokenStorage | null,
  announce: (message: string) => void
) => {
  const hintEl = $<HTMLParagraphElement>('#link-hint');
  const publishedEl = $<HTMLDivElement>('#link-published');
  const urlEl = $<HTMLInputElement>('#link-url');
  const copyEl = $<HTMLButtonElement>('#link-copy');
  const publishEl = $<HTMLButtonElement>('#link-publish');
  const changeEl = $<HTMLButtonElement>('#link-change');
  const unpublishEl = $<HTMLButtonElement>('#link-unpublish');
  const statusEl = $<HTMLParagraphElement>('#link-status');

  let signedIn = false;
  let busy = false;
  let timer: number | undefined;

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
    step: (session: Session) => Promise<string | null>
  ) => {
    busy = true;
    refresh();

    try {
      const session = await freshSession();
      const failed = session ? await step(session) : 'sign in again';

      if (failed) statusEl.textContent = `Not published: ${failed}`;
    } catch (error) {
      statusEl.textContent = `Not published: ${(error as Error).message}`;
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
        await tokensStudio(saved.valid)
      );

      if (!failed && id === currentDocument().id)
        published('Updated the link for Tokens Studio');

      return failed;
    });

  publishEl.addEventListener('click', () =>
    withSession(async ({ access_token, user }) => {
      const { id, valid } = currentDocument();

      if (!valid) return 'add tokens without problems first';

      // The Storage policy refuses more, this only says why
      if ((await countLinks(access_token, user.id)) >= LINK_LIMIT)
        return `${LINK_LIMIT} links is the limit for now`;

      const path = newLinkPath(user.id);
      const failed = await uploadLink(
        access_token,
        path,
        await tokensStudio(valid)
      );

      if (failed) return failed;

      setDocumentLink(store, id, path);
      published('Published the link for Tokens Studio');

      return null;
    })
  );
  // A new share id: the old link stops working. The old file goes first, so
  // changing a link works at the limit too
  changeEl.addEventListener('click', () =>
    withSession(async ({ access_token, user }) => {
      const { id, link, valid } = currentDocument();

      if (!link || !valid) return null;

      const removed = await removeLink(access_token, link);

      if (removed) return removed;

      setDocumentLink(store, id, undefined);

      const path = newLinkPath(user.id);
      const failed = await uploadLink(
        access_token,
        path,
        await tokensStudio(valid)
      );

      if (failed) return `the old link is unpublished: ${failed}`;

      setDocumentLink(store, id, path);
      published('Changed the link for Tokens Studio');

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

      return null;
    })
  );
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
  });
  refresh();

  return {
    /** After switching documents */
    show: () => {
      statusEl.textContent = '';
      refresh();
    },
    /** After a version without problems is saved: update the link soon */
    edited: () => {
      refresh();

      const { id, link } = currentDocument();

      if (!signedIn || !link) return;

      window.clearTimeout(timer);
      timer = window.setTimeout(() => void update(id), DELAY);
    },
    /** Whether a document's link can be unpublished from here */
    canUnpublish: (saved: SavedDocument) => signedIn && Boolean(saved.link),
    /** Unpublishes a document's link, before the document is deleted */
    unpublish: (saved: SavedDocument) =>
      withSession(async ({ access_token }) =>
        saved.link ? removeLink(access_token, saved.link) : null
      )
  };
};
