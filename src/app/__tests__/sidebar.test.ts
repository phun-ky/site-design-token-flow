import 'global-jsdom/register';

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  COLLAPSED_CLASS,
  COLLAPSED_VALUE,
  mountSidebarCollapse,
  readCollapsed,
  saveCollapsed
} from '../sidebar';

const KEY = 'dtf-sidebar-test';
const throwing = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  }
};

describe('sidebar', () => {
  afterEach(() => {
    document.documentElement.classList.remove(COLLAPSED_CLASS);
    document.body.replaceChildren();
    localStorage.clear();
  });

  it('remembers and forgets the collapsed state', () => {
    assert.equal(readCollapsed(KEY), false);
    saveCollapsed(KEY, true);
    assert.equal(localStorage.getItem(KEY), COLLAPSED_VALUE);
    assert.equal(readCollapsed(KEY), true);
    saveCollapsed(KEY, false);
    assert.equal(localStorage.getItem(KEY), null);
    assert.equal(readCollapsed(KEY), false);
  });

  it('counts storage that throws as expanded, and ignores it when saving', () => {
    assert.equal(readCollapsed(KEY, throwing), false);
    assert.doesNotThrow(() => saveCollapsed(KEY, true, throwing));
  });

  it('collapses and expands with the button, and says so', () => {
    const button = document.createElement('button');
    const seen: boolean[] = [];

    document.body.append(button);
    mountSidebarCollapse(button, KEY, (collapsed) => seen.push(collapsed));

    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.equal(button.title, 'Collapse the sidebar');
    assert.ok(button.querySelector('svg[aria-hidden="true"]'));

    button.click();
    assert.ok(document.documentElement.classList.contains(COLLAPSED_CLASS));
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(button.title, 'Expand the sidebar');
    assert.equal(readCollapsed(KEY), true);

    button.click();
    assert.ok(!document.documentElement.classList.contains(COLLAPSED_CLASS));
    assert.equal(readCollapsed(KEY), false);
    assert.deepEqual(seen, [true, false]);
  });

  it('starts as the page was painted, from the head script', () => {
    const button = document.createElement('button');

    document.documentElement.classList.add(COLLAPSED_CLASS);
    mountSidebarCollapse(button, KEY);
    assert.equal(button.getAttribute('aria-expanded'), 'false');
  });
});
