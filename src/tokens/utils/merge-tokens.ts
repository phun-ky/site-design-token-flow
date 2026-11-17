import type { DTCGDocument } from '../types/tokens';

import { DTF_EXTENSION_KEY } from './design-tokens';
import type { TokensStudioDocument } from './tokens-studio';

/**
 * Merges one token document into another (#117): every token of `incoming`
 * is added, or overwrites the token of the same name. Adding one token with
 * the form (#116) is a merge of a document holding that token.
 */

type Json = Record<string, unknown>;

export interface Overwrite {
  name: string;
  /** The old value, or the old group when a token replaces a group */
  before: unknown;
  /** The new value; undefined when a group replaces the token */
  after: unknown;
}

export interface Merge {
  document: DTCGDocument;
  /** Names of the tokens added, in the incoming document's order */
  added: string[];
  overwritten: Overwrite[];
  /** Tokens already there exactly as the incoming document has them */
  unchanged: string[];
}

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isToken = (node: Json) => '$value' in node;
/** JSON with keys in order, to compare two tokens */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, part: unknown) =>
    isObject(part)
      ? Object.fromEntries(
          Object.entries(part).sort(([a], [b]) => (a < b ? -1 : 1))
        )
      : part
  );
/** The tokens of a document, each with the `$type` its groups give it */
const tokensOf = (
  node: Json,
  path: string[] = [],
  inherited?: unknown
): { path: string[]; token: Json }[] => {
  const type = node.$type ?? inherited;

  return Object.entries(node).flatMap(([key, child]) => {
    if ((key.startsWith('$') && key !== '$root') || !isObject(child)) return [];

    if (isToken(child))
      return [
        {
          path: [...path, key],
          token:
            child.$type === undefined && type !== undefined
              ? { $type: type, ...child }
              : child
        }
      ];

    return tokensOf(child, [...path, key], type);
  });
};
/** The groups of a document, the root first, each before its children */
const groupsOf = (
  node: Json,
  path: string[] = []
): { path: string[]; group: Json }[] => [
  { path, group: node },
  ...Object.entries(node).flatMap(([key, child]) =>
    key.startsWith('$') || !isObject(child) || isToken(child)
      ? []
      : groupsOf(child, [...path, key])
  )
];
/** The Tokens Studio details a converted document keeps for the export */
const studioOf = (document: Json) =>
  (
    (document.$extensions as Json | undefined)?.[DTF_EXTENSION_KEY] as
      Json | undefined
  )?.tokensStudio as TokensStudioDocument | undefined;
const isStudioToken = (node: Json) => 'value' in node || '$value' in node;
/** Two sets of Tokens Studio tokens in one; `later`'s tokens win */
const combineSets = (earlier: Json, later: Json): Json =>
  Object.fromEntries(
    [...new Set([...Object.keys(earlier), ...Object.keys(later)])].map(
      (key) => {
        const [a, b] = [earlier[key], later[key]];

        return [
          key,
          isObject(a) && isObject(b) && !isStudioToken(a) && !isStudioToken(b)
            ? combineSets(a, b)
            : key in later
              ? b
              : a
        ];
      }
    )
  );
/**
 * Both documents' Tokens Studio details in one, for the export (#129): your
 * sets and themes, then the file's; a set in both gets both sets' tokens,
 * and a theme in both is the file's.
 */
const combineStudio = (
  yours: TokensStudioDocument | undefined,
  file: TokensStudioDocument
): TokensStudioDocument =>
  yours
    ? {
        keyStyle: yours.keyStyle,
        hasSets: yours.hasSets || file.hasSets,
        order: [
          ...yours.order,
          ...file.order.filter((name) => !yours.order.includes(name))
        ],
        themes: [
          ...yours.themes.map(
            (theme) => file.themes.find(({ id }) => id === theme.id) ?? theme
          ),
          ...file.themes.filter(
            ({ id }) => !yours.themes.some((theme) => theme.id === id)
          )
        ],
        remainder: combineSets(yours.remainder, file.remainder) as Record<
          string,
          Json
        >,
        // Per set and group path, each property: the file's on a clash
        groups: combineSets(yours.groups, file.groups) as Record<
          string,
          Record<string, Json>
        >
      }
    : file;

/**
 * Merges `incoming` into a copy of `base`. Groups merge, and take the
 * incoming groups' `$extends`, `$description`, `$deprecated` and
 * `$extensions`; a token of the same name is overwritten, its value, type,
 * description and extensions, and `$root` tokens too. Each incoming token
 * takes the `$type` its own groups gave it, so a group type in one document
 * never changes tokens from the other. The rest of the root is `base`'s,
 * but for the Tokens Studio details both documents keep for the export,
 * which combine.
 *
 * @param {DTCGDocument} base The tokens you have
 * @param {DTCGDocument} incoming The tokens to add
 * @returns {Merge} The merged document, and what was added and overwritten
 * @example
 * mergeTokenDocuments(
 *   { color: { $type: 'color', red: { $value: '{color.base}' } } },
 *   { color: { $type: 'color', blue: { $value: '{color.base}' } } }
 * ).added; // => ['color.blue']
 */
export const mergeTokenDocuments = (
  base: DTCGDocument,
  incoming: DTCGDocument
): Merge => {
  const document = structuredClone(base) as Json;
  const added: string[] = [];
  const overwritten: Overwrite[] = [];
  const unchanged: string[] = [];
  /** The group at `path`, made where missing, and the $type it gives */
  const groupAt = (path: string[]) => {
    let node = document;
    let inherited = document.$type;
    let created = false;

    path.forEach((key, index) => {
      const child = node[key];

      // A token where the path needs a group is replaced by the group
      if (isObject(child) && isToken(child))
        overwritten.push({
          name: path.slice(0, index + 1).join('.'),
          before: child.$value,
          after: undefined
        });

      created = !isObject(child) || isToken(child);

      if (created) node[key] = {};

      node = node[key] as Json;
      inherited = node.$type ?? inherited;
    });

    return { node, inherited, created };
  };

  // Group properties first, so `$extends` keeps the tokens it brings in
  // (#125). A $type only lands on a group the merge makes: your tokens in
  // a group you had keep the type they inherit. The root is skipped: its
  // $extensions hold your file's Tokens Studio details, kept for export
  groupsOf(incoming as Json).forEach(({ path, group }) => {
    if (!path.length) return;

    const { node, created } = groupAt(path);

    Object.entries(group).forEach(([key, value]) => {
      if (
        key.startsWith('$') &&
        key !== '$root' &&
        (key !== '$type' || created)
      )
        node[key] = structuredClone(value);
    });
  });

  tokensOf(incoming as Json).forEach(({ path, token }) => {
    const { node, inherited } = groupAt(path.slice(0, -1));
    const key = path[path.length - 1];
    const existing = node[key];
    const name = path.join('.');

    if (
      isObject(existing) &&
      isToken(existing) &&
      canonical({ $type: inherited, ...existing }) === canonical(token)
    )
      unchanged.push(name);
    else if (isObject(existing))
      overwritten.push({
        name,
        before: isToken(existing) ? existing.$value : existing,
        after: token.$value
      });
    else added.push(name);

    node[key] = structuredClone(token);
  });

  const file = studioOf(incoming as Json);

  if (file) {
    const extensions = ((document.$extensions as Json | undefined) ??= {});
    const own = ((extensions[DTF_EXTENSION_KEY] as Json | undefined) ??= {});

    own.tokensStudio = structuredClone(combineStudio(studioOf(document), file));
  }

  return { document: document as DTCGDocument, added, overwritten, unchanged };
};
