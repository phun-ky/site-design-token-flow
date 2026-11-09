import {
  validateTokens,
  type DTCGDocument,
  type FlatDesignToken
} from '../tokens';

/**
 * Checking token JSON for the playground: in a Web Worker for files of any
 * size (site/validate-worker.ts), or right here where workers are blocked.
 * Results cross from the worker as plain data, so a problem is its path and
 * message, without the Error.
 */

export interface CheckedProblem {
  /** The token or group's name, such as `color.cta`; empty for the document */
  path: string;
  message: string;
}

export interface CheckedTokens {
  tokens: FlatDesignToken[];
  problems: CheckedProblem[];
  /** Whether the text was JSON at all; when not, `problems` holds the reason */
  json: boolean;
}

/**
 * Parses and validates token JSON, collecting every problem.
 *
 * @param {string} text The JSON
 * @returns {CheckedTokens} The valid tokens and every problem
 * @example
 * checkTokenText('{ "a": ');
 * // => { tokens: [], problems: [{ path: '', message: 'Unexpected end of JSON input' }], json: false }
 */
export const checkTokenText = (text: string): CheckedTokens => {
  let doc: DTCGDocument;

  try {
    doc = JSON.parse(text) as DTCGDocument;
  } catch (error) {
    return {
      tokens: [],
      problems: [{ path: '', message: (error as Error).message }],
      json: false
    };
  }

  const { tokens, problems } = validateTokens(doc);

  return {
    tokens,
    problems: problems.map(({ path, message }) => ({ path, message })),
    json: true
  };
};

/**
 * About how many tokens a text holds, before checking it: one per `$value`.
 *
 * @param {string} text The JSON
 * @returns {number} The count
 */
export const countTokens = (text: string): number =>
  text.match(/"\$value"\s*:/g)?.length ?? 0;

/**
 * The line a problem is on, from 1, to move the editor there: the line of
 * the token or group's last name, found by following its path through the
 * keys, or the line a JSON syntax error names.
 *
 * @param {string} text The JSON
 * @param {CheckedProblem} problem The problem
 * @returns {number | null} The line, or null when it can't be found
 * @example
 * lineOfProblem('{\n  "color": {\n    "cta": {}\n  }\n}', { path: 'color.cta', message: '' });
 * // => 3
 */
export const lineOfProblem = (
  text: string,
  { path, message }: CheckedProblem
): number | null => {
  const lineAt = (offset: number) => text.slice(0, offset).split('\n').length;

  if (!path) {
    // Chrome and Firefox: "line 3 column 5"; older engines: "position 42"
    const line = message.match(/line (\d+)/i);
    const position = message.match(/position (\d+)/i);

    if (line) return Number(line[1]);

    return position ? lineAt(Number(position[1])) : null;
  }

  let offset = 0;

  for (const name of path.split('.')) {
    // The name as a key, followed by its colon, not a string value
    const key = new RegExp(
      `${JSON.stringify(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`,
      'g'
    );

    key.lastIndex = offset;

    const match = key.exec(text);

    if (!match) return null;

    offset = match.index + 1;
  }

  return lineAt(offset);
};
