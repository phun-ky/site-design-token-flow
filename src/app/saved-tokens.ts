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

/** A token document in the playground (#149), kept in this browser */
export interface SavedDocument {
  id: string;
  name: string;
  /** The JSON you are editing, problems and all */
  custom?: string;
  /** The last version of `custom` without problems and with tokens */
  valid?: string;
  /** Where it is published for Tokens Studio (#145): `<user id>/<share id>.json` */
  link?: string;
}

/**
 * The document you have before making any. State saved before documents
 * existed is read as this one, so nobody loses their tokens.
 */
export const FIRST_DOCUMENT: SavedDocument = {
  id: 'yours',
  name: 'Your tokens'
};

interface Stored {
  preset?: Preset;
  /** The document the playground edits, and the flow view shows */
  current?: string;
  documents: SavedDocument[];
}

const isDocument = (value: unknown): value is SavedDocument => {
  const { id, name, custom, valid, link } = (value ?? {}) as Record<
    string,
    unknown
  >;

  return (
    isString(id) &&
    isString(name) &&
    [custom, valid, link].every(
      (field) => field === undefined || isString(field)
    )
  );
};
/**
 * Reads everything saved. Anything that isn't what this version expects,
 * such as data edited by hand, is left out.
 */
const readStored = (storage: TokenStorage | null): Stored => {
  let saved: unknown;

  try {
    saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return { documents: [] };
  }

  if (typeof saved !== 'object' || saved === null) return { documents: [] };

  const { preset, current, documents, custom, valid } = saved as Record<
    string,
    unknown
  >;

  let list: SavedDocument[] = [];

  if (Array.isArray(documents)) {
    list = documents
      .filter(isDocument)
      .map(({ id, name, custom, valid, link }) => ({
        id,
        name,
        ...(custom !== undefined && { custom }),
        ...(valid !== undefined && { valid }),
        ...(link !== undefined && { link })
      }));
  } else if (isString(custom) || isString(valid)) {
    // Saved before there were documents: one document
    list = [
      {
        ...FIRST_DOCUMENT,
        ...(isString(custom) && { custom }),
        ...(isString(valid) && { valid })
      }
    ];
  }

  return {
    ...(['showcase', 'bundled', 'custom'].includes(preset as string) && {
      preset: preset as Preset
    }),
    current: list.some((document) => document.id === current)
      ? (current as string)
      : list[0]?.id,
    documents: list
  };
};
const writeStored = (storage: TokenStorage | null, stored: Stored) => {
  if (!storage) return false;

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(stored));

    return true;
  } catch {
    return false;
  }
};

/**
 * Your documents, and which one is current. With none saved yet, the first
 * document, empty.
 *
 * @param {TokenStorage | null} storage Where they are saved
 * @returns {{ documents: SavedDocument[]; current: string }} The documents
 */
export const listDocuments = (
  storage: TokenStorage | null
): { documents: SavedDocument[]; current: string } => {
  const { documents, current } = readStored(storage);

  return documents.length > 0 && current
    ? { documents, current }
    : { documents: [{ ...FIRST_DOCUMENT }], current: FIRST_DOCUMENT.id };
};

/**
 * Reads the saved state: the preset, and the current document's JSON.
 *
 * @param {TokenStorage | null} storage Where it is saved
 * @returns {SavedState} The state, empty when nothing usable is saved
 */
export const readSaved = (storage: TokenStorage | null): SavedState => {
  const { preset, current, documents } = readStored(storage);
  const document = documents.find(({ id }) => id === current);

  return {
    ...(preset && { preset }),
    ...(document?.custom !== undefined && { custom: document.custom }),
    ...(document?.valid !== undefined && { valid: document.valid })
  };
};

/**
 * Saves part of the state, keeping the rest: the preset, or the current
 * document's JSON.
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

  const stored = readStored(storage);
  const { preset, ...json } = patch;

  if (preset) stored.preset = preset;

  if (Object.keys(json).length > 0) {
    let document = stored.documents.find(({ id }) => id === stored.current);

    if (!document) {
      document = { ...FIRST_DOCUMENT };
      stored.documents.push(document);
      stored.current = document.id;
    }

    Object.assign(document, json);
  }

  return writeStored(storage, stored);
};

/** The documents as listed, saved, so changes to them are kept */
const storedDocuments = (storage: TokenStorage | null): Stored => {
  const stored = readStored(storage);
  const { documents, current } = listDocuments(storage);

  return { ...stored, documents, current };
};

/**
 * Adds a document and makes it current: empty, or with what is given, such
 * as a link opened from another device (#146).
 *
 * @param {TokenStorage | null} storage Where to save it
 * @param {object} [given] The name, JSON and link, when not a new empty one
 * @param {string} [given.name] The name; a free "Your tokens n" without one
 * @param {string} [given.custom] The JSON
 * @param {string} [given.link] Where it is published
 * @returns {SavedDocument | null} The document, or null when it can't be saved
 */
export const addDocument = (
  storage: TokenStorage | null,
  given: Pick<SavedDocument, 'custom' | 'link'> & { name?: string } = {}
): SavedDocument | null => {
  const stored = storedDocuments(storage);
  const names = new Set(stored.documents.map(({ name }) => name));
  const base = given.name?.trim();

  // Its own name while free, or numbered: "Your tokens 3", "Brand 2"
  let n = base ? 1 : stored.documents.length + 1;

  const numbered = () =>
    base && n === 1 ? base : `${base || FIRST_DOCUMENT.name} ${n}`;

  while (names.has(numbered())) n += 1;

  const document: SavedDocument = {
    id: crypto.randomUUID(),
    name: numbered(),
    custom: given.custom ?? '{}',
    ...(given.link && { link: given.link })
  };

  stored.documents.push(document);
  stored.current = document.id;

  return writeStored(storage, stored) ? document : null;
};

/**
 * Makes a document current.
 *
 * @param {TokenStorage | null} storage Where it is saved
 * @param {string} id The document
 * @returns {boolean} Whether it was saved
 */
export const switchDocument = (
  storage: TokenStorage | null,
  id: string
): boolean => {
  const stored = storedDocuments(storage);

  if (!stored.documents.some((document) => document.id === id)) return false;

  return writeStored(storage, { ...stored, current: id });
};

/**
 * Renames a document. A blank name keeps the old one.
 *
 * @param {TokenStorage | null} storage Where it is saved
 * @param {string} id The document
 * @param {string} name The new name
 * @returns {boolean} Whether it was saved
 */
export const renameDocument = (
  storage: TokenStorage | null,
  id: string,
  name: string
): boolean => {
  const stored = storedDocuments(storage);
  const document = stored.documents.find((saved) => saved.id === id);

  if (!document || !name.trim()) return false;

  document.name = name.trim();

  return writeStored(storage, stored);
};

/**
 * Deletes a document. The first one left becomes current; deleting the last
 * leaves the first document, empty.
 *
 * @param {TokenStorage | null} storage Where it is saved
 * @param {string} id The document
 * @returns {boolean} Whether it was saved
 */
export const deleteDocument = (
  storage: TokenStorage | null,
  id: string
): boolean => {
  const stored = storedDocuments(storage);
  const documents = stored.documents.filter((document) => document.id !== id);

  return writeStored(storage, {
    ...stored,
    documents,
    current: documents[0]?.id
  });
};

/**
 * Puts a deleted document back where it was, as current: undoing a delete
 * (#156).
 *
 * @param {TokenStorage | null} storage Where it is saved
 * @param {SavedDocument} document The document as it was
 * @param {number} index Where it was in the list
 * @returns {boolean} Whether it was saved
 */
export const restoreDocument = (
  storage: TokenStorage | null,
  document: SavedDocument,
  index: number
): boolean => {
  const { documents, ...stored } = readStored(storage);
  const others = documents.filter(({ id }) => id !== document.id);

  others.splice(Math.min(index, others.length), 0, document);

  return writeStored(storage, {
    ...stored,
    documents: others,
    current: document.id
  });
};

/**
 * Sets or clears where a document is published.
 *
 * @param {TokenStorage | null} storage Where it is saved
 * @param {string} id The document
 * @param {string | undefined} link `<user id>/<share id>.json`, or undefined once unpublished
 * @returns {boolean} Whether it was saved
 */
export const setDocumentLink = (
  storage: TokenStorage | null,
  id: string,
  link: string | undefined
): boolean => {
  const stored = storedDocuments(storage);
  const document = stored.documents.find((saved) => saved.id === id);

  if (!document) return false;

  if (link) document.link = link;
  else delete document.link;

  return writeStored(storage, stored);
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
 * What the flow view shows: what the playground has chosen, one choice for
 * both views.
 * - `preset`: the showcase or the example file
 * - `yours`: the current document, or when its latest edits have problems,
 *   its last version without (`latest` is false then)
 * - `example`: the example file instead of the current document, because the
 *   document has no tokens (`none`), has problems and no earlier version is
 *   saved (`problems`), or the browser blocks storage (`blocked`)
 */
export interface PresetTokens {
  kind: 'preset';
  preset: Exclude<Preset, 'custom'>;
}

export interface YourTokens {
  kind: 'yours';
  doc: DTCGDocument;
  tokens: FlatDesignToken[];
  latest: boolean;
  /** The document's name */
  name: string;
}

export interface ExampleTokens {
  kind: 'example';
  reason: 'none' | 'problems' | 'blocked';
  /** The current document's name, when there is one */
  name?: string;
}

export type FlowTokens = PresetTokens | YourTokens | ExampleTokens;

/**
 * Chooses the tokens the flow view shows: what the playground has chosen,
 * the showcase when nothing is chosen yet, as in the playground.
 *
 * @param {TokenStorage | null} storage Where the playground saves its choice
 * @returns {FlowTokens} The tokens, or why the example is shown instead
 * @example
 * chooseFlowTokens(browserStorage());
 */
export const chooseFlowTokens = (storage: TokenStorage | null): FlowTokens => {
  if (!storage) return { kind: 'example', reason: 'blocked' };

  const { preset = 'showcase', custom, valid } = readSaved(storage);

  if (preset !== 'custom') return { kind: 'preset', preset };

  const { documents, current } = listDocuments(storage);
  const name =
    documents.find(({ id }) => id === current)?.name ?? FIRST_DOCUMENT.name;
  const latest = check(custom);
  const earlier = check(valid);
  // Your latest edits, or the last version of them without problems
  const found = [latest, earlier].find(
    (checked): checked is Usable => checked.status === 'ok'
  );

  if (!found)
    return {
      kind: 'example',
      reason: latest.status === 'problems' ? 'problems' : 'none',
      name
    };

  return {
    kind: 'yours',
    doc: found.doc,
    tokens: found.tokens,
    latest: found === latest,
    name
  };
};

/** A document as the flow lists it */
export interface FlowDocument {
  id: string;
  name: string;
  /** How many tokens the flow would show for it */
  tokens: number;
  /** Whether it has problems and no earlier version without */
  problems: boolean;
}

/**
 * Your documents, for the flow's list of what it can show.
 *
 * @param {TokenStorage | null} storage Where they are saved
 * @returns {{ documents: FlowDocument[]; current: string }} The documents
 * and the current one
 */
export const listFlowDocuments = (
  storage: TokenStorage | null
): { documents: FlowDocument[]; current: string } => {
  const { documents, current } = listDocuments(storage);

  return {
    current,
    documents: documents.map(({ id, name, custom, valid }) => {
      const latest = check(custom);
      const found = [latest, check(valid)].find(
        (checked): checked is Usable => checked.status === 'ok'
      );

      return {
        id,
        name,
        tokens: found?.tokens.length ?? 0,
        problems: !found && latest.status === 'problems'
      };
    })
  };
};
