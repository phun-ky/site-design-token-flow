import {
  validateTokens,
  type DTCGDocument,
  type FlatDesignToken
} from '../tokens';

/**
 * The tokens you edit in the playground, kept in your browser's
 * `localStorage` so they are there when you come back, and shown in the flow
 * view. Nothing is sent anywhere.
 */

export const STORAGE_KEY = 'dtf-demo';

export type Preset = 'showcase' | 'bundled' | 'custom';

export interface SavedState {
  /** The tokens the playground starts from */
  preset?: Preset;
  /** The JSON you are editing, problems and all */
  custom?: string;
  /** The last version of `custom` without problems and with tokens */
  valid?: string;
}

/** The parts of `Storage` this module uses, so tests can pass their own */
export type TokenStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The browser's `localStorage`, or `null` when the browser blocks it, as some
 * do for a site's data in a private window or with cookies blocked.
 *
 * @returns {TokenStorage | null} The storage, or null
 */
export const browserStorage = (): TokenStorage | null => {
  try {
    const storage = window.localStorage;

    // Reading throws, or returns null, where storage is blocked
    storage.getItem(STORAGE_KEY);

    return storage;
  } catch {
    return null;
  }
};

const isString = (value: unknown): value is string => typeof value === 'string';

/**
 * Reads the saved state. Anything saved that isn't what this version
 * expects, such as data from an older version or edited by hand, is left out.
 *
 * @param {TokenStorage | null} storage Where it is saved
 * @returns {SavedState} The state, empty when nothing usable is saved
 */
export const readSaved = (storage: TokenStorage | null): SavedState => {
  let saved: unknown;

  try {
    saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }

  if (typeof saved !== 'object' || saved === null) return {};

  const { preset, custom, valid } = saved as Record<string, unknown>;

  return {
    ...(['showcase', 'bundled', 'custom'].includes(preset as string) && {
      preset: preset as Preset
    }),
    ...(isString(custom) && { custom }),
    ...(isString(valid) && { valid })
  };
};

/**
 * Saves part of the state, keeping the rest.
 *
 * @param {TokenStorage | null} storage Where to save it
 * @param {SavedState} patch What to change
 * @returns {boolean} Whether it was saved: false when storage is blocked or full
 */
export const writeSaved = (
  storage: TokenStorage | null,
  patch: SavedState
): boolean => {
  if (!storage) return false;

  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...readSaved(storage), ...patch })
    );

    return true;
  } catch {
    return false;
  }
};

type Usable = { status: 'ok'; doc: DTCGDocument; tokens: FlatDesignToken[] };

/** Parses and validates token JSON */
const check = (
  json: string | undefined
): Usable | { status: 'missing' | 'empty' | 'problems' } => {
  if (json === undefined) return { status: 'missing' };

  try {
    const doc = JSON.parse(json) as DTCGDocument;
    const { tokens, problems } = validateTokens(doc);

    if (problems.length > 0) return { status: 'problems' };

    return tokens.length > 0
      ? { status: 'ok', doc, tokens }
      : { status: 'empty' };
  } catch {
    return { status: 'problems' };
  }
};

/**
 * What the flow view shows:
 * - `yours`: the tokens you edit in the playground, or when those have
 *   problems, the last version without (`latest` is false then)
 * - `example`: the bundled tokens, because you chose them (`chosen`), have
 *   no tokens of your own (`none`, an empty document included), your tokens
 *   have problems and no earlier version is saved (`problems`), or the browser
 *   blocks storage (`blocked`)
 */
export interface YourTokens {
  kind: 'yours';
  doc: DTCGDocument;
  tokens: FlatDesignToken[];
  latest: boolean;
}

export interface ExampleTokens {
  kind: 'example';
  reason: 'chosen' | 'none' | 'problems' | 'blocked';
  /** When you chose the example: how many tokens you have */
  yours?: number;
}

export type FlowTokens = YourTokens | ExampleTokens;

/**
 * Chooses the tokens the flow view shows.
 *
 * @param {TokenStorage | null} storage Where the playground saves your tokens
 * @param {boolean} example Whether you asked for the example tokens
 * @returns {FlowTokens} Your tokens, or why the example is shown
 * @example
 * chooseFlowTokens(browserStorage(), location.search.includes('tokens=example'));
 */
export const chooseFlowTokens = (
  storage: TokenStorage | null,
  example: boolean
): FlowTokens => {
  if (!storage) return { kind: 'example', reason: 'blocked' };

  const { custom, valid } = readSaved(storage);
  const latest = check(custom);
  const earlier = check(valid);
  // Your latest edits, or the last version of them without problems
  const found = [latest, earlier].find(
    (checked): checked is Usable => checked.status === 'ok'
  );

  if (!found)
    return {
      kind: 'example',
      reason: latest.status === 'problems' ? 'problems' : 'none'
    };

  if (example)
    return { kind: 'example', reason: 'chosen', yours: found.tokens.length };

  return {
    kind: 'yours',
    doc: found.doc,
    tokens: found.tokens,
    latest: found === latest
  };
};
