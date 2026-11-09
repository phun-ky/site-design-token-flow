// Checks token JSON off the main thread, so the playground stays usable while
// a large file is checked (#109). Allowed by the Content Security Policy's
// script-src 'self': the worker is a file from the site itself.
import { checkTokenText, type CheckedTokens } from '../src/app/check-tokens';

export interface CheckRequest {
  id: number;
  text: string;
}

export interface CheckResponse extends CheckedTokens {
  id: number;
}

self.addEventListener('message', (event: MessageEvent<CheckRequest>) => {
  const { id, text } = event.data;

  self.postMessage({ id, ...checkTokenText(text) } satisfies CheckResponse);
});
