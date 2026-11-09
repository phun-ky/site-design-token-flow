/**
 * Tokens Studio's math in token values, such as `16px * 2` or
 * `(8 + 4) / 2`, after references are replaced by their values (#113). A
 * small parser of its own, never `eval`: numbers with an optional unit,
 * `+ - * /`, brackets, and the functions Tokens Studio documents
 * (`roundTo`) plus `round`, `floor`, `ceil`, `abs`, `min` and `max`.
 * Mixing units is refused, as in Tokens Studio.
 */

export interface MathResult {
  value: number;
  /** `px`, `rem`, `%`, `ms` and so on; empty for a plain number */
  unit: string;
}

// A number and its unit, a function's name, or an operator or bracket
const NUMBER = String.raw`(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)([a-z%]*)`;
const TOKEN = new RegExp(
  String.raw`\s*(?:${NUMBER}|([a-z]+)\s*(?=\()|([-+*/(),]))`,
  'iy'
);
const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  roundTo: (value, decimals = 0) => {
    const factor = 10 ** decimals;

    return Math.round(value * factor) / factor;
  },
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  abs: Math.abs,
  min: Math.min,
  max: Math.max
};

type Token =
  | { kind: 'number'; value: number; unit: string }
  | { kind: 'name'; name: string }
  | { kind: 'symbol'; symbol: string };

const tokenize = (text: string): Token[] => {
  const tokens: Token[] = [];

  TOKEN.lastIndex = 0;

  while (TOKEN.lastIndex < text.length) {
    const start = TOKEN.lastIndex;
    const match = TOKEN.exec(text);

    if (!match) {
      if (/^\s*$/.test(text.slice(start))) break;

      throw Error(`Unexpected "${text.slice(start).trim()[0]}" in "${text}"`);
    }

    if (match[1] !== undefined)
      tokens.push({
        kind: 'number',
        value: parseFloat(match[1]),
        unit: match[2].toLowerCase()
      });
    else if (match[3] !== undefined)
      tokens.push({ kind: 'name', name: match[3] });
    else tokens.push({ kind: 'symbol', symbol: match[4] });
  }

  return tokens;
};
/** The unit of two operands; an operand without one takes the other's */
const sameUnit = (a: MathResult, b: MathResult, text: string): string => {
  if (a.unit && b.unit && a.unit !== b.unit)
    throw Error(`Mixed units "${a.unit}" and "${b.unit}" in "${text}"`);

  return a.unit || b.unit;
};

/**
 * Evaluates math in a token value.
 *
 * @param {string} text The value, references already replaced
 * @returns {MathResult} The number and its unit
 * @throws {Error} When the text isn't math this supports, or mixes units
 * @example
 * evaluateMath('8px * 2 + 4px'); // => { value: 20, unit: 'px' }
 */
export const evaluateMath = (text: string): MathResult => {
  const tokens = tokenize(text);

  let index = 0;

  const peek = () => tokens[index];
  const isSymbol = (symbol: string) => {
    const token = peek();

    return token?.kind === 'symbol' && token.symbol === symbol;
  };
  const expect = (symbol: string) => {
    if (!isSymbol(symbol)) throw Error(`Expected "${symbol}" in "${text}"`);

    index += 1;
  };
  const factor = (): MathResult => {
    const token = peek();

    if (!token) throw Error(`Unexpected end of "${text}"`);

    index += 1;

    if (token.kind === 'number')
      return { value: token.value, unit: token.unit };

    if (token.kind === 'name') {
      const fn = FUNCTIONS[token.name];

      if (!fn) throw Error(`Unknown function "${token.name}" in "${text}"`);

      expect('(');

      const args = [expression()];

      while (isSymbol(',')) {
        index += 1;
        args.push(expression());
      }

      expect(')');

      // roundTo's second argument is a count of decimals, not a length
      const unit =
        token.name === 'roundTo'
          ? args[0].unit
          : args.reduce(
              (u, arg) => sameUnit({ value: 0, unit: u }, arg, text),
              ''
            );

      return { value: fn(...args.map(({ value }) => value)), unit };
    }

    if (token.symbol === '(') {
      const inner = expression();

      expect(')');

      return inner;
    }

    if (token.symbol === '-' || token.symbol === '+') {
      const operand = factor();

      return {
        value: token.symbol === '-' ? -operand.value : operand.value,
        unit: operand.unit
      };
    }

    throw Error(`Unexpected "${token.symbol}" in "${text}"`);
  };
  const term = (): MathResult => {
    let result = factor();

    while (isSymbol('*') || isSymbol('/')) {
      const operator = (peek() as { symbol: string }).symbol;

      index += 1;

      const right = factor();

      if (operator === '*') {
        if (result.unit && right.unit)
          throw Error(`Can't multiply two lengths in "${text}"`);

        result = {
          value: result.value * right.value,
          unit: result.unit || right.unit
        };
      } else {
        if (right.value === 0) throw Error(`Division by zero in "${text}"`);

        // A length divided by a length of the same unit is a plain number
        const unit =
          right.unit === '' ? result.unit : sameUnit(result, right, text) && '';

        result = { value: result.value / right.value, unit };
      }
    }

    return result;
  };
  const expression = (): MathResult => {
    let result = term();

    while (isSymbol('+') || isSymbol('-')) {
      const operator = (peek() as { symbol: string }).symbol;

      index += 1;

      const right = term();
      const unit = sameUnit(result, right, text);

      result = {
        value:
          operator === '+'
            ? result.value + right.value
            : result.value - right.value,
        unit
      };
    }

    return result;
  };

  if (tokens.length === 0) throw Error('Empty math');

  const result = expression();

  if (index < tokens.length) throw Error(`Unexpected "${text}"`);

  // Floating point leftovers, such as 0.30000000000000004
  return { value: Math.round(result.value * 1e10) / 1e10, unit: result.unit };
};

/**
 * Whether a value is math, not a plain number or dimension: all of it reads
 * as math, with an operator between operands or a function.
 *
 * @param {string} text The value
 * @returns {boolean} Whether to evaluate it
 */
export const isMath = (text: string): boolean => {
  let tokens: Token[];

  try {
    tokens = tokenize(text);
  } catch {
    return false;
  }

  // A name that isn't one of the functions, such as rgb( or hsl(, is not math
  if (
    tokens.some((token) => token.kind === 'name' && !(token.name in FUNCTIONS))
  )
    return false;

  return tokens.some(
    (token, index) =>
      token.kind === 'name' ||
      (token.kind === 'symbol' &&
        '+-*/'.includes(token.symbol) &&
        index > 0 &&
        tokens[index - 1].kind !== 'symbol') ||
      (token.kind === 'symbol' &&
        '+-*/'.includes(token.symbol) &&
        index > 0 &&
        (tokens[index - 1] as { symbol?: string }).symbol === ')')
  );
};
