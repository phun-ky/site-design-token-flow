/**
 * Tokens Studio for Figma's JSON, to and from DTCG 2025.10 (#113, #115).
 *
 * An entry of its own, apart from `./index.ts`, so code that only renders
 * pills doesn't load the converter, its colour maths and its math parser.
 * When this folder becomes a package, this is a subpath export of it.
 */
export {
  convertTokensStudio,
  isTokensStudio,
  readTokensStudio,
  setsForTheme,
  toTokensStudio
} from './utils/tokens-studio';

export type {
  Conversion,
  ConversionNote,
  ExportToken,
  NoteKind,
  SetUse,
  TokensStudioFile,
  TokensStudioSet,
  TokensStudioTheme
} from './utils/tokens-studio';

export { evaluateMath } from './utils/token-math';

export type { MathResult } from './utils/token-math';
