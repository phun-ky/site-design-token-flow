import {
  DTF_EXTENSION_KEY,
  validateTokens,
  type DTCGDocument
} from '../tokens';
import {
  convertTokensStudio,
  isTokensStudio,
  readTokensStudio,
  setsForTheme,
  toTokensStudio,
  type Conversion,
  type SetUse,
  type TokensStudioDocument,
  type TokensStudioSet
} from '../tokens/tokens-studio';

import {
  checkTokenText,
  writtenTokens,
  type CheckedTokens
} from './check-tokens';

/**
 * Reading a token file that may be in the Tokens Studio format (#113,
 * #114). Apart from check-tokens.ts, so the playground loads the converter
 * only in its worker, or when a browser blocks workers.
 */

export interface FileSummary {
  /** A Tokens Studio file, or DTCG */
  format: 'tokens-studio' | 'dtcg';
  keyStyle?: 'legacy' | 'dtcg';
  /** Whether the file had sets, or was read as one */
  hasSets?: boolean;
  sets: { name: string; count: number }[];
  themes: { id: string; name: string; group?: string }[];
  /** How many of your tokens resolve the file's references, when adding */
  yours?: number;
}

/** A theme's id or each set's use, and the format to read the file as */
export interface ConvertChoice {
  theme?: string;
  uses?: Record<string, SetUse>;
  /** Overrides the format guessed from the file (#128) */
  format?: FileSummary['format'];
  /** Your tokens, when adding to them: references to them resolve (#129) */
  yours?: DTCGDocument;
}

/**
 * The set your tokens are read as, while converting a file added to them.
 * shortcut: a file with a set of this name has it taken for yours; a name
 * no file can have would need the converter to take an extra set.
 */
export const YOUR_TOKENS_SET = 'Your tokens';

/**
 * Your tokens as a Tokens Studio set, to resolve references only, or null
 * when they can't be read: the file then converts on its own
 */
const yoursAsSet = (document: DTCGDocument): TokensStudioSet | null => {
  try {
    const tokens = validateTokens(document).tokens.map(
      ({ name, $type, $value, value }) => ({ name, $type, $value, value })
    );

    return {
      name: YOUR_TOKENS_SET,
      tokens:
        (toTokensStudio(tokens, undefined, YOUR_TOKENS_SET)[YOUR_TOKENS_SET] as
          Record<string, unknown> | undefined) ?? {},
      count: tokens.length
    };
  } catch {
    return null;
  }
};

export interface ConvertedTokens {
  summary: FileSummary;
  /** How each set was used */
  uses: Record<string, SetUse>;
  /** The DTCG document, its token count and what the conversion did */
  conversion: Conversion;
  /** The document, checked: tokens and problems */
  checked: CheckedTokens;
}

/**
 * Reads a token file the playground was given, converting it from Tokens
 * Studio when it is one (#113, #114): with the sets of a theme, or the sets
 * as given. A DTCG file is returned as it is, as a conversion of nothing.
 * The format is guessed, unless the choice names one.
 *
 * @param {string} text The file's JSON
 * @param {ConvertChoice} [choice] A theme's id, or each set's use, and the format
 * @returns {ConvertedTokens | null} The result, or null when the text isn't JSON
 */
export const convertTokenText = (
  text: string,
  choice: ConvertChoice = {}
): ConvertedTokens | null => {
  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }

  const object =
    typeof json === 'object' && json !== null && !Array.isArray(json);
  const studio = choice.format
    ? choice.format === 'tokens-studio' && object
    : isTokensStudio(json);

  if (!studio) {
    // Every token it brings, valid or not: one referring to your tokens is
    // only valid once added to them (#127)
    const count = writtenTokens(json).length;

    return {
      summary: {
        format: 'dtcg',
        sets: [{ name: 'tokens', count }],
        themes: []
      },
      uses: {},
      conversion: {
        document: json as DTCGDocument,
        converted: count,
        notes: []
      },
      checked: checkTokenText(text)
    };
  }

  const file = readTokensStudio(json as Record<string, unknown>);
  const theme =
    file.themes.find(({ id, name }) => (id ?? name) === choice.theme) ??
    (choice.theme === undefined ? file.themes[0] : undefined);
  const uses = choice.uses ?? setsForTheme(file, theme);
  const yours = choice.yours ? yoursAsSet(choice.yours) : null;
  const conversion = yours
    ? convertTokensStudio(
        { ...file, sets: [yours, ...file.sets] },
        { ...uses, [YOUR_TOKENS_SET]: 'reference' },
        [YOUR_TOKENS_SET]
      )
    : convertTokensStudio(file, uses);

  if (yours) {
    // Your tokens are yours already: none of them goes in the file's export
    const details = (
      (conversion.document.$extensions as Record<string, unknown>)[
        DTF_EXTENSION_KEY
      ] as { tokensStudio: TokensStudioDocument }
    ).tokensStudio;

    delete details.remainder[YOUR_TOKENS_SET];
    delete details.groups[YOUR_TOKENS_SET];
    details.order = details.order.filter((name) => name !== YOUR_TOKENS_SET);
  }

  return {
    summary: {
      format: 'tokens-studio',
      keyStyle: file.keyStyle,
      hasSets: file.hasSets,
      sets: file.sets.map(({ name, count }) => ({ name, count })),
      themes: file.themes.map(({ id, name, group }) => ({
        id: id ?? name,
        name,
        ...(group && { group })
      })),
      ...(yours && { yours: yours.count })
    },
    uses,
    conversion,
    checked: checkTokenText(JSON.stringify(conversion.document))
  };
};
