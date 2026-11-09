'use strict';

import { Arclace, type ArcConnectionDefinitionType } from '@phun-ky/arclace';

import { describeFlowSource } from './app/flow-source';
import { loadFonts } from './app/fonts';
import { mountHeader } from './app/header';
import { browserStorage, chooseFlowTokens } from './app/saved-tokens';
import { createZoom, mountZoomControls } from './app/zoom';
import exampleTokens from './assets/data/design-tokens.tokens.json';
import DesignToken from './classes/DesignToken';
import {
  FlowLane,
  layoutTokens,
  LooseLane,
  TokenGroup
} from './layout/layout-tokens';
import {
  DTCGDocument,
  FlatDesignToken,
  flattenTokens,
  getFontFaces
} from './tokens';
import * as node from './utils/node';

/** Column heading for an alias depth: 0 is literal values */
const columnLabel = (depth: number): string =>
  depth === 0 ? 'Values' : `Alias level ${depth}`;

/** The flow view: lays the tokens out and draws the lines between them */
interface DTFInstance {
  _flat_tokens: FlatDesignToken[];
  _tokens: DesignToken[];
  _container_el: HTMLElement;
  _arclace: Arclace;
  _init(): void;
  _setup_tokens(): void;
  _process_tokens(): void;
  _align_columns(): void;
  _connect_tokens(): void;
  _create_token(token: FlatDesignToken): HTMLElement;
  _create_group(group: TokenGroup): HTMLElement;
  _create_flow(lanes: FlowLane[], columnCount: number): HTMLElement;
  _create_loose(lanes: LooseLane[]): HTMLElement;
}

// Takes tokens already checked, so a large file isn't checked twice
const DTF = function (this: DTFInstance, flat_tokens: FlatDesignToken[]) {
  this._flat_tokens = flat_tokens;
  this._tokens = <DesignToken[]>[];
  this._init();
} as unknown as {
  new (flat_tokens: FlatDesignToken[]): DTFInstance;
  prototype: DTFInstance;
};

DTF.prototype._process_tokens = function (this: DTFInstance) {
  this._tokens.forEach((token: DesignToken) => {
    token.process();
  });
};

DTF.prototype._create_token = function (
  this: DTFInstance,
  token: FlatDesignToken
): HTMLElement {
  const _design_token = new DesignToken(token);

  this._tokens.push(_design_token);

  return _design_token.el;
};

DTF.prototype._create_group = function (
  this: DTFInstance,
  group: TokenGroup
): HTMLElement {
  const _group_el = node.create({ type: 'section', classNames: 'token-group' });
  const _list_el = node.create({ type: 'div', classNames: 'token-group-list' });

  group.tokens.forEach((token) =>
    _list_el.appendChild(this._create_token(token))
  );
  _group_el.append(
    node.create({
      type: 'h4',
      classNames: 'token-group-label',
      textContent: group.label
    }),
    _list_el
  );

  return _group_el;
};

/**
 * Inheritance: one stack of tokens per alias depth, most derived on the left, values on
 * the right. Every stack uses the same gap between tokens. Stacks are filled lane by lane
 * (inheritance tree by tree), so each token sits near the tokens it inherits from.
 */
DTF.prototype._create_flow = function (
  this: DTFInstance,
  lanes: FlowLane[],
  columnCount: number
): HTMLElement {
  const _section_el = node.create({ type: 'section', classNames: 'flow' });
  const _header_el = node.create({
    type: 'div',
    classNames: 'flow-row flow-header'
  });
  const _columns_el = node.create({ type: 'div', classNames: 'flow-row' });

  _section_el.setAttribute('aria-label', 'Inheritance');
  // The header and the stacks use the section's columns (subgrid), so they line up
  _section_el.style.setProperty('--flow-columns', String(columnCount));

  Array.from({ length: columnCount }, (_, column) => {
    const _column_el = node.create({ type: 'div', classNames: 'flow-column' });

    _header_el.appendChild(
      node.create({
        type: 'span',
        classNames: 'column-label',
        textContent: columnLabel(columnCount - 1 - column)
      })
    );
    lanes.forEach((lane) =>
      lane.columns[column].forEach((token) =>
        _column_el.appendChild(this._create_token(token))
      )
    );
    _columns_el.appendChild(_column_el);
  });

  _section_el.append(
    node.create({
      type: 'h2',
      classNames: 'section-label',
      textContent: 'Inheritance'
    }),
    _header_el,
    _columns_el
  );

  return _section_el;
};

/**
 * Tokens without any alias relation, in wrapped groups per type.
 */
DTF.prototype._create_loose = function (
  this: DTFInstance,
  lanes: LooseLane[]
): HTMLElement {
  const _section_el = node.create({ type: 'section', classNames: 'loose' });

  _section_el.appendChild(
    node.create({
      type: 'h2',
      classNames: 'section-label',
      textContent: 'Unconnected'
    })
  );
  lanes.forEach((lane) => {
    const _lane_el = node.create({ type: 'section', classNames: 'lane-loose' });
    const _groups_el = node.create({ type: 'div', classNames: 'lane-groups' });

    _lane_el.dataset.lane = lane.key;
    lane.groups.forEach((group) =>
      _groups_el.appendChild(this._create_group(group))
    );
    _lane_el.append(
      node.create({
        type: 'h3',
        classNames: 'lane-label',
        textContent: lane.label
      }),
      _groups_el
    );
    _section_el.appendChild(_lane_el);
  });

  return _section_el;
};

DTF.prototype._setup_tokens = function (this: DTFInstance) {
  const { columnCount, flow, loose } = layoutTokens(this._flat_tokens);

  if (flow.length)
    this._container_el.appendChild(this._create_flow(flow, columnCount));

  if (loose.length) this._container_el.appendChild(this._create_loose(loose));
};

/**
 * Moves each stack of aliases vertically, as a whole, so its tokens line up on average
 * with the tokens they inherit from. Gaps inside a stack stay the same. Runs from the
 * values outwards, so every stack aligns with already placed ancestors, and keeps each
 * stack within the rows the columns share.
 */
DTF.prototype._align_columns = function (this: DTFInstance) {
  const _row_el = this._container_el.querySelector(
    '.flow-row:not(.flow-header)'
  ) as HTMLElement | null;

  if (!_row_el) return;

  const _by_id = new Map<string, HTMLElement>(
    this._tokens.map((token: DesignToken) => [token.id, token.el])
  );
  const _center = (el: HTMLElement) => {
    const _rect = el.getBoundingClientRect();

    return _rect.top + _rect.height / 2;
  };
  const _mean = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const _columns = [..._row_el.children] as HTMLElement[];

  _columns
    .slice(0, -1)
    .reverse()
    .forEach((column) => {
      const _pills = [...column.children] as HTMLElement[];
      const _ancestor_centers = _pills.flatMap((pill) =>
        (pill.dataset.ancestors ?? '')
          .split(',')
          .map((id) => _by_id.get(id))
          .filter((el): el is HTMLElement => !!el)
          .map(_center)
      );

      if (!_pills.length || !_ancestor_centers.length) return;

      const _row = _row_el.getBoundingClientRect();
      const _rect = column.getBoundingClientRect();
      const _offset = _mean(_ancestor_centers) - _mean(_pills.map(_center));
      const _clamped = Math.min(
        Math.max(_offset, _row.top - _rect.top),
        _row.bottom - _rect.bottom
      );

      column.style.transform = `translateY(${_clamped}px)`;
    });
};

/**
 * Draws a line from every rendered token to each rendered token it references.
 * Arclace keeps the lines in sync with resizes, scrolling and DOM changes.
 * The lines are added in one go: connecting them one by one redraws every
 * line so far each time, which takes seconds with a large token file (#103).
 */
DTF.prototype._connect_tokens = function (this: DTFInstance) {
  const _by_id = new Map<string, DesignToken>(
    this._tokens.map((token: DesignToken) => [token.id, token])
  );
  const _connections: ArcConnectionDefinitionType[] = [];

  this._tokens.forEach((token: DesignToken) => {
    token.token.ancestors.forEach((ancestor_id) => {
      const _start_token = _by_id.get(ancestor_id);

      if (!_start_token) return;

      _connections.push({
        startElement: _start_token.el,
        endElement: token.el,
        id: `${ancestor_id}--${token.id}`,
        className: 'dtf-line'
      });
      _start_token.el.classList.add('is-connected');
      token.el.classList.add('is-connected');
    });
  });
  this._arclace.connectAll(_connections);
};

DTF.prototype._init = function (this: DTFInstance) {
  const container = document.querySelector<HTMLElement>('.container');

  if (!container) throw new Error('The flow view needs a .container element');

  this._container_el = container;
  this._setup_tokens();
  this._align_columns();
  this._arclace = new Arclace({
    container: this._container_el,
    // Lines start at the ancestor, which is always in a column to the right of the token using it
    defaults: { strokeWidth: 1.5, startSide: 'left', endSide: 'right' }
  });
  this._connect_tokens();
  this._process_tokens();
};

mountHeader();

// Your tokens from the playground, saved in this browser, or the example
const flowTokens = chooseFlowTokens(
  browserStorage(),
  new URLSearchParams(window.location.search).get('tokens') === 'example'
);
const example = flattenTokens(exampleTokens as DTCGDocument);
const tokens = flowTokens.kind === 'yours' ? flowTokens.tokens : example;
const lines = tokens.reduce((sum, token) => sum + token.ancestors.length, 0);
const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? '' : 's'}`;
/** The sidebar: which tokens are shown, why, and where to change them */
const showSource = () => {
  const { options, note, links } = describeFlowSource(
    flowTokens,
    example.length
  );
  const showingEl = document.querySelector('#tokens-showing');
  const sourceEl = document.querySelector<HTMLElement>('#tokens-source');

  showingEl?.replaceChildren(
    ...options.map(({ label, detail, href, current }) => {
      const item = document.createElement('li');
      // The tokens shown aren't a link to themselves
      const option = document.createElement(current ? 'span' : 'a');
      const small = document.createElement('small');

      if (current) option.setAttribute('aria-current', 'true');
      else (option as HTMLAnchorElement).href = href;

      small.textContent = detail;
      option.append(label, small);
      item.append(option);

      return item;
    })
  );

  if (!sourceEl) return;

  const parts: Node[] = links.map(({ label, href }) => {
    const link = document.createElement('a');

    link.href = href;
    link.textContent = label;

    return link;
  });

  if (note) parts.unshift(document.createTextNode(note));

  sourceEl.replaceChildren(...parts);
  sourceEl.hidden = parts.length === 0;
};
// On a phone the sidebar folds into a bar; its button opens it
const sidebarEl = document.querySelector<HTMLElement>('#flow-sidebar');
const toggleEl = document.querySelector<HTMLButtonElement>(
  '.app-sidebar-toggle'
);

toggleEl?.addEventListener('click', () => {
  const open = sidebarEl?.classList.toggle('is-open') ?? false;

  toggleEl.setAttribute('aria-expanded', String(open));
});
showSource();

// Says what is being drawn before drawing it: a large flow takes a while,
// and the status shows when it takes more than 300 ms (#109)
const statusEl = document.querySelector<HTMLElement>('#flow-status');

if (statusEl)
  statusEl.textContent = `Drawing ${plural(tokens.length, 'token')} and ${plural(lines, 'line')}`;

// Two frames: the status is painted before the drawing blocks the page
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    new DTF(tokens);
    // The fonts the font tokens describe; each downloads when a pill first shows it
    loadFonts(getFontFaces(tokens));

    // The canvas: the wheel and dragging pan, Ctrl or Cmd and the wheel zoom. On a
    // phone it opens on the first token of the inheritance flow, at a readable scale
    mountZoomControls((onChange) =>
      createZoom(
        document.querySelector('.app-viewport') as HTMLElement,
        document.querySelector('.app-canvas') as HTMLElement,
        onChange,
        () => document.querySelector('.flow .flow-column .design-token')
      )
    );

    if (statusEl) statusEl.textContent = '';
  })
);
