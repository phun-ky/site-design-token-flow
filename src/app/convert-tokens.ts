import type { DTCGDocument } from '../tokens';
import {
  convertTokensStudio,
  isTokensStudio,
  readTokensStudio,
  setsForTheme,
  type Conversion,
  type SetUse
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
}

/** A theme's id or each set's use, and the format to read the file as */
export interface ConvertChoice {
  theme?: string;
  uses?: Record<string, SetUse>;
  /** Overrides the format guessed from the file (#128) */
  format?: FileSummary['format'];
}

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
  const conversion = convertTokensStudio(file, uses);

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
      }))
    },
    uses,
    conversion,
    checked: checkTokenText(JSON.stringify(conversion.document))
  };
};
