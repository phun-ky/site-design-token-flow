import type { FlowTokens } from './saved-tokens';

/** Links on the flow view, relative to it */
const PLAYGROUND = './playground';
const EXAMPLE = './?tokens=example';
const YOURS = './';

export interface FlowOption {
  label: string;
  /** How many tokens, and where they are kept */
  detail: string;
  href: string;
  /** The tokens the flow shows now */
  current: boolean;
}

export interface FlowSource {
  /** The tokens the flow can show: yours, when you have some, and the example */
  options: FlowOption[];
  /** Why the flow shows what it does, when that needs saying */
  note: string | null;
  links: { label: string; href: string }[];
}

const count = (n: number) => (n === 1 ? '1 token' : `${n} tokens`);

/**
 * What the flow view's sidebar says about the tokens it shows (#111): the
 * tokens it can show, why when that isn't obvious, and where to change them.
 *
 * @param {FlowTokens} flow The tokens the flow view shows
 * @param {number} example How many tokens the example has
 * @returns {FlowSource} The options, note and links
 * @example
 * describeFlowSource({ kind: 'example', reason: 'none' }, 201).note;
 * // => 'You have no tokens of your own yet.'
 */
export const describeFlowSource = (
  flow: FlowTokens,
  example: number
): FlowSource => {
  const exampleOption = (current: boolean): FlowOption => ({
    label: 'The example',
    detail: count(example),
    href: EXAMPLE,
    current
  });
  const yoursOption = (n: number, current: boolean): FlowOption => ({
    label: 'Your tokens',
    detail: `${count(n)}, saved in this browser`,
    href: YOURS,
    current
  });

  if (flow.kind === 'yours') {
    return {
      options: [yoursOption(flow.tokens.length, true), exampleOption(false)],
      note: flow.latest
        ? null
        : 'Showing the last version of your tokens without problems: your latest edits in the playground have problems.',
      links: [
        flow.latest
          ? { label: 'Edit them in the playground', href: PLAYGROUND }
          : { label: 'Fix them in the playground', href: PLAYGROUND }
      ]
    };
  }

  switch (flow.reason) {
    case 'chosen':
      return {
        options: [yoursOption(flow.yours ?? 0, false), exampleOption(true)],
        note: null,
        links: [{ label: 'Edit yours in the playground', href: PLAYGROUND }]
      };
    case 'problems':
      return {
        options: [exampleOption(true)],
        note: 'Your tokens in the playground have problems, so the flow shows the example.',
        links: [{ label: 'Fix them in the playground', href: PLAYGROUND }]
      };
    case 'blocked':
      return {
        options: [exampleOption(true)],
        note: 'Your browser blocks storage for this site, so the flow cannot show tokens from the playground.',
        links: []
      };
    default:
      return {
        options: [exampleOption(true)],
        note: 'You have no tokens of your own yet.',
        links: [{ label: 'Try your own in the playground', href: PLAYGROUND }]
      };
  }
};
