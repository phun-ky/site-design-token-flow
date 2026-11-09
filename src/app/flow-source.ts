import type { FlowTokens } from './saved-tokens';

/** Links on the flow view, relative to it */
const PLAYGROUND = './playground';
const EXAMPLE = './?tokens=example';
const YOURS = './';

export interface FlowSource {
  /** Says whose tokens the flow view shows */
  text: string;
  links: { label: string; href: string }[];
}

const count = (n: number) => (n === 1 ? '1 token' : `${n} tokens`);

/**
 * What the flow view says about the tokens it shows, and where you can go
 * from there.
 *
 * @param {FlowTokens} flow The tokens the flow view shows
 * @returns {FlowSource} The text and links
 * @example
 * describeFlowSource({ kind: 'example', reason: 'none' });
 * // => { text: 'Showing the example tokens.', links: [{ label: 'Try your own in the playground', href: './playground' }] }
 */
export const describeFlowSource = (flow: FlowTokens): FlowSource => {
  if (flow.kind === 'yours') {
    return flow.latest
      ? {
          text: `Showing your tokens from the playground: ${count(flow.tokens.length)}.`,
          links: [
            { label: 'Edit them in the playground', href: PLAYGROUND },
            { label: 'Show the example', href: EXAMPLE }
          ]
        }
      : {
          text: `Showing the last version of your tokens without problems: ${count(flow.tokens.length)}. Your latest edits in the playground have problems.`,
          links: [
            { label: 'Fix them in the playground', href: PLAYGROUND },
            { label: 'Show the example', href: EXAMPLE }
          ]
        };
  }

  switch (flow.reason) {
    case 'chosen':
      return {
        text: 'Showing the example tokens.',
        links: [{ label: 'Show your tokens', href: YOURS }]
      };
    case 'problems':
      return {
        text: 'Showing the example tokens: your tokens in the playground have problems.',
        links: [{ label: 'Fix them in the playground', href: PLAYGROUND }]
      };
    case 'blocked':
      return {
        text: 'Showing the example tokens: your browser blocks storage for this site, so it cannot show tokens from the playground.',
        links: []
      };
    default:
      return {
        text: 'Showing the example tokens.',
        links: [{ label: 'Try your own in the playground', href: PLAYGROUND }]
      };
  }
};
