// Checks and converts token JSON off the main thread, so the playground
// stays usable while a large file is checked or converted (#109, #113).
// Allowed by the Content Security Policy's script-src 'self': the worker is
// a file from the site itself.
import { checkTokenText, type CheckedTokens } from '../src/app/check-tokens';
import {
  convertTokenText,
  type ConvertedTokens
} from '../src/app/convert-tokens';
import type { SetUse } from '../src/tokens/tokens-studio';

interface CheckMessage {
  id: number;
  kind: 'check';
  text: string;
}

interface ConvertMessage {
  id: number;
  kind: 'convert';
  text: string;
  theme?: string;
  uses?: Record<string, SetUse>;
}

export type CheckRequest = CheckMessage | ConvertMessage;

export type CheckResponse =
  | ({ id: number; kind: 'check' } & CheckedTokens)
  | { id: number; kind: 'convert'; converted: ConvertedTokens | null };

self.addEventListener('message', (event: MessageEvent<CheckRequest>) => {
  const request = event.data;

  let response: CheckResponse;

  if (request.kind === 'convert')
    response = {
      id: request.id,
      kind: 'convert',
      converted: convertTokenText(request.text, request)
    };
  else
    response = {
      id: request.id,
      kind: 'check',
      ...checkTokenText(request.text)
    };

  self.postMessage(response);
});
