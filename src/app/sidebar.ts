/**
 * A sidebar that collapses to a narrow rail on wide screens (#120), on the
 * flow view and the playground. Each page remembers its own state; the
 * inline script in the page's `<head>` reads the same key and adds
 * `COLLAPSED_CLASS` before the first paint, so the page does not jump.
 */

/** On `<html>` while the sidebar is collapsed; the page's CSS draws the rail */
export const COLLAPSED_CLASS = 'sidebar-collapsed';

/** The value stored under a page's key while its sidebar is collapsed */
export const COLLAPSED_VALUE = 'collapsed';

/**
 * Whether the sidebar under `key` was left collapsed. Storage that throws
 * (private mode, blocked site data) counts as expanded.
 *
 * @param {string} key The page's localStorage key
 * @param {Pick<Storage, 'getItem'>} [storage] Where it is kept
 * @returns {boolean} True when collapsed
 */
export const readCollapsed = (
  key: string,
  storage: Pick<Storage, 'getItem'> = localStorage
): boolean => {
  try {
    return storage.getItem(key) === COLLAPSED_VALUE;
  } catch {
    return false;
  }
};

/**
 * Remembers whether the sidebar under `key` is collapsed. Storage that
 * throws is ignored: the sidebar still collapses, for this visit.
 *
 * @param {string} key The page's localStorage key
 * @param {boolean} collapsed Whether it is collapsed
 * @param {Pick<Storage, 'setItem' | 'removeItem'>} [storage] Where it is kept
 */
export const saveCollapsed = (
  key: string,
  collapsed: boolean,
  storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage
): void => {
  try {
    if (collapsed) storage.setItem(key, COLLAPSED_VALUE);
    else storage.removeItem(key);
  } catch {
    // Unavailable storage: nothing to remember
  }
};

const ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><rect x="4" y="5" width="16" height="14"/><path d="M10 5v14"/></g></svg>';

/**
 * Makes `button` collapse and expand the sidebar. The button says whether
 * the sidebar is expanded with `aria-expanded`, and its tooltip says what a
 * press does.
 *
 * @param {HTMLButtonElement} button The button at the top of the sidebar
 * @param {string} key The page's localStorage key
 * @param {(collapsed: boolean) => void} [onChange] Called after each press
 */
export const mountSidebarCollapse = (
  button: HTMLButtonElement,
  key: string,
  onChange?: (collapsed: boolean) => void
): void => {
  const root = document.documentElement;
  const show = (collapsed: boolean) => {
    root.classList.toggle(COLLAPSED_CLASS, collapsed);
    button.setAttribute('aria-expanded', String(!collapsed));
    button.title = collapsed ? 'Expand the sidebar' : 'Collapse the sidebar';
  };

  button.innerHTML = ICON;
  show(root.classList.contains(COLLAPSED_CLASS));
  button.addEventListener('click', () => {
    const collapsed = !root.classList.contains(COLLAPSED_CLASS);

    show(collapsed);
    saveCollapsed(key, collapsed);
    onChange?.(collapsed);
  });
};
