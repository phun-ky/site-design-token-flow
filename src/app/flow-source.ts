import type { FlowDocument, FlowTokens, Preset } from './saved-tokens';

/** The playground, relative to the flow view */
const PLAYGROUND = './playground';

export interface FlowOption {
  label: string;
  /** How many tokens */
  detail: string;
  /** What choosing it saves: the same choice as in the playground */
  preset: Preset;
  /** For one of your documents: which */
  document?: string;
  /** The tokens the flow shows now */
  current: boolean;
}

export interface FlowChoices {
  /** How many tokens the showcase and the example file have */
  showcase: number;
  example: number;
  /** Your documents, and the current one */
  documents: FlowDocument[];
  current: string;
}

export interface FlowSource {
  /** What the flow can show: the playground's choices */
  options: FlowOption[];
  /** Why the flow shows what it does, when that needs saying */
  note: string | null;
  links: { label: string; href: string }[];
}

const count = (n: number) => (n === 1 ? '1 token' : `${n} tokens`);

/**
 * What the flow view's sidebar says about the tokens it shows (#111): the
 * same choices as the playground's, the chosen one current, why the flow
 * shows the example instead when it does, and where to change them.
 *
 * @param {FlowTokens} flow The tokens the flow view shows
 * @param {FlowChoices} choices The presets' sizes and your documents
 * @returns {FlowSource} The options, note and links
 * @example
 * describeFlowSource({ kind: 'preset', preset: 'showcase' }, choices).note;
 * // => null
 */
export const describeFlowSource = (
  flow: FlowTokens,
  { showcase, example, documents, current }: FlowChoices
): FlowSource => {
  const preset = flow.kind === 'preset' ? flow.preset : 'custom';
  const exampleFile = (chosen: boolean): FlowOption => ({
    label: 'Example file',
    detail: count(example),
    preset: 'bundled',
    current: chosen
  });

  // Nothing can be chosen without storage: the example is all there is
  if (flow.kind === 'example' && flow.reason === 'blocked')
    return {
      options: [exampleFile(true)],
      note: 'Your browser blocks storage for this site, so the flow cannot show tokens from the playground.',
      links: []
    };

  const options: FlowOption[] = [
    {
      label: 'Showcase',
      detail: count(showcase),
      preset: 'showcase',
      current: preset === 'showcase'
    },
    exampleFile(preset === 'bundled'),
    ...documents.map(({ id, name, tokens, problems }) => ({
      label: name,
      detail: tokens > 0 ? count(tokens) : problems ? 'Has problems' : 'Empty',
      preset: 'custom' as const,
      document: id,
      current: preset === 'custom' && id === current
    }))
  ];

  switch (flow.kind) {
    case 'preset':
      return {
        options,
        note: null,
        links: [{ label: 'Edit it in the playground', href: PLAYGROUND }]
      };
    case 'yours':
      return {
        options,
        note: flow.latest
          ? null
          : `Showing the last version of “${flow.name}” without problems: your latest edits in the playground have problems.`,
        links: [
          flow.latest
            ? { label: 'Edit them in the playground', href: PLAYGROUND }
            : { label: 'Fix them in the playground', href: PLAYGROUND }
        ]
      };
    default:
      return flow.reason === 'problems'
        ? {
            options,
            note: `“${flow.name}” has problems, so the flow shows the example file.`,
            links: [{ label: 'Fix them in the playground', href: PLAYGROUND }]
          }
        : {
            options,
            note: `“${flow.name}” is empty, so the flow shows the example file.`,
            links: [{ label: 'Add tokens in the playground', href: PLAYGROUND }]
          };
  }
};
